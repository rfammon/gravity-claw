import { createReminder, pollReminders } from "../src/reminders.js";
import { getDb } from "../src/db-provider.js";
import * as fs from "node:fs";

console.log("🟢 Início do script de verificação");

async function verifyReminders() {
    console.log("🔍 Verificando sistema de lembretes...");

    try {
        // Garantir que o banco está inicializado
        console.log("🛠️ Inicializando banco de dados...");
        await getDb();
        console.log("✅ Banco de dados pronto.");

        const chatId = "6666022588";
        const userId = 6666022588;
        const text = "Teste de Lembrete - Antigravity " + new Date().toLocaleTimeString();
        const remindAt = new Date(Date.now() + 5000);

        console.log(`🚀 Criando lembrete de teste para as ${remindAt.toISOString()}...`);
        await createReminder(chatId, userId, text, remindAt);
        console.log("✅ Lembrete criado no banco.");

        console.log("⏳ Aguardando 10 segundos para o polling...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log("📡 Executando pollReminders()...");
        await pollReminders();

        console.log("✅ Verificação finalizada com sucesso!");
    } catch (err: any) {
        console.error("💥 ERRO CAPTURADO:", err);
        const errorMsg = err instanceof Error ? err.stack : String(err);
        fs.writeFileSync("verify_error.log", errorMsg || "Unknown error");
        process.exit(1);
    }
}

try {
    await verifyReminders();
    console.log("🔚 Script encerrado.");
    process.exit(0);
} catch (e: any) {
    fs.writeFileSync("verify_fatal.log", e.stack || String(e));
    process.exit(1);
}
