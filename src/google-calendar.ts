/**
 * Google Calendar Provider
 * Zero-dependency Google Calendar API v3 client.
 * Adapted from sincere-arjun/calendar-skill pattern.
 * 
 * Supports:
 * - OAuth2 access tokens (manual or auto-refresh)
 * - List/create/delete events
 * - Check availability (free/busy)
 * - Natural language dates
 */

import https from "https";
import { config } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────

export interface CalendarEvent {
    id?: string;
    summary: string;
    description?: string;
    start: string;         // ISO 8601
    end?: string;          // ISO 8601
    location?: string;
    attendees?: string[];  // email array
    meetLink?: string;
    htmlLink?: string;
    status?: string;
}

export interface CalendarConfig {
    accessToken: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    calendarId: string;
    timeZone: string;
}

// ── State ────────────────────────────────────────────────────────────

let calendarConfig: CalendarConfig | null = null;

export function isCalendarConfigured(): boolean {
    return calendarConfig !== null && !!calendarConfig.accessToken;
}

export function initCalendar(): boolean {
    const token = (config as any).googleCalendarToken;
    if (!token) {
        console.log("📅 Google Calendar: not configured (GOOGLE_CALENDAR_TOKEN missing)");
        return false;
    }

    calendarConfig = {
        accessToken: token,
        refreshToken: (config as any).googleCalendarRefreshToken,
        clientId: (config as any).googleClientId,
        clientSecret: (config as any).googleClientSecret,
        calendarId: (config as any).googleCalendarId || "primary",
        timeZone: "America/Sao_Paulo",
    };

    console.log("📅 Google Calendar: configured ✓");
    return true;
}

// ── API Request Helper ───────────────────────────────────────────────

async function apiRequest<T = any>(
    endpoint: string,
    options: {
        method?: string;
        query?: Record<string, string | number | boolean | undefined>;
        body?: any;
    } = {}
): Promise<T> {
    if (!calendarConfig) throw new Error("Google Calendar not configured");

    const url = new URL(`https://www.googleapis.com/calendar/v3/${endpoint}`);
    if (options.query) {
        for (const [k, v] of Object.entries(options.query)) {
            if (v !== undefined) url.searchParams.append(k, String(v));
        }
    }

    return new Promise((resolve, reject) => {
        const reqOptions = {
            method: options.method || "GET",
            headers: {
                "Authorization": `Bearer ${calendarConfig!.accessToken}`,
                "Content-Type": "application/json",
            },
        };

        const req = https.request(url, reqOptions, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                // DELETE returns empty body
                if (res.statusCode === 204 || !data.trim()) {
                    resolve({} as T);
                    return;
                }

                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        // If 401, try refresh
                        if (res.statusCode === 401 && calendarConfig?.refreshToken) {
                            refreshToken()
                                .then(() => apiRequest<T>(endpoint, options))
                                .then(resolve)
                                .catch(reject);
                            return;
                        }
                        reject(new Error(`Calendar API: ${json.error.message || JSON.stringify(json.error)}`));
                    } else {
                        resolve(json);
                    }
                } catch (e) {
                    reject(new Error(`Invalid Calendar API response (status ${res.statusCode}): ${data.substring(0, 200)}`));
                }
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error("Calendar API request timeout"));
        });

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

// ── Token Refresh ────────────────────────────────────────────────────

async function refreshToken(): Promise<void> {
    if (!calendarConfig?.refreshToken || !calendarConfig?.clientId || !calendarConfig?.clientSecret) {
        throw new Error("Cannot refresh token: missing refresh_token, client_id, or client_secret");
    }

    console.log("🔄 Refreshing Google Calendar access token...");

    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: calendarConfig!.clientId!,
            client_secret: calendarConfig!.clientSecret!,
            refresh_token: calendarConfig!.refreshToken!,
            grant_type: "refresh_token",
        }).toString();

        const req = https.request(
            "https://oauth2.googleapis.com/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(postData),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.access_token) {
                            calendarConfig!.accessToken = json.access_token;
                            console.log("✅ Token refreshed successfully");
                            resolve();
                        } else {
                            reject(new Error(`Token refresh failed: ${JSON.stringify(json)}`));
                        }
                    } catch (e) {
                        reject(new Error(`Token refresh parse error: ${data}`));
                    }
                });
            }
        );

        req.on("error", reject);
        req.write(postData);
        req.end();
    });
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * List calendars available to this account
 */
