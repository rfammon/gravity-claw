import cron from "node-cron";
import { runAgent } from "./agent.js";
import { saveMessage } from "./memory.js";

/**
 * Scheduled Tasks System
 * Satisfies: 3. Scheduled Tasks
 */
class Scheduler {
    private tasks: Map<string, cron.ScheduledTask> = new Map();

    schedule(id: string, expression: string, task: () => void) {
        if (this.tasks.has(id)) {
            this.tasks.get(id)?.stop();
        }
        const job = cron.schedule(expression, task);
        this.tasks.set(id, job);
        console.log(`⏰ Task [${id}] scheduled with: ${expression}`);
    }

    stop(id: string) {
        this.tasks.get(id)?.stop();
        this.tasks.delete(id);
    }

    list() {
        return Array.from(this.tasks.keys());
    }
}

export const scheduler = new Scheduler();

// ── Default Proactive Tasks ──────────────────────────────────────────
// Morning Briefing (e.g., at 8 AM)
// Satisfies: 1. Morning Briefing
export function setupDefaultTasks(chatId: string) {
    scheduler.schedule(`${chatId}_morning`, "0 8 * * *", async () => {
        const briefing = await runAgent(chatId, "Generate a morning briefing with weather, news, and today's schedule.");
        // Note: We need a way to send this back to Telegram, 
        // will likely need to export the bot instance or a reply function.
        console.log(`🌞 Morning briefing for ${chatId}: ${briefing.substring(0, 50)}...`);
    });

    // Evening Recap (e.g., at 9 PM)
    // Satisfies: 2. Evening Recap
    scheduler.schedule(`${chatId}_evening`, "0 21 * * *", async () => {
        const recap = await runAgent(chatId, "Generate an evening recap of today's tasks and messages.");
        console.log(`🌙 Evening recap for ${chatId}: ${recap.substring(0, 50)}...`);
    });
}
