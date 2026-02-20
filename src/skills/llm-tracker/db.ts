import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const DB_PATH = path.join(GRAVITY_DIR, "llm_tracker.sqlite");

let db: Database.Database;
try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
} catch (error) {
    console.error("❌ Failed to open LLM tracker database:", error);
    throw error;
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    content_snippet TEXT,
    curated_summary TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    reported BOOLEAN DEFAULT 0
  );
`);

export interface NewsItem {
    id?: number;
    source: string;
    title: string;
    url: string;
    content_snippet: string;
    curated_summary?: string;
    timestamp?: string;
    reported?: boolean;
}

export function isUrlProcessed(url: string): boolean {
    const stmt = db.prepare("SELECT 1 FROM llm_news WHERE url = ?");
    return stmt.get(url) !== undefined;
}

export function insertNews(news: NewsItem): void {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO llm_news (source, title, url, content_snippet, curated_summary, reported)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        news.source,
        news.title,
        news.url,
        news.content_snippet,
        news.curated_summary || null,
        news.reported ? 1 : 0
    );
}

export function getUnreportedNews(): NewsItem[] {
    const stmt = db.prepare("SELECT * FROM llm_news WHERE reported = 0 ORDER BY timestamp ASC");
    return stmt.all() as NewsItem[];
}

export function markNewsAsReported(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const stmt = db.prepare(`UPDATE llm_news SET reported = 1 WHERE id IN (${placeholders})`);
    stmt.run(...ids);
}
