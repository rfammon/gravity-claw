import { addReminder, getPendingReminders, updateReminderStatus } from "./db-provider.js";
import { sendTelegramMessage } from "./telegram-utils.js";

/**
 * Reminders Manager
 * Logic for adding and polling reminders.
 */

export async function createReminder(chatId: string, userId: number, text: string, remindAt: Date) {
    console.log(`📝 Creating reminder for ${chatId} at ${remindAt.toISOString()}: ${text}`);
    await addReminder(chatId, userId, text, remindAt);
}

export async function pollReminders() {
    const now = new Date();
    const pending = await getPendingReminders();

    if (pending.length === 0) return;

    console.log(`🔔 Found ${pending.length} pending reminders to send.`);

    for (const reminder of pending) {
        try {
            await sendTelegramMessage(reminder.chat_id, `⏰ *LEMBRETE:* ${reminder.reminder_text}`);
            await updateReminderStatus(reminder.id, "completed");
            console.log(`✅ Sent reminder [${reminder.id}] to ${reminder.chat_id}`);
        } catch (err) {
            console.error(`❌ Failed to send reminder [${reminder.id}]:`, err);
        }
    }
}
