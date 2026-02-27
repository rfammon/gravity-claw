/**
 * Gravity Claw Core — Project Agent (Fase 2.2)
 *
 * Agente especializado em detectar bloqueios e dificuldades do usuário
 * durante o desenvolvimento / uso do Gravity Claw e projetos relacionados.
 *
 * Integrado no fluxo do agent.ts como pré-processador:
 *   - Detecta frases de bloqueio na mensagem do usuário
 *   - Se detectado, ativa web_search proativamente com o contexto extraído
 *   - Retorna sugestões extras para o agente principal enriquecer sua resposta
 */

import { getTool } from "./tools/registry.js";

/** Padrões de bloqueio em português */
const BLOCKAGE_PATTERNS = [
    /n[aã]o consig[oa]/i,
    /dificuldade em/i,
    /travei (em|no|na|com)/i,
    /n[aã]o sei como/i,
    /como (eu )?(faço|fa[cç]o|posso|implemento|integro)/i,
    /preciso de ajuda com/i,
    /está dando erro/i,
    /n[aã]o funciona/i,
    /alguma api (para|pra)/i,
    /como integrar/i,
    /problema com/i,
    /n[aã]o encontrei/i,
];

/** Domínios de contexto do projeto para enriquecer a busca */
const PROJECT_CONTEXTS = [
    { keywords: ["gravity claw", "gravityclaw", "bot", "agente"], context: "Gravity Claw autonomous AI Telegram bot TypeScript" },
    { keywords: ["petrobras", "concurso", "edital"], context: "concurso Petrobras estudo programação" },
    { keywords: ["python", "algoritmo", "código"], context: "Python programming" },
    { keywords: ["geoprocessamento", "sig", "qgis", "shapefile", "utm"], context: "geospatial GIS geoprocessing" },
];

/**
 * Detecta se uma mensagem contém sinais de bloqueio/dificuldade.
 * Retorna true se o agente deve ativar busca proativa.
 */
export function detectBlockage(message: string): boolean {
    return BLOCKAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Identifica o contexto do projeto relevante para a mensagem.
 */
function getProjectContext(message: string): string {
    const lower = message.toLowerCase();
    for (const { keywords, context } of PROJECT_CONTEXTS) {
        if (keywords.some((kw) => lower.includes(kw))) {
            return context;
        }
    }
    return "software development TypeScript Node.js";
}

/**
 * Extrai uma query de busca concisa a partir da mensagem do usuário.
 * Remove artigos, preposições e palavras de bloqueio para focar no tema real.
 */
function extractSearchQuery(message: string): string {
    const projectCtx = getProjectContext(message);
    // Remove frases de bloqueio e captura o assunto
    const cleaned = message
        .replace(/n[aã]o consig[oa]/gi, "")
        .replace(/dificuldade em/gi, "")
        .replace(/preciso de ajuda com/gi, "")
        .replace(/está dando erro/gi, "")
        .replace(/n[aã]o sei como/gi, "")
        .replace(/[\r\n]+/g, " ")
        .trim();

    // Limita a 80 chars e adiciona o contexto do projeto
    const coreQuery = cleaned.substring(0, 80);
    return `${coreQuery} ${projectCtx}`.trim();
}

/**
 * Executa o Project Agent: busca proativa quando detecta bloqueio.
 *
 * Retorna uma string de contexto adicional para ser injetada no prompt
 * do agente principal, ou null se não houver bloqueio.
 */
export async function runProjectAgentIfBlocked(message: string): Promise<string | null> {
    if (!detectBlockage(message)) return null;

    const webSearchTool = getTool("web_search");
    if (!webSearchTool) return null;

    const query = extractSearchQuery(message);
    console.log(`🔭 [ProjectAgent] Blockage detected! Auto-searching: "${query}"`);

    try {
        const results = await webSearchTool.execute({ query });
        const resultText = typeof results === "string" ? results : results.text;

        if (!resultText || resultText.includes("❌") || resultText.length < 50) {
            return null;
        }

        // Retorna contexto extra formatado para o agente principal
        return (
            `\n\n---\n🔭 **[Gravity Claw Core — Busca Proativa]**\n` +
            `Detectei que você está com dificuldade. Pesquisei automaticamente por: _"${query}"_\n\n` +
            `**Resultados relevantes:**\n${resultText.substring(0, 800)}\n---`
        );
    } catch (err) {
        console.error(`❌ [ProjectAgent] Auto-search failed:`, err);
        return null;
    }
}
