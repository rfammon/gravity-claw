import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbfouxrinygecbxmjckg.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_SERVICE_KEY not set");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkAndCreateTables() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 Checking Supabase Tables");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const tables = ["memories", "facts", "bot_messages", "feedback", "user_judgments"];
    const results: Record<string, boolean> = {};

    for (const table of tables) {
        try {
            const { error } = await supabase.from(table).select("count");
            if (error) {
                console.log(`❌ ${table}: ${error.message}`);
                results[table] = false;
            } else {
                console.log(`✅ ${table}: OK`);
                results[table] = true;
            }
        } catch (err) {
            console.log(`❌ ${table}: Error - ${err}`);
            results[table] = false;
        }
    }

    const missingTables = Object.entries(results)
        .filter(([_, exists]) => !exists)
        .map(([table]) => table);

    if (missingTables.length > 0) {
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("⚠️  Missing tables - Creating schema...");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        // Create each table
        for (const table of missingTables) {
            console.log(`Creating ${table}...`);
            await createTable(table);
        }
    }

    // Final check
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Final Status");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    for (const table of tables) {
        const { error } = await supabase.from(table).select("count");
        console.log(`${error ? "❌" : "✅"} ${table}`);
    }
}

async function createTable(table: string) {
    const schemas: Record<string, string> = {
        memories: `
            CREATE TABLE IF NOT EXISTS memories (
                id BIGSERIAL PRIMARY KEY,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                metadata JSONB
            );
            CREATE INDEX IF NOT EXISTS idx_memories_chat_id ON memories(chat_id);
        `,
        facts: `
            CREATE TABLE IF NOT EXISTS facts (
                id BIGSERIAL PRIMARY KEY,
                chat_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(chat_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_facts_chat_id ON facts(chat_id);
        `,
        bot_messages: `
            CREATE TABLE IF NOT EXISTS bot_messages (
                chat_id TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                response_text TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (chat_id, message_id)
            );
        `,
        feedback: `
            CREATE TABLE IF NOT EXISTS feedback (
                id BIGSERIAL PRIMARY KEY,
                chat_id TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                bot_response TEXT,
                signal TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_feedback_chat_id ON feedback(chat_id);
        `,
        user_judgments: `
            CREATE TABLE IF NOT EXISTS user_judgments (
                id BIGSERIAL PRIMARY KEY,
                chat_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('daily', 'weekly')),
                period_start TIMESTAMPTZ NOT NULL,
                period_end TIMESTAMPTZ NOT NULL,
                opinion TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_judgments_chat_id ON user_judgments(chat_id);
        `
    };

    try {
        const { error } = await supabase.rpc("exec_sql", { sql: schemas[table] });
        // RPC might not work, try alternative
        if (error) {
            console.log(`   Note: ${error.message}`);
            console.log(`   Table '${table}' needs manual creation in Supabase dashboard`);
        }
    } catch (err) {
        console.log(`   Note: ${err}`);
    }
}

checkAndCreateTables();
