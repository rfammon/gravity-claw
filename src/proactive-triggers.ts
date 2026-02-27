/**
 * Proactive Triggers Engine (Fase 1.2)
 *
 * Análise contextual periódica que detecta situações e dispara alertas
 * proativos para o usuário sem necessidade de interação explícita.
 *
 * Triggers implementados:
 *  - Petrobras Check: ausência > 24h → lembrete de estudo
 *  - Casa Nova Check: datas limite próximas em tarefas de mudança
 *  - Finance Gap Check: dias sem registro de gastos em dia útil
 */

import { sendTelegramMessage } from "./bot.js";
import { detectTopicSilence } from "./recommendations.js";
import { runAgent } from "./agent.js";
import { getPatterns } from "./recommendations.js";
import { config } from "./config.js";

/** Horário atual em Brasília (-03:00) */
function nowBRT(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

/** Verifica se hoje é um dia útil (segunda a sexta) */
function isWeekday(): boolean {
    const day = nowBRT().getDay();
    return day >= 1 && day <= 5;
}

// ──────────────────────────────────────────────────────────────────────

/**
 * Trigger 1 — Petrobras Consistency Check
 *
 * Se o usuário não mencionou nada relacionado a Petrobras ou Python Study
 * nas últimas 24 horas E é um dia útil, lembra de estudar.
 */
async function petrobrasCheck(chatId: string): Promise<void> {
    const petraSilent = detectTopicSilence(chatId, "petrobras", 24);
    const pythonSilent = detectTopicSilence(chatId, "python_study", 24);

    if (!petraSilent && !pythonSilent) return; // Tópico ativo, sem alerta necessário

    if (!isWeekday()) return; // Só aciona em dias úteis

    const hour = nowBRT().getHours();
    if (hour < 9 || hour > 21) return; // Só notifica em horário útil

    const silentTopics: string[] = [];
    if (petraSilent) silentTopics.push("Petrobras");
    if (pythonSilent) silentTopics.push("Python/Estudos");

    const msg =
        `🧠⚡ *Lembrete Megamental!*\n\n` +
        `Rafael, hoje não ouvi nada sobre: **${silentTopics.join(", ")}**.\n\n` +
        `O seu **Plano de Consistência** continua de pé! Já revisou algum módulo de Python hoje? ` +
        `Uma revisão rápida de 30 minutos faz uma ENORME diferença na retenção! 💡\n\n` +
        `Use /estudos ou me pergunte sobre o concurso para eu te ajudar a manter o foco!`;

    await sendTelegramMessage(chatId, msg);
    console.log(`🎯 [ProactiveTrigger] Petrobras check fired for ${chatId}`);
}

// ──────────────────────────────────────────────────────────────────────

/**
 * Trigger 2 — Casa Nova / Mudança Check
 *
 * Pergunta ao agente sobre tarefas de mudança/casa nova pendentes e,
 * se houver alguma com prazo próximo, notifica o usuário.
 */
async function casaNovaCheck(chatId: string): Promise<void> {
    const hour = nowBRT().getHours();
    if (hour < 9 || hour > 20) return;

    // Roda apenas 1x/dia: verificamos se já rodou hoje com base no padrão de trigger
    // Verificamos se casa_nova foi discutida recentemente — se sim, o trigger já foi necessário
    const casaSilent = detectTopicSilence(chatId, "casa_nova", 48);
    if (!casaSilent) return; // Sendo discutida ativamente, não incomodar

    try {
        const result = await runAgent(
            chatId,
            `[VERIFICAÇÃO INTERNA - NÃO EXIBIR AO USUÁRIO DIRETAMENTE] Use a ferramenta trello_list_tasks para verificar se há algum card relacionado a 'mudança', 'apartamento' ou 'casa nova' que esteja com prazo vencido ou vencendo nos próximos 7 dias. Se encontrar, retorne apenas o nome do card e o prazo. Se não encontrar nada urgente, retorne NENHUM_URGENTE.`,
        );

        const text = result.text;
        if (text.includes("NENHUM_URGENTE") || text.trim().length === 0) return;

        const notification =
            `🏠 *Casa Nova Alert!*\n\n` +
            `Rafael, detectei tarefas da mudança que merecem sua atenção:\n\n` +
            `${text}\n\n` +
            `Precisa de ajuda para organizar ou registrar alguma compra da mudança?`;

        await sendTelegramMessage(chatId, notification);
        console.log(`🎯 [ProactiveTrigger] Casa Nova check fired for ${chatId}`);
    } catch (err) {
        console.error(`❌ [ProactiveTrigger] Casa Nova check error:`, err);
    }
}

// ──────────────────────────────────────────────────────────────────────

/**
 * Trigger 3 — Finance Gap Check
 *
 * Se não houve nenhum registro de gastos nas últimas 48h em dia útil,
 * sugere registrar despesas pendentes.
 */
async function financeGapCheck(chatId: string): Promise<void> {
    if (!isWeekday()) return;

    const hour = nowBRT().getHours();
    if (hour < 18 || hour > 21) return; // Só à tarde/noite

    const patterns = getPatterns(chatId, "finance_pattern");
    if (patterns.length === 0) return; // Usuário nunca usou finanças, não incomodar

    const financeSilent = detectTopicSilence(chatId, "finance", 48);
    if (!financeSilent) return;

    const msg =
        `💰 *Balanço Pendente!*\n\n` +
        `Hmm, faz 2 dias que não registro nenhuma transação financeira contigo. ` +
        `Tudo sob controle nas finanças, Rafael?\n\n` +
        `Se tiver algum gasto recente pra lançar, é só me falar! Ex: _"Gastei R$50 no mercado"_ 🛒`;

    await sendTelegramMessage(chatId, msg);
    console.log(`🎯 [ProactiveTrigger] Finance gap check fired for ${chatId}`);
}

// ──────────────────────────────────────────────────────────────────────

/**
 * Ponto de entrada principal — chamado pelo Scheduler a cada hora
 * para todos os chatIds autorizados.
 */
export async function runProactiveTriggers(chatId: string): Promise<void> {
    console.log(`🤖 [ProactiveTrigger] Running checks for ${chatId}...`);

    // Rodamos os triggers em sequência para evitar flood de mensagens
    try {
        await petrobrasCheck(chatId);
    } catch (err) {
        console.error(`❌ [ProactiveTrigger] petrobrasCheck error:`, err);
    }

    try {
        await casaNovaCheck(chatId);
    } catch (err) {
        console.error(`❌ [ProactiveTrigger] casaNovaCheck error:`, err);
    }

    try {
        await financeGapCheck(chatId);
    } catch (err) {
        console.error(`❌ [ProactiveTrigger] financeGapCheck error:`, err);
    }

    console.log(`✅ [ProactiveTrigger] Done for ${chatId}`);
}
