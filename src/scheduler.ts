import cron from "node-cron";
import { runAgent } from "./agent.js";
import { saveMessage } from "./db-provider.js";
import { sendTelegramMessage, sendTelegramPhoto } from "./bot.js";
import { generateDailyJudgment, generateWeeklyJudgment } from "./judgment.js";
import * as db from "./finance/finance-db.js";
import * as calc from "./finance/finance-calculator.js";
import { generateCategoryChartUrl } from "./finance/finance-charts.js";
import { runCurationCycle, generateDailyReport } from "./skills/llm-tracker/index.js";
import { runProactiveTriggers } from "./proactive-triggers.js";
import { runDynamicTriggers, evolveTriggers } from "./trigger-manager.js";
import { runSATC } from "./satc.js";

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
        try {
            const briefing = await runAgent(chatId, "Generate a morning briefing with weather, news, and today's schedule.");
            await sendTelegramMessage(chatId, briefing.text);
            console.log(`🌞 Morning briefing sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Morning briefing error for ${chatId}:`, err);
        }
    });

    // Evening Recap (e.g., at 9 PM)
    // Satisfies: 2. Evening Recap
    scheduler.schedule(`${chatId}_evening`, "0 21 * * *", async () => {
        try {
            const recap = await runAgent(chatId, "Generate an evening recap of today's tasks and messages.");
            await sendTelegramMessage(chatId, recap.text);
            console.log(`🌙 Evening recap sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Evening recap error for ${chatId}:`, err);
        }
    });

    // ── Finance Scheduled Tasks ──────────────────────────────────────
    // Daily bill alerts at 9 AM — checks for bills due in the next 3 days
    scheduler.schedule(`${chatId}_finance_alerts`, "0 9 * * *", async () => {
        try {
            const prompt = `Atue como meu assistente financeiro proativo. Verifique se há contas vencendo hoje ou nos próximos 3 dias (use finance_calendar). Se houver, mande um alerta curto, amigável mas urgente, avisando sobre os valores e nomes das contas para eu não esquecer de pagar. Se não houver, pode apenas me desejar um bom dia financeiramente tranquilo.`;
            const result = await runAgent(chatId, prompt);
            await sendTelegramMessage(chatId, result.text);
            console.log(`💰 Finance alerts sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Finance alert error for ${chatId}:`, err);
        }
    });

    // Monthly financial summary on the 1st at 10 AM
    scheduler.schedule(`${chatId}_finance_monthly`, "0 10 1 * *", async () => {
        try {
            await sendTelegramMessage(chatId, "📊 *Gerando seu Resumo Financeiro Mensal...*");

            // 1. Get AI Summary & Insights
            const prompt = `Gere o resumo financeiro completo do mês passado usando finance_monthly_summary. Faça uma análise crítica dos meus gastos (em quais categorias eu posso economizar mais?), me informe meu score de saúde financeira, e feche com 3 recomendações ou dicas práticas exclusivas focadas nos meus hábitos recentes de consumo da nossa base de dados. Formate lindamente usando markdown com emojis.`;
            const aiText = await runAgent(chatId, prompt);

            // 2. Try to generate a chart for the previous month
            let photoUrl = "";
            try {
                const now = new Date();
                // We want the previous month
                let targetYear = now.getFullYear();
                let targetMonth = now.getMonth(); // 0-based, so this is previous month (1-12 range)
                if (targetMonth === 0) {
                    targetMonth = 12;
                    targetYear--;
                }

                const [fixed, variable, subs, expenses] = await Promise.all([
                    db.listRecurringFixed(chatId),
                    db.listRecurringVariable(chatId),
                    db.listSubscriptions(chatId),
                    db.getMonthExpenses(chatId, targetYear, targetMonth),
                ]);

                // Get breakdown Record<string, number>
                const breakdownRecord = calc.categoryBreakdown(fixed, variable, subs, expenses);

                // Convert Record<string, number> to array for chart
                const breakdownArr = Object.entries(breakdownRecord).map(([cat, val]) => ({ category: cat, amount: val }));
                // Filter out non-zero categories
                const filteredBreakdown = breakdownArr.filter(c => c.amount > 0);

                photoUrl = generateCategoryChartUrl(filteredBreakdown, `Resumo: Mês ${targetMonth}/${targetYear}`);
            } catch (chartErr) {
                console.warn(`⚠️ Could not generate chart for monthly summary:`, chartErr);
            }

            // 3. Send to user
            if (photoUrl) {
                await sendTelegramPhoto(chatId, photoUrl, "Distribuição dos seus gastos do mês passado ☝️");
            }
            await sendTelegramMessage(chatId, aiText.text);

            console.log(`📊 Monthly finance summary sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Monthly summary error for ${chatId}:`, err);
        }
    });

    // ── Judgment Scheduled Tasks ──────────────────────────────────────
    // Daily Judgment (Bot's Diary) - at 11:50 PM
    scheduler.schedule(`${chatId}_daily_judgment`, "50 23 * * *", async () => {
        try {
            await generateDailyJudgment(chatId);
            console.log(`🧠 Daily judgment generated for ${chatId}`);
        } catch (err) {
            console.error(`❌ Daily judgment error for ${chatId}:`, err);
        }
    });

    // Weekly Judgment Deep Dive - Sunday at 11:55 PM
    scheduler.schedule(`${chatId}_weekly_judgment`, "55 23 * * 0", async () => {
        try {
            await generateWeeklyJudgment(chatId);
            console.log(`🧠 Weekly judgment generated for ${chatId}`);
        } catch (err) {
            console.error(`❌ Weekly judgment error for ${chatId}:`, err);
        }
    });

    // ── Proactive AI Triggers (Dynamic) ────────────────────────────────────
    // Evaluate all dynamic triggers every hour
    scheduler.schedule(`${chatId}_dynamic_triggers`, "0 * * * *", async () => {
        try {
            await runDynamicTriggers(chatId);
        } catch (err) {
            console.error(`❌ Dynamic triggers error for ${chatId}:`, err);
        }
    });

    // Weekly AI trigger evolution — every Sunday at 11:00 PM
    // Analyzes conversations and autonomously creates/modifies/archives triggers
    scheduler.schedule(`${chatId}_trigger_evolution`, "0 23 * * 0", async () => {
        try {
            console.log(`🧬 Starting trigger evolution for ${chatId}...`);
            await evolveTriggers(chatId);
        } catch (err) {
            console.error(`❌ Trigger evolution error for ${chatId}:`, err);
        }
    });

    // Morning Dashboard Briefing at 07:30
    scheduler.schedule(`${chatId}_morning_dashboard`, "30 7 * * *", async () => {
        try {
            const prompt = `Gere um DASHBOARD PROATIVO matinal para o Rafael. Inclua:
1. Saudação dramática no estilo Megamente
2. Mini-resumo de tarefas urgentes (use trello_list_tasks se necessário)
3. Lembretes financeiros se houver contas próximas (finance_calendar)
4. Uma dica motivacional CURTA sobre seus objetivos principais (Petrobras, Gravity Claw)
Formate de forma concisa com emojis. Máximo 15 linhas.`;
            const result = await runAgent(chatId, prompt);
            await sendTelegramMessage(chatId, result.text);
            console.log(`☀️ Morning dashboard sent for ${chatId}`);
        } catch (err) {
            console.error(`❌ Morning dashboard error for ${chatId}:`, err);
        }
    });

    // SATC — Sub-Agent for Critical Tasks at 7 PM on weekdays
    scheduler.schedule(`${chatId}_satc`, "0 19 * * 1-5", async () => {
        try {
            await runSATC(chatId);
        } catch (err) {
            console.error(`❌ SATC error for ${chatId}:`, err);
        }
    });
}

// ── Global System Tasks (Run exactly once, regardless of user count) ──
export function setupGlobalTasks() {
    // LLM Tracker: Curate new tools/models every 2 hours
    scheduler.schedule("global_llm_tracker_curate", "0 */2 * * *", async () => {
        try {
            await runCurationCycle();
        } catch (err) {
            console.error(`❌ Global LLM Tracker curate error:`, err);
        }
    });

    // LLM Tracker: Generate and distribute daily report at 9 AM
    scheduler.schedule("global_llm_tracker_report", "0 9 * * *", async () => {
        try {
            await generateDailyReport();
        } catch (err) {
            console.error(`❌ Global LLM Tracker report error:`, err);
        }
    });
}
