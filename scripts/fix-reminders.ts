import { createReminder } from "../src/reminders.js";
import { config } from "../src/config.js";

/**
 * Script to fix missing reminders for Rafael.
 * Usage: tsx scripts/fix-reminders.ts
 */
async function fix() {
    console.log("🛠️ Starting reminder fix script...");

    if (config.allowedUserIds.length === 0) {
        console.error("❌ No allowedUserIds found in config.");
        return;
    }

    const rafaelUserId = config.allowedUserIds[0];
    const chatId = String(rafaelUserId); // Assuming chatId is the same as userId for DM

    // Test reminders
    const reminders = [
        { text: "Beber água 🥤", inMinutes: 5 },
        { text: "Verificar status do Gravity Claw 🕵️‍♂️", inMinutes: 30 },
        { text: "Reunião de Alinhamento (Megamente) 🧠", inMinutes: 60 }
    ];

    for (const r of reminders) {
        const date = new Date(Date.now() + r.inMinutes * 60 * 1000);
        console.log(`➕ Scheduling: "${r.text}" for S. Paulo time: ${date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
        await createReminder(chatId, Number(rafaelUserId), r.text, date);
    }

    console.log("✅ Fix script completed. Reminders registered!");
}

fix().catch(err => {
    console.error("❌ Fix script failed:", err);
    process.exit(1);
});
