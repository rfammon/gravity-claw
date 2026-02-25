/**
 * Database Provider — Unified Abstraction Layer
 *
 * Priority: Supabase (cloud) → SQLite (local)
 * SQLite: better-sqlite3 (native) → sql.js (pure JS fallback)
 *
 * All consumers import from here for consistent API.
 */

import { config } from "./config.js";

// ── Shared Types ─────────────────────────────────────────────────────
export interface MemoryEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp?: string;
}

export interface IMemoryProvider {
    readonly backend: "sqlite" | "supabase";

    saveMessage(chatId: string, role: string, content: string, metadata?: any): void | Promise<void>;
    getChatHistory(chatId: string, limit?: number): MemoryEntry[] | Promise<MemoryEntry[]>;
    storeFact(chatId: string, key: string, value: string): void | Promise<void>;
    getFacts(chatId: string): Record<string, string> | Promise<Record<string, string>>;
    clearHistory(chatId: string): void | Promise<void>;

    trackBotMessage(chatId: string, messageId: number, responseText: string): void | Promise<void>;
    saveFeedback(chatId: string, messageId: number, signal: string, emoji: string): void | Promise<void>;
    getFeedbackSummary(chatId: string): string | Promise<string>;

    saveJudgment(chatId: string, type: "daily" | "weekly", opinion: string, periodStart: string, periodEnd: string): void | Promise<void>;
    getLatestJudgments(chatId: string): string | Promise<string>;
    getMemoriesSince(chatId: string, sinceDateISO: string): MemoryEntry[] | Promise<MemoryEntry[]>;
    getJudgmentsSince(chatId: string, type: "daily", sinceDateISO: string): { opinion: string; timestamp: string }[] | Promise<{ opinion: string; timestamp: string }[]>;

    // ── Reminders ──
    addReminder(chatId: string, userId: number, text: string, remindAt: Date, metadata?: any): void | Promise<void>;
    getPendingReminders(): any[] | Promise<any[]>;
    updateReminderStatus(id: string, status: 'completed' | 'failed' | 'cancelled'): void | Promise<void>;
    listReminders(chatId: string): any[] | Promise<any[]>;
    cancelReminder(chatId: string, reminderId: number): boolean | Promise<boolean>;

    // ── Mental State ──
    snapshotState(chatId: string, stateData: any, reason?: string): void | Promise<void>;
    getLatestState(chatId: string): any | Promise<any | null>;
}


// ── Provider Selection ───────────────────────────────────────────────

let _db: IMemoryProvider;
let _backend: "supabase" | "sqlite" | "pending" = "pending";

async function initializeProvider(): Promise<IMemoryProvider> {
    // Try Supabase first (if configured)
    if (config.supabaseUrl && config.supabaseServiceKey) {
        console.log("☁️  Attempting Supabase connection...");
        try {
            const { SupabaseMemory } = await import("./supabase-db.js");
            const supabaseProvider = new SupabaseMemory();

            // Test connection with a simple query
            const { error } = await (await import("./supabase-db.js")).getClient()
                .from("memories")
                .select("id")
                .limit(1);

            if (error && error.code !== "PGRST116") { // PGRST116 = no rows found (ok)
                throw new Error(`Supabase query failed: ${error.message}`);
            }

            console.log("✅ Supabase connected successfully!");
            _backend = "supabase";
            return supabaseProvider;
        } catch (err) {
            console.error("⚠️  Supabase connection failed:", err instanceof Error ? err.message : String(err));
            console.log("📦 Falling back to SQLite...");
        }
    }

    // Fallback to SQLite (using adaptive adapter)
    console.log("💾 Initializing SQLite...");
    _backend = "sqlite";

    try {
        const { initDatabase, getDatabase } = await import("./db-adapter.js");
        const db = await initDatabase();

        // Wrap database adapter to match IMemoryProvider interface
        return createSQLiteProvider(db);
    } catch (err) {
        console.error("❌ SQLite adapter failed:", err);
        console.log("🔄 Using legacy memory.ts as final fallback...");

        // Final fallback to legacy memory.ts
        const mem = await import("./memory.js");
        return {
            backend: "sqlite" as const,
            saveMessage: mem.saveMessage,
            getChatHistory: mem.getChatHistory,
            storeFact: mem.storeFact,
            getFacts: mem.getFacts,
            clearHistory: mem.clearHistory,
            trackBotMessage: mem.trackBotMessage,
            saveFeedback: mem.saveFeedback,
            getFeedbackSummary: mem.getFeedbackSummary,
            saveJudgment: mem.saveJudgment,
            getLatestJudgments: mem.getLatestJudgments,
            getMemoriesSince: mem.getMemoriesSince,
            getJudgmentsSince: mem.getJudgmentsSince,
            addReminder: () => { },
            getPendingReminders: () => [],
            updateReminderStatus: () => { },
            listReminders: () => [],
            cancelReminder: () => false,
            snapshotState: () => { },
            getLatestState: () => null,
        };
    }
}

