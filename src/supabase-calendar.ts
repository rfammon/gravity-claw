/**
 * Supabase Calendar Provider
 * Database-backed calendar that replaces Google Calendar OAuth2.
 *
 * Zero token management — uses existing Supabase credentials.
 * Falls back to local SQLite when Supabase is unavailable.
 *
 * Same public API as the old google-calendar.ts:
 *   - listEvents, createCalendarEvent, deleteCalendarEvent, checkAvailability
 */

import { config } from "./config.js";
import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { sendTelegramMessage } from "./telegram-utils.js";

// ── Types ────────────────────────────────────────────────────────────

export interface CalendarEvent {
    id?: string;
    summary: string;
    description?: string;
    start: string;         // ISO 8601
    end?: string;          // ISO 8601
    location?: string;
    recurrence?: string;   // 'daily' | 'weekly' | 'monthly' | null
    reminderMinutes?: number;
    status?: string;
    reminded?: boolean;
}

// ── State ────────────────────────────────────────────────────────────

let useSupabase = false;
let localDb: Database.Database | null = null;

export function isCalendarConfigured(): boolean {
    return true; // Always available — Supabase or SQLite fallback
}

function getLocalDb(): Database.Database {
    if (!localDb) {
        const dir = path.join(os.homedir(), ".gravity_claw");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        localDb = new Database(path.join(dir, "calendar.sqlite"));
        localDb.exec(`
            CREATE TABLE IF NOT EXISTS calendar_events (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                chat_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                location TEXT,
                recurrence TEXT,
                reminder_minutes INTEGER,
                status TEXT DEFAULT 'confirmed',
                reminded INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_cal_chat ON calendar_events(chat_id);
            CREATE INDEX IF NOT EXISTS idx_cal_time ON calendar_events(start_time);
        `);
    }
    return localDb;
}

export function initCalendar(): boolean {
    if (config.supabaseUrl && config.supabaseServiceKey) {
        useSupabase = true;
        console.log("📅 Calendar: Supabase-backed ✓");
    } else {
        useSupabase = false;
        getLocalDb(); // Initialize SQLite
        console.log("📅 Calendar: SQLite fallback ✓");
    }
    return true;
}

// ── Supabase helpers ─────────────────────────────────────────────────

