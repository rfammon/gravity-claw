import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram-utils.js";
import { generateDailyJudgment, generateWeeklyJudgment } from "./judgment.js";
import * as db from "./finance/finance-db.js";
import * as calc from "./finance/finance-calculator.js";
import { generateCategoryChartUrl } from "./finance/finance-charts.js";
import { runCurationCycle, generateDailyReport } from "./skills/llm-tracker/index.js";
import { pollReminders } from "./reminders.js";

/**
 * Scheduled Tasks System
 * Satisfies: 3. Scheduled Tasks
 */
class Scheduler {
    private tasks: Map<string, cron.ScheduledTask> = new Map();
    private defaultTimezone = "America/Sao_Paulo";

    schedule(id: string, expression: string, task: () => void, timezone?: string) {
        if (this.tasks.has(id)) {
            this.tasks.get(id)?.stop();
        }

        const options = {
            scheduled: true,
            timezone: timezone || this.defaultTimezone
        };

        const job = cron.schedule(expression, task, options);
        this.tasks.set(id, job);
        console.log(`⏰ Task [${id}] scheduled with: ${expression} (${options.timezone})`);
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
export function setupDefaultTasks(chatId: string) {
    // Morning Briefing (8 AM)
    scheduler.schedule(`${chatId}_morning`, "0 8 * * *", async () => {
        const briefing = await runAgent(chatId, "Generate a morning briefing with weather, news, and today's schedule.");
        await sendTelegramMessage(chatId, briefing.text);
        console.log(`🌞 Morning briefing for ${chatId} sent.`);
    });

    // Evening Recap (9 PM)
    scheduler.schedule(`${chatId}_evening`, "0 21 * * *", async () => {
        const recap = await runAgent(chatId, "Generate an evening recap of today's tasks and messages.");
        await sendTelegramMessage(chatId, recap.text);
        console.log(`🌙 Evening recap for ${chatId} sent.`);
    });

    // ── Finance Scheduled Tasks ──────────────────────────────────────
    scheduler.schedule(`${chatId}_finance_alerts`, "0 9 * * *", async () => {
        try {
            const prompt = `Atue como meu assistente financeiro proativo. Verifique se há contas vencendo hoje ou nos próximos 3 dias (use finance_calendar). Se houver, mande um alerta curto, amigável mas urgente, avisando sobre os valores e nomes das contas para eu não esquecer de pagar.`;
            const result = await runAgent(chatId, prompt);
            await sendTelegramMessage(chatId, result.text);
            console.log(`💰 Finance alerts sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Finance alert error for ${chatId}:`, err);
        }
    });

    // Monthly financial summary (1st at 10 AM)
    scheduler.schedule(`${chatId}_finance_monthly`, "0 10 1 * *", async () => {
        try {
            await sendTelegramMessage(chatId, "📊 *Gerando seu Resumo Financeiro Mensal...*");
            const prompt = `Gere o resumo financeiro completo do mês passado usando finance_monthly_summary.`;
            const aiText = await runAgent(chatId, prompt);

            let photoUrl = "";
            try {
                const now = new Date();
                let targetYear = now.getFullYear();
                let targetMonth = now.getMonth();
                if (targetMonth === 0) { targetMonth = 12; targetYear--; }

                const [fixed, variable, subs, expenses] = await Promise.all([
                    db.listRecurringFixed(chatId),
                    db.listRecurringVariable(chatId),
                    db.listSubscriptions(chatId),
                    db.getMonthExpenses(chatId, targetYear, targetMonth),
                ]);

                const breakdownRecord = calc.categoryBreakdown(fixed, variable, subs, expenses);
                const breakdownArr = Object.entries(breakdownRecord).map(([cat, val]) => ({ category: cat, amount: val }));
                const filteredBreakdown = breakdownArr.filter(c => c.amount > 0);
                photoUrl = generateCategoryChartUrl(filteredBreakdown, `Resumo: Mês ${targetMonth}/${targetYear}`);
            } catch (chartErr) {
                console.warn(`⚠️ Could not generate chart:`, chartErr);
            }

            if (photoUrl) await sendTelegramPhoto(chatId, photoUrl, "Distribuição dos seus gastos ☝️");
            await sendTelegramMessage(chatId, aiText.text);
        } catch (err) {
            console.error(`❌ Monthly summary error:`, err);
        }
    });

    // ── Judgment Scheduled Tasks ──────────────────────────────────────
    scheduler.schedule(`${chatId}_daily_judgment`, "50 23 * * *", async () => {
        try {
            await generateDailyJudgment(chatId);
            console.log(`🧠 Daily judgment for ${chatId} generated.`);
        } catch (err) {
            console.error(`❌ Daily judgment error:`, err);
        }
    });

    scheduler.schedule(`${chatId}_weekly_judgment`, "55 23 * * 0", async () => {
        try {
            await generateWeeklyJudgment(chatId);
            console.log(`🧠 Weekly judgment for ${chatId} generated.`);
        } catch (err) {
            console.error(`❌ Weekly judgment error:`, err);
        }
    });
}

// ── Global System Tasks ─────────────────────────────────────────────
export function setupGlobalTasks() {
    // LLM Tracker: Curate every 2 hours
    scheduler.schedule("global_llm_tracker_curate", "0 */2 * * *", async () => {
        try {
            await runCurationCycle();
        } catch (err) {
            console.error(`❌ Global LLM Tracker curate error:`, err);
        }
    });

    // LLM Tracker: Daily report at 9 AM
    scheduler.schedule("global_llm_tracker_report", "0 9 * * *", async () => {
        try {
            await generateDailyReport();
        } catch (err) {
            console.error(`❌ Global LLM Tracker report error:`, err);
        }
    });

    // ── Reminder Polling: Every 1 minute ──
    scheduler.schedule("global_reminder_polling", "* * * * *", async () => {
        try {
            await pollReminders();
        } catch (err) {
            console.error(`❌ Reminder polling error:`, err);
        }
    });
}
