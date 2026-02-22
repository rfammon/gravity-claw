import { getClient } from "../src/supabase-db.js";

async function createRemindersTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS reminders (
            id BIGSERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            user_id BIGINT NOT NULL,
            reminder_text TEXT NOT NULL,
            remind_at TIMESTAMPTZ NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            metadata JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_reminders_chat_id ON reminders(chat_id);
    `;

    console.log("🚀 Executing migration for 'reminders' table...");

    try {
        const client = getClient();

        // Try executing using RPC 'exec_sql' if available
        const { error } = await client.rpc("exec_sql", { sql });

        if (error) {
            console.error("❌ Migration failed via RPC:", error.message);
            console.log("👉 You might need to create this table manually in the Supabase Dashboard SQL Editor:");
            console.log(sql);
        } else {
            console.log("✅ Migration successful!");
        }
    } catch (err) {
        console.error("💥 Unexpected error:", err instanceof Error ? err.message : String(err));
    }
}

createRemindersTable();
