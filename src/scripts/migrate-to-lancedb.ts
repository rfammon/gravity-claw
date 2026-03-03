import { getClient } from "../supabase-db.js";
import { lanceProvider } from "../lance-provider.js";

/**
 * Migration script to move factual memories from Supabase to LanceDB.
 */
async function migrate() {
    console.log("🚀 Starting migration from Supabase to LanceDB...");
    
    try {
        const { data: facts, error } = await getClient()
            .from("factual_memories")
            .select("*");
            
        if (error) {
            console.error("❌ Error fetching from Supabase:", error);
            return;
        }
        
        if (!facts || facts.length === 0) {
            console.log("ℹ️ No facts found in Supabase.");
            return;
        }
        
        console.log(`📦 Found ${facts.length} facts. Migrating...`);
        
        const formatted = facts.map(f => ({
            chat_id: String(f.chat_id),
            content: f.content,
            vector: f.embedding,
            metadata: JSON.stringify(f.metadata || {}),
            created_at: f.created_at || new Date().toISOString()
        }));
        
        await lanceProvider.addData("factual_memories", formatted);
        
        console.log("✅ Migration complete!");
    } catch (err) {
        console.error("❌ Migration failed:", err);
    }
}

migrate();