async function supabaseClient() {
    const { getClient } = await import("./supabase-db.js");
    return getClient();
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * List events with flexible filters
 */
export async function listEvents(options: {
    range?: "today" | "tomorrow" | "this-week" | "next-7-days";
    from?: string;
    to?: string;
    limit?: number;
    chatId?: string;
}): Promise<CalendarEvent[]> {
    const limit = options.limit || 15;
    const now = new Date();
    let timeMin: string;
    let timeMax: string | undefined;

    switch (options.range) {
        case "today": {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            timeMin = start.toISOString();
            timeMax = end.toISOString();
            break;
        }
        case "tomorrow": {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            timeMin = start.toISOString();
            timeMax = end.toISOString();
            break;
        }
        case "this-week": {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            timeMin = startOfWeek.toISOString();
            timeMax = endOfWeek.toISOString();
            break;
        }
        case "next-7-days": {
            timeMin = now.toISOString();
            const end = new Date(now);
            end.setDate(end.getDate() + 7);
            timeMax = end.toISOString();
            break;
        }
        default: {
            timeMin = options.from || now.toISOString();
            timeMax = options.to;
        }
    }

    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            let query = sb
                .from("calendar_events")
                .select("*")
                .gte("start_time", timeMin)
                .eq("status", "confirmed")
                .order("start_time", { ascending: true })
                .limit(limit);

            if (timeMax) query = query.lte("start_time", timeMax);
            if (options.chatId) query = query.eq("chat_id", options.chatId);

            const { data, error } = await query;
            if (error) throw error;

            return (data ?? []).map(mapRow);
        } catch (err) {
            console.warn("⚠️ Calendar Supabase fallback to SQLite:", err instanceof Error ? err.message : String(err));
            // Fall through to SQLite
        }
    }

    // SQLite fallback
    const db = getLocalDb();
    let sql = `SELECT * FROM calendar_events WHERE start_time >= ? AND status = 'confirmed'`;
    const params: any[] = [timeMin];
    if (timeMax) {
        sql += ` AND start_time <= ?`;
        params.push(timeMax);
    }
    if (options.chatId) {
        sql += ` AND chat_id = ?`;
        params.push(options.chatId);
    }
    sql += ` ORDER BY start_time ASC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(mapRow);
}

/**
 * Create a calendar event
 */
export async function createCalendarEvent(event: {
    summary: string;
    description?: string;
    start: Date | string;
    end?: Date | string;
    durationMinutes?: number;
    location?: string;
    recurrence?: string;
    reminderMinutes?: number;
    chatId?: string;
}): Promise<CalendarEvent> {
    const chatId = event.chatId || config.allowedUserIds[0]?.toString() || "default";

    const startDate = event.start instanceof Date ? event.start : new Date(event.start);
    if (isNaN(startDate.getTime())) {
        throw new Error(`Data de início inválida: "${event.start}". Use formato ISO 8601.`);
    }

    const endDate = event.end
        ? (event.end instanceof Date ? event.end : new Date(event.end))
        : new Date(startDate.getTime() + (event.durationMinutes || 60) * 60000);
    if (isNaN(endDate.getTime())) {
        throw new Error(`Data de fim inválida: "${event.end}". Use formato ISO 8601.`);
    }

    const row = {
        chat_id: chatId,
        summary: event.summary,
        description: event.description || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location: event.location || null,
        recurrence: event.recurrence || null,
        reminder_minutes: event.reminderMinutes ?? null,
        status: "confirmed",
        reminded: false,
    };

    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            const { data, error } = await sb
                .from("calendar_events")
                .insert(row)
                .select()
                .single();

            if (error) throw error;
            return mapRow(data);
        } catch (err) {
            console.warn("⚠️ Calendar create Supabase fallback:", err instanceof Error ? err.message : String(err));
        }
    }

    // SQLite fallback
    const db = getLocalDb();
    const id = crypto.randomUUID().replace(/-/g, "");
    db.prepare(`
        INSERT INTO calendar_events (id, chat_id, summary, description, start_time, end_time, location, recurrence, reminder_minutes, status, reminded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, row.chat_id, row.summary, row.description, row.start_time, row.end_time, row.location, row.recurrence, row.reminder_minutes, row.status, 0);

    return {
        id,
        summary: row.summary,
        start: row.start_time,
        end: row.end_time,
        location: row.location || undefined,
        status: row.status,
    };
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(
    eventId: string,
    chatId?: string
): Promise<boolean> {
    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            const { error } = await sb
                .from("calendar_events")
                .update({ status: "cancelled", updated_at: new Date().toISOString() })
                .eq("id", eventId);

            if (error) throw error;
            return true;
        } catch (err) {
            console.warn("⚠️ Calendar delete Supabase fallback:", err instanceof Error ? err.message : String(err));
        }
    }

    // SQLite fallback
    try {
        const db = getLocalDb();
        db.prepare(`UPDATE calendar_events SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(eventId);
        return true;
    } catch (err) {
        console.error("❌ Calendar deleteEvent:", err);
        return false;
    }
}

/**
 * Update a calendar event
 */
export async function updateCalendarEvent(
    eventId: string,
    updates: Partial<{ summary: string; description: string; start: string; end: string; location: string; status: string }>
): Promise<boolean> {
    const mapped: Record<string, any> = { updated_at: new Date().toISOString() };
    if (updates.summary) mapped.summary = updates.summary;
    if (updates.description !== undefined) mapped.description = updates.description;
    if (updates.start) mapped.start_time = updates.start;
    if (updates.end) mapped.end_time = updates.end;
    if (updates.location !== undefined) mapped.location = updates.location;
    if (updates.status) mapped.status = updates.status;

    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            const { error } = await sb
                .from("calendar_events")
                .update(mapped)
                .eq("id", eventId);

            if (error) throw error;
            return true;
        } catch (err) {
            console.warn("⚠️ Calendar update Supabase fallback:", err instanceof Error ? err.message : String(err));
        }
    }

    // SQLite fallback
    try {
        const db = getLocalDb();
        const sets = Object.entries(mapped).map(([k]) => `${k} = ?`).join(", ");
        const values = Object.values(mapped);
        db.prepare(`UPDATE calendar_events SET ${sets} WHERE id = ?`).run(...values, eventId);
        return true;
    } catch (err) {
        console.error("❌ Calendar updateEvent:", err);
        return false;
    }
}

/**
 * Check availability/busy status for a date
 */
export async function checkAvailability(date?: string, chatId?: string): Promise<{
    date: string;
    eventCount: number;
    events: { summary: string; start: string; end: string }[];
    freeSlots: string[];
}> {
    const checkDate = date ? new Date(date) : new Date();
    const dayStart = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const events = await listEvents({
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
        limit: 50,
        chatId,
    });

    // Calculate free slots (8AM-20PM business hours)
    const freeSlots: string[] = [];
    const busyTimes = events
        .filter((e) => e.start && e.end)
        .map((e) => ({ start: new Date(e.start), end: new Date(e.end!) }));

    const workStart = new Date(dayStart);
    workStart.setHours(8, 0, 0, 0);
    const workEnd = new Date(dayStart);
    workEnd.setHours(20, 0, 0, 0);

    let cursor = workStart.getTime();
    for (const busy of busyTimes.sort((a, b) => a.start.getTime() - b.start.getTime())) {
        if (busy.start.getTime() > cursor && busy.start.getTime() <= workEnd.getTime()) {
            const gapMinutes = Math.round((busy.start.getTime() - cursor) / 60000);
            if (gapMinutes >= 30) {
                freeSlots.push(
                    `${new Date(cursor).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} - ${busy.start.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} (${gapMinutes}min livre)`
                );
            }
        }
        cursor = Math.max(cursor, busy.end.getTime());
    }
    if (cursor < workEnd.getTime()) {
        freeSlots.push(
            `${new Date(cursor).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} - 20:00 (livre)`
        );
    }

    return {
        date: checkDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        eventCount: events.length,
        events: events.map((e) => ({
            summary: e.summary,
            start: e.start ? new Date(e.start).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "?",
            end: e.end ? new Date(e.end).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "?",
        })),
        freeSlots,
    };
}

/**
 * Get upcoming events for reminder notifications
 */
export async function getUpcomingEventsForReminder(withinMinutes: number = 15, chatId?: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const soon = new Date(now.getTime() + withinMinutes * 60000);

    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            let query = sb
                .from("calendar_events")
                .select("*")
                .eq("status", "confirmed")
                .eq("reminded", false)
                .gte("start_time", now.toISOString())
                .lte("start_time", soon.toISOString())
                .order("start_time", { ascending: true });

            if (chatId) query = query.eq("chat_id", chatId);

            const { data, error } = await query;
            if (error) throw error;
            return (data ?? []).map(mapRow);
        } catch (err) {
            console.warn("⚠️ Calendar upcoming Supabase fallback:", err instanceof Error ? err.message : String(err));
        }
    }

    const db = getLocalDb();
    let sql = `SELECT * FROM calendar_events WHERE status = 'confirmed' AND reminded = 0 AND start_time >= ? AND start_time <= ?`;
    const params = [now.toISOString(), soon.toISOString()];

    if (chatId) {
        sql += ` AND chat_id = ?`;
        params.push(chatId);
    }
    sql += ` ORDER BY start_time ASC`;

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(mapRow);
}

/**
 * Marks an event as reminded
 */
export async function markEventReminded(eventId: string): Promise<void> {
    if (useSupabase) {
        try {
            const sb = await supabaseClient();
            const { error } = await sb
                .from("calendar_events")
                .update({ reminded: true })
                .eq("id", eventId);
            if (error) throw error;
            return;
        } catch (err) {
            console.warn("⚠️ Calendar markReminded Supabase fallback:", err instanceof Error ? err.message : String(err));
        }
    }

    // SQLite Fallback
    const db = getLocalDb();
    db.prepare(`UPDATE calendar_events SET reminded = 1 WHERE id = ?`).run(eventId);
}

/**
 * Checks for upcoming events and sends telegram notifications
 */
export async function checkAndSendCalendarReminders(chatId: string) {
    const events = await getUpcomingEventsForReminder(15, chatId);
    if (!events || events.length === 0) return;

    for (const event of events) {
        try {
            const startTime = new Date(event.start).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', timeZone: "America/Sao_Paulo" });
            const location = event.location ? `\n📍 **Local:** ${event.location}` : "";
            const desc = event.description ? `\n📝 **Detalhes:** ${event.description}` : "";

            const message = `🔔 *Lembrete de Evento:*\n\n**${event.summary}**\n🕒 **Início:** ${startTime}${location}${desc}`;

            await sendTelegramMessage(chatId, message);
            await markEventReminded(event.id!);
            console.log(`📅 Reminded ${chatId} about event ${event.id}`);
        } catch (err) {
            console.error(`❌ Failed to send calendar reminder for event ${event.id}`, err);
        }
    }
}

// ── Row mapper ───────────────────────────────────────────────────────

function mapRow(row: any): CalendarEvent {
    return {
        id: row.id,
        summary: row.summary || "(sem título)",
        description: row.description,
        start: row.start_time,
        end: row.end_time,
        location: row.location,
        recurrence: row.recurrence,
        reminderMinutes: row.reminder_minutes,
        status: row.status,
        reminded: !!row.reminded,
    };
}