function createSQLiteProvider(db: any): IMemoryProvider {
    return {
        backend: "sqlite" as const,

        saveMessage: (chatId, role, content, metadata) => {
            const stmt = db.prepare("INSERT INTO memories (chat_id, role, content, metadata) VALUES (?, ?, ?, ?)");
            stmt.run(chatId, role, content, metadata ? JSON.stringify(metadata) : null);
        },

        getChatHistory: (chatId, limit = 50) => {
            const stmt = db.prepare("SELECT role, content, timestamp FROM memories WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?");
            const rows = stmt.all(chatId, limit) as any[];
            return rows.reverse().map(row => ({
                role: row.role as MemoryEntry["role"],
                content: row.content,
                timestamp: row.timestamp
            }));
        },

        storeFact: (chatId, key, value) => {
            const stmt = db.prepare(`
                INSERT INTO facts (chat_id, key, value) VALUES (?, ?, ?)
                ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            `);
            stmt.run(chatId, key, value);
        },

        getFacts: (chatId) => {
            const stmt = db.prepare("SELECT key, value FROM facts WHERE chat_id = ?");
            const rows = stmt.all(chatId) as any[];
            const facts: Record<string, string> = {};
            rows.forEach(row => { facts[row.key] = row.value; });
            return facts;
        },

        clearHistory: (chatId) => {
            const stmt = db.prepare("DELETE FROM memories WHERE chat_id = ?");
            stmt.run(chatId);
        },

        trackBotMessage: (chatId, messageId, responseText) => {
            const stmt = db.prepare("INSERT OR REPLACE INTO bot_messages (message_id, chat_id, response_text) VALUES (?, ?, ?)");
            stmt.run(messageId, chatId, responseText.substring(0, 500));
        },

        saveFeedback: (chatId, messageId, signal, emoji) => {
            const lookup = db.prepare("SELECT response_text FROM bot_messages WHERE chat_id = ? AND message_id = ?");
            const row = lookup.get(chatId, messageId) as { response_text: string } | undefined;
            const botResponse = row?.response_text ?? "(unknown message)";

            const stmt = db.prepare("INSERT INTO feedback (chat_id, message_id, bot_response, signal, emoji) VALUES (?, ?, ?, ?, ?)");
            stmt.run(chatId, messageId, botResponse, signal, emoji);
            console.log(`📊 Feedback saved: ${emoji} (${signal}) on message ${messageId}`);
        },

        getFeedbackSummary: (chatId) => {
            const stmt = db.prepare("SELECT bot_response, signal, emoji, timestamp FROM feedback WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 20");
            const rows = stmt.all(chatId) as { bot_response: string; signal: string; emoji: string; timestamp: string }[];

            if (rows.length === 0) return "";

            const loved = rows.filter(r => r.signal === "loved");
            const positive = rows.filter(r => r.signal === "positive");
            const negative = rows.filter(r => r.signal === "negative");

            let summary = "";
            if (loved.length > 0) {
                summary += "\n❤️ RESPONSES THE USER LOVED:\n";
                loved.forEach(r => summary += `- "${r.bot_response.substring(0, 120)}..."\n`);
            }
            if (positive.length > 0) {
                summary += "\n👍 RESPONSES THE USER LIKED:\n";
                positive.forEach(r => summary += `- "${r.bot_response.substring(0, 120)}..."\n`);
            }
            if (negative.length > 0) {
                summary += "\n😡 RESPONSES THE USER DISLIKED:\n";
                negative.forEach(r => summary += `- "${r.bot_response.substring(0, 120)}..."\n`);
            }

            return summary;
        },

        saveJudgment: (chatId, type, opinion, periodStart, periodEnd) => {
            const stmt = db.prepare(`
                INSERT INTO user_judgments (chat_id, type, opinion, period_start, period_end) 
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(chatId, type, opinion, periodStart, periodEnd);
            console.log(`🧠 Judgment saved (${type}) for ${chatId}`);
        },

        getLatestJudgments: (chatId) => {
            const weeklyStmt = db.prepare("SELECT opinion, timestamp FROM user_judgments WHERE chat_id = ? AND type = 'weekly' ORDER BY timestamp DESC LIMIT 1");
            const dailyStmt = db.prepare("SELECT opinion, timestamp FROM user_judgments WHERE chat_id = ? AND type = 'daily' ORDER BY timestamp DESC LIMIT 3");

            const latestWeekly = weeklyStmt.get(chatId) as { opinion: string; timestamp: string } | undefined;
            const recentDailies = dailyStmt.all(chatId) as { opinion: string; timestamp: string }[];

            let summary = "";
            if (latestWeekly) {
                summary += `📌 Avaliação Semanal Profunda (${latestWeekly.timestamp}):\n${latestWeekly.opinion}\n\n`;
            }

            if (recentDailies.length > 0) {
                summary += `📝 Diários Recentes:\n`;
                recentDailies.forEach(d => summary += `- [${d.timestamp}] ${d.opinion}\n`);
            }

            return summary;
        },

        getMemoriesSince: (chatId, sinceDateISO) => {
            const stmt = db.prepare("SELECT role, content, timestamp FROM memories WHERE chat_id = ? AND timestamp >= ? ORDER BY timestamp ASC");
            const rows = stmt.all(chatId, sinceDateISO) as any[];
            return rows.map(row => ({
                role: row.role as MemoryEntry["role"],
                content: row.content,
                timestamp: row.timestamp
            }));
        },

        getJudgmentsSince: (chatId, type, sinceDateISO) => {
            const stmt = db.prepare("SELECT opinion, timestamp FROM user_judgments WHERE chat_id = ? AND type = ? AND timestamp >= ? ORDER BY timestamp ASC");
            return stmt.all(chatId, type, sinceDateISO) as { opinion: string; timestamp: string }[];
        },

        addReminder: (chatId, userId, text, remindAt, metadata) => {
            const stmt = db.prepare(`
                INSERT INTO reminders (chat_id, user_id, reminder_text, remind_at, status, metadata)
                VALUES (?, ?, ?, ?, 'pending', ?)
            `);
            stmt.run(chatId, userId, text, remindAt.toISOString(), metadata ? JSON.stringify(metadata) : null);
        },

        getPendingReminders: () => {
            const stmt = db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?");
            return stmt.all(new Date().toISOString()) as any[];
        },

        updateReminderStatus: (id, status) => {
            const stmt = db.prepare("UPDATE reminders SET status = ? WHERE id = ?");
            stmt.run(status, id);
        },

        listReminders: (chatId) => {
            const stmt = db.prepare("SELECT * FROM reminders WHERE chat_id = ? AND status = 'pending' ORDER BY remind_at ASC");
            return stmt.all(chatId) as any[];
        },

        cancelReminder: (chatId, id) => {
            const stmt = db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND chat_id = ?");
            const info = stmt.run(id, chatId);
            return info.changes > 0;
        },

        snapshotState: (chatId, stateData, reason) => {
            // Not implemented for SQLite yet, but needs the method to satisfy interface
            console.warn("⚠️ Mental State snapshots not fully implemented for SQLite yet.");
        },

        getLatestState: (chatId) => {
            return null; // Not implemented for SQLite yet
        }
    };
}

// Initialize and export
const providerPromise = initializeProvider();

// Export database instance (for direct access if needed)
export async function getDb(): Promise<IMemoryProvider> {
    return providerPromise;
}

// Export backend type
export function getBackendType(): string {
    return _backend;
}

// Synchronous exports (for backwards compatibility)
// These will use the cached provider after initialization
let _cachedDb: IMemoryProvider | null = null;

providerPromise.then(db => {
    _cachedDb = db;
});

function requireDb(): IMemoryProvider {
    if (!_cachedDb) {
        throw new Error("Database not yet initialized. Use getDb() for async access.");
    }
    return _cachedDb;
}

// Convenience re-exports
export const saveMessage = async (...args: Parameters<IMemoryProvider["saveMessage"]>) => (await getDb()).saveMessage(...args);
export const getChatHistory = async (...args: Parameters<IMemoryProvider["getChatHistory"]>) => (await getDb()).getChatHistory(...args);
export const storeFact = async (...args: Parameters<IMemoryProvider["storeFact"]>) => (await getDb()).storeFact(...args);
export const getFacts = async (...args: Parameters<IMemoryProvider["getFacts"]>) => (await getDb()).getFacts(...args);
export const clearHistory = async (...args: Parameters<IMemoryProvider["clearHistory"]>) => (await getDb()).clearHistory(...args);
export const trackBotMessage = async (...args: Parameters<IMemoryProvider["trackBotMessage"]>) => (await getDb()).trackBotMessage(...args);
export const saveFeedback = async (...args: Parameters<IMemoryProvider["saveFeedback"]>) => (await getDb()).saveFeedback(...args);
export const getFeedbackSummary = async (...args: Parameters<IMemoryProvider["getFeedbackSummary"]>) => (await getDb()).getFeedbackSummary(...args);
export const saveJudgment = async (...args: Parameters<IMemoryProvider["saveJudgment"]>) => (await getDb()).saveJudgment(...args);
export const getLatestJudgments = async (...args: Parameters<IMemoryProvider["getLatestJudgments"]>) => (await getDb()).getLatestJudgments(...args);
export const getMemoriesSince = async (...args: Parameters<IMemoryProvider["getMemoriesSince"]>) => (await getDb()).getMemoriesSince(...args);
export const getJudgmentsSince = async (...args: Parameters<IMemoryProvider["getJudgmentsSince"]>) => (await getDb()).getJudgmentsSince(...args);
export const addReminder = async (...args: Parameters<IMemoryProvider["addReminder"]>) => (await getDb()).addReminder(...args);
export const getPendingReminders = async (...args: Parameters<IMemoryProvider["getPendingReminders"]>) => (await getDb()).getPendingReminders(...args);
export const updateReminderStatus = async (...args: Parameters<IMemoryProvider["updateReminderStatus"]>) => (await getDb()).updateReminderStatus(...args);
export const listReminders = async (...args: Parameters<IMemoryProvider["listReminders"]>) => (await getDb()).listReminders(...args);
export const cancelReminder = async (...args: Parameters<IMemoryProvider["cancelReminder"]>) => (await getDb()).cancelReminder(...args);
export const snapshotState = async (...args: Parameters<IMemoryProvider["snapshotState"]>) => (await getDb()).snapshotState(...args);
export const getLatestState = async (...args: Parameters<IMemoryProvider["getLatestState"]>) => (await getDb()).getLatestState(...args);
