import { addReminder, getPendingReminders, updateReminderStatus } from "./db-provider.js";
import { sendTelegramMessage } from "./telegram-utils.js";
import { porter } from "./porter-agent.js";
import { isCalendarConfigured, createCalendarEvent } from "./google-calendar.js";

/**
 * Reminders Manager
 * Logic for adding, polling, and calendar-syncing reminders.
 */

export async function createReminder(chatId: string, userId: number, text: string, remindAt: Date) {
    console.log(`📝 Creating reminder for ${chatId} at ${remindAt.toISOString()}: ${text}`);
    await addReminder(chatId, userId, text, remindAt);

    // Auto-sync with Google Calendar (best-effort, never block reminder creation)
    if (isCalendarConfigured()) {
        try {
            const event = await createCalendarEvent({
                summary: `🔔 ${text}`,
                description: `Lembrete do Megamind (chat: ${chatId})`,
                start: remindAt,
                durationMinutes: 30,
            });
            console.log(`📅 Reminder synced to Calendar: ${event.id}`);
        } catch (calErr) {
            console.warn(`⚠️ Calendar sync failed (reminder still created):`, calErr instanceof Error ? calErr.message : calErr);
        }
    }
}

export async function pollReminders() {
    const now = new Date();
    const pending = await getPendingReminders();

    if (pending.length === 0) return;

    console.log(`🔔 Found ${pending.length} pending reminders to send.`);

    for (const reminder of pending) {
        try {
            // 1. Send Telegram Notification
            await sendTelegramMessage(reminder.chat_id, `⏰ *LEMBRETE:* ${reminder.reminder_text}`);

            // 2. Call local "Porteiro" for local execution/logging
            try {
                const porterResponse: any = await porter.notify(reminder.reminder_text, reminder.id);
                const textOutput = typeof porterResponse === 'string' ? porterResponse :
                    porterResponse?.content || JSON.stringify(porterResponse);
                console.log(`🤖 Porter said: ${textOutput}`);
            } catch (pErr) {
                console.warn(`⚠️ Porter execution failed:`, pErr);
            }

            // 3. Update Status
            await updateReminderStatus(reminder.id, "completed");
            console.log(`✅ Sent and processed reminder [${reminder.id}] to ${reminder.chat_id}`);
        } catch (err) {
            console.error(`❌ Failed to send reminder [${reminder.id}]:`, err);
        }
    }
}
