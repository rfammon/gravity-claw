import { getClient } from "./supabase-db.ts";

async function checkSupabase() {
    console.log("🔍 Checking Supabase connectivity...");
    try {
        const client = getClient();
        console.log("✅ Client initialized");

        console.log("📡 Testing query on 'memories' table...");
        const { data, error } = await client
            .from("memories")
            .select("id")
            .limit(1);

        if (error) {
            console.error("❌ Query failed:", error.message);
            if (error.message.includes("fetch")) {
                console.error("👉 This usually means a NETWORK problem (no internet or blocked connection).");
            }
            return;
        }

        console.log("✅ Query successful!");
        console.log("📊 Data received:", JSON.stringify(data));
        console.log("\n🚀 EVERYTHING LOOKS GOOD! The bot should be able to access its memory now.");
    } catch (err) {
        console.error("💥 Unexpected error:", err instanceof Error ? err.message : String(err));
    }
}

checkSupabase();
