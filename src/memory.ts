import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Use a stable absolute path in the user's home directory to avoid project folder corruption
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const DB_PATH = path.join(GRAVITY_DIR, "memory.sqlite");

console.log(`📂 Database path: ${DB_PATH}`);

let db: Database.Database;
try {
    db = new Database(DB_PATH, { verbose: console.log });
} catch (error) {
    console.error("❌ Failed to open database:", error);
    // Fallback or retry logic could go here, but let's try to fix the path first
    throw error;
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT -- JSON string for extra info
  );

  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, key)
  );

  CREATE TABLE IF NOT EXISTS bot_messages (
    message_id INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    response_text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    bot_response TEXT,
    signal TEXT NOT NULL,
    emoji TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_judgments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK( type IN ('daily', 'weekly') ),
    period_start DATETIME NOT NULL,
    period_end DATETIME NOT NULL,
    opinion TEXT NOT NULL,
    emotional_state TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS interaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    topic TEXT,
    tools_used TEXT,
    feedback_signal TEXT,
    response_length INTEGER,
    emotional_state TEXT
  );
`);

export interface MemoryEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp?: string;
}

export function saveMessage(chatId: string, role: string, content: string, metadata?: any): void {
    const stmt = db.prepare("INSERT INTO memories (chat_id, role, content, metadata) VALUES (?, ?, ?, ?)");
    stmt.run(chatId, role, content, metadata ? JSON.stringify(metadata) : null);
}

export function getChatHistory(chatId: string, limit: number = 50): MemoryEntry[] {
    const stmt = db.prepare("SELECT role, content, timestamp FROM memories WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?");
    const rows = stmt.all(chatId, limit) as any[];
    return rows.reverse().map(row => ({
        role: row.role as any,
        content: row.content,
        timestamp: row.timestamp
    }));
}

export function storeFact(chatId: string, key: string, value: string): void {
    const stmt = db.prepare(`
        INSERT INTO facts (chat_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(chatId, key, value);
}

export function getFacts(chatId: string): Record<string, string> {
    const stmt = db.prepare("SELECT key, value FROM facts WHERE chat_id = ?");
    const rows = stmt.all(chatId) as any[];
    const facts: Record<string, string> = {};
    rows.forEach(row => {
        facts[row.key] = row.value;
    });
    return facts;
}

export function clearHistory(chatId: string): void {
    const stmt = db.prepare("DELETE FROM memories WHERE chat_id = ?");
    stmt.run(chatId);
}

// ── Feedback / Reinforcement System ──────────────────────

export function trackBotMessage(chatId: string, messageId: number, responseText: string): void {
    const stmt = db.prepare(
        "INSERT OR REPLACE INTO bot_messages (message_id, chat_id, response_text) VALUES (?, ?, ?)"
    );
    // Truncate to 500 chars to save space — enough context for feedback
    stmt.run(messageId, chatId, responseText.substring(0, 500));
}

export function saveFeedback(chatId: string, messageId: number, signal: string, emoji: string): void {
    // Look up what the bot said in that message
    const lookup = db.prepare("SELECT response_text FROM bot_messages WHERE chat_id = ? AND message_id = ?");
    const row = lookup.get(chatId, messageId) as { response_text: string } | undefined;
    const botResponse = row?.response_text ?? "(unknown message)";

    const stmt = db.prepare(
        "INSERT INTO feedback (chat_id, message_id, bot_response, signal, emoji) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(chatId, messageId, botResponse, signal, emoji);
    console.log(`📊 Feedback saved: ${emoji} (${signal}) on message ${messageId}`);
}

export function getFeedbackSummary(chatId: string): string {
    // Get recent feedback (last 20 entries)
    const stmt = db.prepare(
        "SELECT bot_response, signal, emoji, timestamp FROM feedback WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 20"
    );
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
}

// ── Judgment Memory (Bot's Diary) ────────────────────────

export function saveJudgment(chatId: string, type: "daily" | "weekly", opinion: string, periodStart: string, periodEnd: string): void {
    const stmt = db.prepare(`
        INSERT INTO user_judgments (chat_id, type, opinion, period_start, period_end) 
        VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(chatId, type, opinion, periodStart, periodEnd);
    console.log(`🧠 Judgment saved (${type}) for ${chatId}`);
}

export function getLatestJudgments(chatId: string): string {
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
}

export function getMemoriesSince(chatId: string, sinceDateISO: string): MemoryEntry[] {
    const stmt = db.prepare("SELECT role, content, timestamp FROM memories WHERE chat_id = ? AND timestamp >= ? ORDER BY timestamp ASC");
    const rows = stmt.all(chatId, sinceDateISO) as any[];
    return rows.map((row) => ({
        role: row.role as any,
        content: row.content,
        timestamp: row.timestamp
    }));
}

export function getJudgmentsSince(chatId: string, type: "daily", sinceDateISO: string): { opinion: string; timestamp: string }[] {
    const stmt = db.prepare("SELECT opinion, timestamp FROM user_judgments WHERE chat_id = ? AND type = ? AND timestamp >= ? ORDER BY timestamp ASC");
    return stmt.all(chatId, type, sinceDateISO) as any[];
}

// ── Interaction Log (Fase 1.3 — Diário de Bordo) ──────────────────

export interface InteractionLogEntry {
    topic?: string;
    toolsUsed?: string[];
    feedbackSignal?: string;
    responseLength?: number;
    emotionalState?: string;
}

export function saveInteractionLog(chatId: string, entry: InteractionLogEntry): void {
    const stmt = db.prepare(`
        INSERT INTO interaction_log (chat_id, topic, tools_used, feedback_signal, response_length, emotional_state)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        chatId,
        entry.topic ?? null,
        entry.toolsUsed ? JSON.stringify(entry.toolsUsed) : null,
        entry.feedbackSignal ?? null,
        entry.responseLength ?? null,
        entry.emotionalState ?? null,
    );
}

export function getInteractionLogs(chatId: string, limit: number = 20): (InteractionLogEntry & { timestamp: string })[] {
    const stmt = db.prepare(
        "SELECT topic, tools_used, feedback_signal, response_length, emotional_state, timestamp FROM interaction_log WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?"
    );
    const rows = stmt.all(chatId, limit) as any[];
    return rows.map(row => ({
        topic: row.topic,
        toolsUsed: row.tools_used ? JSON.parse(row.tools_used) : [],
        feedbackSignal: row.feedback_signal,
        responseLength: row.response_length,
        emotionalState: row.emotional_state,
        timestamp: row.timestamp,
    }));
}

