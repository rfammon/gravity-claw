import { getClient } from "../src/supabase-db.js";

async function checkTables() {
    console.log("🔍 Verificação profunda de tabelas...");
    try {
        console.log("🛠️ Listando tabelas via rpc (se possível) ou query direta...");
        const { data, error } = await getClient()
            .from("reminders")
            .select("*")
            .limit(1);

        if (error) {
            console.log("❌ Erro em 'reminders':", error.message);
        } else {
            console.log("✅ Tabela 'reminders' está visível e acessível.");
        }

        const { data: memData, error: memError } = await getClient()
            .from("memories")
            .select("*")
            .limit(1);

        if (memError) {
            console.log("❌ Erro em 'memories':", memError.message);
        } else {
            console.log("✅ Tabela 'memories' está visível.");
        }

    } catch (err) {
        console.error("💥 ERRO FATAL:", err);
    }
}

checkTables();