export async function listCalendars(): Promise<{ id: string; summary: string; primary: boolean }[]> {
    const data = await apiRequest<any>("users/me/calendarList");
    return (data.items || []).map((c: any) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary || false,
    }));
}

/**
 * List events with flexible filters
 */
export async function listEvents(options: {
    range?: "today" | "tomorrow" | "this-week" | "next-7-days";
    from?: string;
    to?: string;
    limit?: number;
    calendarId?: string;
}): Promise<CalendarEvent[]> {
    const calId = options.calendarId || calendarConfig?.calendarId || "primary";
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

    const query: Record<string, any> = {
        timeMin,
        maxResults: limit,
        singleEvents: true,
        orderBy: "startTime",
    };
    if (timeMax) query.timeMax = timeMax;

    const data = await apiRequest<any>(
        `calendars/${encodeURIComponent(calId)}/events`,
        { query }
    );

    return (data.items || []).map((e: any) => ({
        id: e.id,
        summary: e.summary || "(sem título)",
        description: e.description,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        meetLink: e.hangoutLink,
        htmlLink: e.htmlLink,
        status: e.status,
        attendees: e.attendees?.map((a: any) => a.email),
    }));
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
    attendees?: string[];
    addMeetLink?: boolean;
    calendarId?: string;
}): Promise<CalendarEvent> {
    const calId = event.calendarId || calendarConfig?.calendarId || "primary";
    const tz = calendarConfig?.timeZone || "America/Sao_Paulo";

    const startDate = event.start instanceof Date ? event.start : new Date(event.start);
    if (isNaN(startDate.getTime())) {
        throw new Error(`Invalid start date: "${event.start}". Use ISO 8601 format (e.g. 2026-03-01T14:00:00-03:00) or pass a Date object.`);
    }

    const endDate = event.end
        ? (event.end instanceof Date ? event.end : new Date(event.end))
        : new Date(startDate.getTime() + (event.durationMinutes || 60) * 60000);
    if (isNaN(endDate.getTime())) {
        throw new Error(`Invalid end date: "${event.end}". Use ISO 8601 format or pass a Date object.`);
    }

    const body: any = {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: { dateTime: startDate.toISOString(), timeZone: tz },
        end: { dateTime: endDate.toISOString(), timeZone: tz },
    };

    if (event.attendees?.length) {
        body.attendees = event.attendees.map((email) => ({ email }));
    }

    if (event.addMeetLink) {
        body.conferenceData = {
            createRequest: {
                requestId: `megamind-${Date.now()}`,
                conferenceSolutionKey: { type: "hangoutsMeet" },
            },
        };
    }

    const data = await apiRequest<any>(
        `calendars/${encodeURIComponent(calId)}/events${event.addMeetLink ? "?conferenceDataVersion=1" : ""}`,
        { method: "POST", body }
    );

    return {
        id: data.id,
        summary: data.summary,
        start: data.start?.dateTime,
        end: data.end?.dateTime,
        htmlLink: data.htmlLink,
        meetLink: data.hangoutLink,
    };
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(
    eventId: string,
    calendarId?: string
): Promise<boolean> {
    const calId = calendarId || calendarConfig?.calendarId || "primary";
    try {
        await apiRequest(
            `calendars/${encodeURIComponent(calId)}/events/${eventId}`,
            { method: "DELETE" }
        );
        return true;
    } catch (err) {
        console.error("❌ Calendar deleteEvent:", err);
        return false;
    }
}

/**
 * Check availability/busy status for a date
 */
export async function checkAvailability(date?: string): Promise<{
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
    });

    // Calculate free slots (simple: 8AM-20PM business hours)
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
