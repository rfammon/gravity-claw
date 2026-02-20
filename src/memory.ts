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
