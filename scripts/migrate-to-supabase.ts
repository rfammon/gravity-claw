/**
 * One-time migration script: SQLite → Supabase
 *
 * Reads all data from the local SQLite database and inserts it into Supabase.
 * Run from the project root: npx tsx scripts/migrate-to-supabase.ts
 */

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as os from "os";
import dotenv from "dotenv";

dotenv.config();

// ── Config ───────────────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
const DB_PATH = path.join(GRAVITY_DIR, "memory.sqlite");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env first");
    process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ── Helpers ──────────────────────────────────────────────────────────
async function migrateTable(table: string, columns: string[], renamedCols?: Record<string, string>) {
    console.log(`\n📦 Migrating ${table}...`);

    const rows = db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as any[];
    console.log(`   Found ${rows.length} rows`);

    if (rows.length === 0) return 0;

    // Rename columns if needed (e.g., timestamp → created_at)
    const transformed = rows.map((row) => {
        const newRow: any = {};
        for (const col of columns) {
            const targetCol = renamedCols?.[col] || col;
            newRow[targetCol] = row[col];
        }
        return newRow;
    });

    // Batch insert in chunks of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < transformed.length; i += BATCH) {
        const batch = transformed.slice(i, i + BATCH);
        const { error } = await supabase.from(table).upsert(batch, { ignoreDuplicates: true });
        if (error) {
            console.error(`   ❌ Error at batch ${i}: ${error.message}`);
        } else {
            inserted += batch.length;
        }
    }

    console.log(`   ✅ Inserted ${inserted}/${rows.length} rows`);
    return inserted;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
    console.log("🚀 Gravity Claw — SQLite → Supabase Migration");
    console.log(`   Source: ${DB_PATH}`);
    console.log(`   Target: ${supabaseUrl}`);
    console.log("═".repeat(50));

    const results: Record<string, number> = {};

    // 1. Memories
    results.memories = await migrateTable(
        "memories",
        ["chat_id", "role", "content", "metadata", "timestamp"],
        { timestamp: "created_at" }
    );

    // 2. Facts
    results.facts = await migrateTable(
        "facts",
        ["chat_id", "key", "value", "updated_at"]
    );

    // 3. Bot Messages
    results.bot_messages = await migrateTable(
        "bot_messages",
        ["message_id", "chat_id", "response_text", "timestamp"],
        { timestamp: "created_at" }
    );

    // 4. Feedback
    results.feedback = await migrateTable(
        "feedback",
        ["chat_id", "message_id", "bot_response", "signal", "emoji", "timestamp"],
        { timestamp: "created_at" }
    );

    // Summary
    console.log("\n" + "═".repeat(50));
    console.log("📊 Migration Summary:");
    for (const [table, count] of Object.entries(results)) {
        console.log(`   ${table}: ${count} rows`);
    }
    console.log("\n✅ Migration complete! You can now set SUPABASE_URL in .env to enable cloud mode.");
}

main().catch(console.error);
