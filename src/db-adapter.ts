/**
 * Universal Database Adapter
 * 
 * Provides a unified SQLite interface that works across all platforms:
 * - better-sqlite3: Native, fast (Linux/Windows/macOS)
 * - sql.js: Pure JavaScript fallback (Android/Termux)
 * 
 * Automatically selects the best available backend.
 */

import * as fs from "fs";
import * as path from "path";
import { getDataDir, ensureDataDir, getPlatformInfo } from "./platform.js";

const DB_FILE = "memory.sqlite";

export interface DatabaseAdapter {
  type: "better-sqlite3" | "sql.js";
  exec(sql: string): void;
  prepare(sql: string): StatementAdapter;
  close(): void;
  transaction?<T>(fn: () => T): T;
}

export interface StatementAdapter {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

let db: DatabaseAdapter | null = null;

/**
 * Initialize the database with the best available backend
 */
export async function initDatabase(): Promise<DatabaseAdapter> {
  if (db) {
    return db;
  }

  const dataDir = ensureDataDir();
  const dbPath = path.join(dataDir, DB_FILE);
  const platformInfo = await getPlatformInfo();

  if (platformInfo.hasNativeSqlite) {
    console.log("💾 Using better-sqlite3 (native)");
    db = await createBetterSqliteAdapter(dbPath);
  } else {
    console.log("💾 Using sql.js (pure JS fallback)");
    db = await createSqlJsAdapter(dbPath);
  }

  // Initialize schema
  initSchema(db);

  return db;
}

/**
 * Create better-sqlite3 adapter
 */
async function createBetterSqliteAdapter(dbPath: string): Promise<DatabaseAdapter> {
  const Database = (await import("better-sqlite3")).default;
  const nativeDb = new Database(dbPath, { verbose: console.log });

  return {
    type: "better-sqlite3",
    exec: (sql) => nativeDb.exec(sql),
    prepare: (sql) => {
      const stmt = nativeDb.prepare(sql);
      return {
        run: (...params) => stmt.run(...params) as RunResult,
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params) as unknown[]
      };
    },
    close: () => nativeDb.close(),
    transaction: <T>(fn: () => T) => nativeDb.transaction(fn)() as T
  };
}

/**
 * Create sql.js adapter (pure JavaScript, works everywhere)
 */
async function createSqlJsAdapter(dbPath: string): Promise<DatabaseAdapter> {
  // @ts-ignore - sql.js is an optional dependency
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();

  // Load existing database or create new
  let dbData: Uint8Array | undefined;
  if (fs.existsSync(dbPath)) {
    dbData = fs.readFileSync(dbPath);
  }

  const sqlDb = new SQL.Database(dbData);

  // Save to disk on changes
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  const saveDb = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      const data = sqlDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }, 1000); // Debounce saves
  };

  return {
    type: "sql.js",
    exec: (sql) => {
      sqlDb.run(sql);
      saveDb();
    },
    prepare: (sql) => {
      return {
        run: (...params) => {
          sqlDb.run(sql, params as string[]);
          saveDb();
          const lastId = (sqlDb.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) || 0;
          return { changes: 1, lastInsertRowid: lastId };
        },
        get: (...params) => {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params as string[]);
          if (stmt.step()) {
            const columns = stmt.getColumnNames();
            const values = stmt.get();
            const result: Record<string, unknown> = {};
            columns.forEach((col: string, i: number) => {
              result[col] = values[i];
            });
            stmt.free();
            return result;
          }
          stmt.free();
          return undefined;
        },
        all: (...params) => {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params as string[]);
          const results: Record<string, unknown>[] = [];
          const columns = stmt.getColumnNames();
          while (stmt.step()) {
            const values = stmt.get();
            const row: Record<string, unknown> = {};
            columns.forEach((col: string, i: number) => {
              row[col] = values[i];
            });
            results.push(row);
          }
          stmt.free();
          return results;
        }
      };
    },
    close: () => {
      const data = sqlDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
      sqlDb.close();
    }
  };
}

/**
 * Initialize database schema
 */
function initSchema(database: DatabaseAdapter): void {
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS bot_messages (
      message_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      response_text TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, message_id)
    )`,
    `CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      bot_response TEXT,
      signal TEXT NOT NULL,
      emoji TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_judgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK( type IN ('daily', 'weekly') ),
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      opinion TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT,
      reminder_text TEXT NOT NULL,
      remind_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS interaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic TEXT,
      tools_used TEXT,
      feedback_signal TEXT,
      response_length INTEGER,
      emotional_state TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS mental_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      state_data TEXT NOT NULL,
      reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_memories_chat_id ON memories(chat_id)`,
    `CREATE INDEX IF NOT EXISTS idx_facts_chat_id ON facts(chat_id)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_chat_id ON feedback(chat_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)`
  ];

  let hasError = false;
  for (const statement of schemaStatements) {
    try {
      database.exec(statement);
    } catch (err) {
      console.error(`❌ Failed to execute schema statement:\n${statement}\nError:`, err);
      hasError = true;
    }
  }

  // Gracefully add columns to existing local tables
  try {
    database.exec(`ALTER TABLE reminders ADD COLUMN user_id TEXT`);
  } catch (e) {
    // Ignore: column already exists
  }

  try {
    database.exec(`ALTER TABLE reminders ADD COLUMN metadata TEXT`);
  } catch (e) {
    // Ignore: column already exists
  }

  if (!hasError) {
    console.log("✅ Database schema initialized");
  } else {
    console.warn("⚠️ Database schema initialized with errors.");
  }
}

/**
 * Get the database instance
 */
export function getDatabase(): DatabaseAdapter {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Close the database
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log("💾 Database closed");
  }
}
