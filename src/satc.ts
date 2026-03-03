/**
 * SATC — Sub-Agent for Critical Tasks (Fase 2.1)
 *
 * Analisa as tarefas de alta prioridade e propõe ações atômicas concretas.
 * Não é chamado pelo usuário diretamente — opera como daemon agendado.
 *
 * Funcionamento:
 *  1. Detecta tópicos de alta prioridade (Petrobras, Gravity Claw, Casa Nova)
 *  2. Consulta Trello para verificar tarefas pendentes/atrasadas
 *  3. Gera uma "próxima ação atômica" personalizada e envia ao usuário
 */

import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./telegram-utils.js";
import { getTopTopics, getPatterns } from "./recommendations.js";

/** Tópicos que o SATC considera de alta prioridade para Rafael */
const HIGH_PRIORITY_TOPICS = ["petrobras", "python_study", "gravity_claw", "casa_nova"];

/**
 * Roda o SATC para um chatId.
 * Agendado pelo scheduler (ex: às 19h em dias úteis).
 */
export async function runSATC(chatId: string): Promise<void> {
    console.log(`🎯 [SATC] Starting critical tasks analysis for ${chatId}...`);

    // 1. Detecta quais tópicos de alta prioridade estão ativos para este usuário
    const topTopics = getTopTopics(chatId, 15);
    const activePriorities = HIGH_PRIORITY_TOPICS.filter((t) => topTopics.includes(t));

    if (activePriorities.length === 0) {
        console.log(`[SATC] No high priority topics active for ${chatId}, skipping.`);
        return;
    }

    // 2. Monta um prompt rico para o agente gerar a sugestão de "próxima ação atômica"
    const topicsStr = activePriorities
        .map((t) => t.replace(/_/g, " "))
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
        .join(", ");

    const prompt =
        `[SATC - ANÁLISE AUTÔNOMA DE TAREFAS CRÍTICAS]\n\n` +
        `Você é o Sub-Agente de Tarefas Críticas do MEGAMIND.\n` +
        `Os tópicos de alta prioridade do Rafael são: **${topicsStr}**.\n\n` +
        `Sua missão:\n` +
        `1. Use a ferramenta trello_list_tasks para verificar tarefas pendentes ou atrasadas relacionadas a esses tópicos.\n` +
        `2. Com base no que encontrar, sugira 1 a 2 **ações atômicas concretas** que Rafael pode fazer HOJE (máx 30-60 min cada).\n` +
        `3. Seja específico: diga EXATAMENTE o que fazer, não apenas "estude mais".\n` +
        `4. Formate em Markdown curto (máx 12 linhas). Use o estilo dramático do Megamente mas seja prático.\n` +
        `5. NO FINAL, pergunte se Rafael quer que você crie um card no Trello para a tarefa sugerida.\n\n` +
        `Este é um relatório interno automático — envie ao usuário normalmente.`;

    try {
        const result = await runAgent(chatId, prompt);
        try {
            await sendTelegramMessage(chatId, result.text);
            console.log(`✅ [SATC] Action proposal sent for ${chatId} (topics: ${activePriorities.join(", ")})`);
        } catch (sendErr) {
            console.error(`❌ [SATC] Failed to send Telegram message for ${chatId}. Message probably has bad Markdown formatting. Error:`, sendErr);
        }
    } catch (err) {
        console.error(`❌ [SATC] Agent execution failed for ${chatId}:`, err);
    }
}
