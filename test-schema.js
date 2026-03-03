import Database from 'better-sqlite3';
const db = new Database(':memory:');

try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
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
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      reminder_text TEXT NOT NULL,
      remind_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_memories_chat_id ON memories(chat_id);
    CREATE INDEX IF NOT EXISTS idx_facts_chat_id ON facts(chat_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_chat_id ON feedback(chat_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
  `);
    console.log("Schema OK");

    const stmt = db.prepare("SELECT * FROM reminders WHERE status = 'pending'");
    console.log("Select OK", stmt.all());
} catch (e) {
    console.error("Error:", e);
}
