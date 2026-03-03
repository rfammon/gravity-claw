import { getClient } from "../supabase-db.js";
import { getDb } from "../db-provider.js";
import { rag } from "../rag-provider.js";
import { config } from "../config.js";

/**
 * Syncs factual memories from all sources into the local LanceDB.
 * Sources:
 * 1. Supabase 'factual_memories' table (cloud vector)
 * 2. Supabase 'facts' table (cloud structured)
 * 3. Local SQLite 'facts' table (local structured)
 */
async function syncAll() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔄 STARTING TOTAL MEMORY SYNC");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const db = await getDb();
    
    // 1. Sync from Supabase factual_memories (Vector Cloud)
    if (config.supabaseUrl && config.supabaseServiceKey) {
        console.log("☁️  Checking Supabase Cloud Vector DB...");
        try {
            const { data: cloudVector, error } = await getClient()
                .from("factual_memories")
                .select("*");
            
            if (!error && cloudVector && cloudVector.length > 0) {
                console.log(`📦 Found ${cloudVector.length} vector records in Supabase.`);
                for (const fact of cloudVector) {
                    await rag.addFact(fact.chat_id, fact.content, { 
                        ...fact.metadata, 
                        synced_from: "supabase_vector",
                        original_id: fact.id 
                    });
                }
                console.log("✅ Cloud vectors synced.");
            }
        } catch (e) {
            console.warn("⚠️ Supabase Vector sync failed (skipped):", e);
        }

        // 2. Sync from Supabase facts (Structured Cloud)
        console.log("☁️  Checking Supabase Cloud Structured Facts...");
        try {
            const { data: cloudFacts, error } = await getClient()
                .from("facts")
                .select("*");
            
            if (!error && cloudFacts && cloudFacts.length > 0) {
                console.log(`📦 Found ${cloudFacts.length} structured facts in Supabase.`);
                for (const f of cloudFacts) {
                    const content = `${f.key}: ${f.value}`;
                    await rag.addFact(f.chat_id, content, { 
                        type: "structured_fact",
                        synced_from: "supabase_facts"
                    });
                }
                console.log("✅ Cloud structured facts synced.");
            }
        } catch (e) {
            console.warn("⚠️ Supabase Facts sync failed (skipped):", e);
        }
    }

    // 3. Sync from Local SQLite facts
    console.log("💾 Checking Local SQLite Structured Facts...");
    try {
        // We need to get all chat_ids first if possible, or just use a known list
        // Since getFacts requires a chatId, we'll try to get all chatIds from interaction log
        const chatIds = new Set<string>();
        
        // Try to find chat_ids in memories if possible
        if (db.backend === "sqlite") {
            // Note: This is a bit of a hack since our interface doesn't expose all chatIds
            // But we can try to use a dummy ID or common ones
            console.log("ℹ️ Fetching structured facts from local SQLite backend.");
            // In a real scenario, we'd query the 'facts' table directly.
            // For now, we'll suggest running this script in an environment where 
            // the user can provide the chatId or we've found it.
            
            // Defaulting to a few common test IDs or the ones from the config if any
            const targetIds = config.allowedUserIds.map(String);
            for (const cid of targetIds) {
                const localFacts = await db.getFacts(cid);
                const keys = Object.keys(localFacts);
                if (keys.length > 0) {
                    console.log(`📦 Found ${keys.length} local facts for chat ${cid}.`);
                    for (const k of keys) {
                        const content = `${k}: ${localFacts[k]}`;
                        await rag.addFact(cid, content, { 
                            type: "structured_fact",
                            synced_from: "local_sqlite"
                        });
                    }
                }
            }
        }
        console.log("✅ Local facts processing complete.");
    } catch (e) {
        console.warn("⚠️ Local facts sync failed:", e);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ TOTAL SYNC COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(0);
}

syncAll().catch(err => {
    console.error("❌ Fatal sync error:", err);
    process.exit(1);
});
