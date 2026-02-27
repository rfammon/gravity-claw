/**
 * Proactive Intelligence Engine
 *
 * Enhanced proactive system that makes the bot truly autonomous:
 *   1. Morning Briefing (8h) — rich AI-generated dashboard with Trello, finance, weather
 *   2. Curiosity Research (14h, weekdays) — auto-researches topics the user cares about
 *   3. Daily Digest (22h) — summarizes the day's interactions and suggests next steps
 *   4. Smart Suggestions — pattern-based task suggestions
 *
 * Each routine has 24h cooldown and respects quiet hours (23h-7h BRT).
 */

import { runAgent } from "./agent.js";
import { chatLight, type Message } from "./llm.js";
import { sendTelegramMessage } from "./telegram-utils.js";
import { getChatHistory } from "./db-provider.js";
import { getTopTopics, getActiveHours, getPatterns } from "./recommendations.js";
import { rag } from "./rag-provider.js";
import { config } from "./config.js";
import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// ── Cooldown DB ───────────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const db = new Database(path.join(GRAVITY_DIR, "proactive_engine.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS proactive_cooldowns (
    chat_id TEXT NOT NULL,
    routine TEXT NOT NULL,
    last_run DATETIME DEFAULT CURRENT_TIMESTAMP,
    run_count INTEGER DEFAULT 1,
    PRIMARY KEY (chat_id, routine)
  );

  CREATE TABLE IF NOT EXISTS research_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    result_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("🧠 Proactive Intelligence Engine ready");

// ── Helpers ───────────────────────────────────────────────────────────

function nowBRT(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function isQuietHour(): boolean {
    const hour = nowBRT().getHours();
    return hour >= 23 || hour < 7;
}

function canRunRoutine(chatId: string, routine: string, cooldownHours: number): boolean {
    if (isQuietHour()) return false;

    const row = db.prepare(
        "SELECT last_run FROM proactive_cooldowns WHERE chat_id = ? AND routine = ?"
    ).get(chatId, routine) as any;

    if (!row) return true;

    const hoursSince = (Date.now() - new Date(row.last_run).getTime()) / (1000 * 60 * 60);
    return hoursSince >= cooldownHours;
}

function markRoutineRun(chatId: string, routine: string): void {
    db.prepare(`
        INSERT INTO proactive_cooldowns (chat_id, routine, last_run, run_count)
        VALUES (?, ?, CURRENT_TIMESTAMP, 1)
        ON CONFLICT(chat_id, routine) DO UPDATE SET
            last_run = CURRENT_TIMESTAMP,
            run_count = run_count + 1
    `).run(chatId, routine);
}

/**
 * Lightweight agent for simple text-only tasks (no tools).
 * Uses Groq → gemini-flash-lite. Much faster and cheaper.
 * Anti-hallucination: includes strict system prompt rules.
 */
async function runLightAgent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: Message[] = [
        { role: "system", content: systemPrompt + "\n\nREGRAS ANTI-ALUCINAÇÃO:\n- Só afirme fatos que foram fornecidos no contexto acima\n- Se não tem dados, diga \"não tenho informações suficientes\"\n- Nunca invente números, datas ou nomes\n- Mantenha respostas factuais e verificáveis" },
        { role: "user", content: userPrompt }
    ];
    try {
        const response = await chatLight(messages, 1024);
        return response?.choices?.[0]?.message?.content || "⚠️ Sem resposta do modelo.";
    } catch (err) {
        console.error("❌ [LightAgent] Failed:", err);
        return "⚠️ Erro ao processar tarefa leve.";
    }
}

// ── 1. Morning Briefing ───────────────────────────────────────────────

export async function runMorningBriefing(chatId: string): Promise<void> {
    if (!canRunRoutine(chatId, "morning_briefing", 20)) return;

    console.log(`☀️ [ProactiveEngine] Running morning briefing for ${chatId}...`);

    try {
        const topTopics = getTopTopics(chatId, 5);
        const topicsStr = topTopics.length > 0 ? topTopics.join(", ") : "projetos pessoais";

        // RAG: fetch relevant memories about user preferences and style
        let ragContext = "";
        try {
            const memories = await rag.searchFacts(chatId, "preferências estilo comunicação objetivos", 5);
            if (memories.length > 0) {
                ragContext = `\n\nMEMÓRIAS PERSISTENTES DO RAFAEL:\n${memories.map(m => `• ${m}`).join("\n")}`;
            }
        } catch { /* RAG offline, continue without */ }

        // RAG: fetch stored facts about the user
        let factsContext = "";
        try {
            const facts = await rag.searchFacts(chatId, "fatos sobre rafael objetivos pessoais", 5);
            if (facts.length > 0) {
                factsContext = `\n\nFATOS CONHECIDOS SOBRE O RAFAEL:\n${facts.map(f => `• ${f}`).join("\n")}`;
            }
        } catch { /* continue without */ }

        const prompt = `[SISTEMA PROATIVO - MORNING BRIEFING]

Você é o Megamind, agente pessoal autônomo do Rafael. Gere um briefing matinal COMPLETO e BONITO.

INSTRUÇÕES:
1. Saudação dramática no estilo Megamente (curta, 1 linha)
2. 📋 Use trello_list_tasks para listar tarefas prioritárias do dia
3. 💰 Use finance_calendar para verificar contas a vencer hoje ou em 3 dias
4. 🎯 Objetivos do dia baseados nos tópicos frequentes: ${topicsStr}
5. 💡 Uma dica prática motivacional sobre seus interesses atuais
${ragContext}${factsContext}

REGRAS:
- Máximo 20 linhas, bem formatado com emojis e markdown
- Se não conseguir acessar Trello ou Finance, adapte sem desculpas
- Termine com uma pergunta engajadora para iniciar o dia`;

        const result = await runAgent(chatId, prompt);
        await sendTelegramMessage(chatId, result.text);
        markRoutineRun(chatId, "morning_briefing");
        console.log(`☀️ [ProactiveEngine] Morning briefing sent for ${chatId}`);
    } catch (err) {
        console.error(`❌ [ProactiveEngine] Morning briefing error:`, err);
    }
}

// ── 2. Curiosity Research ─────────────────────────────────────────────

export async function runCuriosityResearch(chatId: string): Promise<void> {
    if (!canRunRoutine(chatId, "curiosity_research", 22)) return;

    const day = nowBRT().getDay();
    if (day === 0 || day === 6) return; // Weekdays only

    console.log(`🔬 [ProactiveEngine] Running curiosity research for ${chatId}...`);

    try {
        // Get recent conversation topics to research
        const history = await getChatHistory(chatId, 50);
        const recentMessages = history
            .filter(m => m.role === "user")
            .slice(-15)
            .map(m => String(m.content).substring(0, 100))
            .join("; ");

        const topTopics = getTopTopics(chatId, 5);

        // RAG: enrich research with stored knowledge
        let researchRagContext = "";
        try {
            const query = topTopics.slice(0, 2).join(" ") || "interesses do usuário";
            const memories = await rag.searchFacts(chatId, query, 3);
            if (memories.length > 0) {
                researchRagContext = `\n\nCONHECIMENTO EXISTENTE (memória do Megamind):\n${memories.map(m => `• ${m}`).join("\n")}`;
            }
        } catch { /* RAG offline */ }

        const prompt = `[SISTEMA PROATIVO - CURIOSITY RESEARCH]

Você é o Megamind, agente de pesquisa proativa do Rafael.

CONTEXTO DO USUÁRIO:
- Tópicos frequentes: ${topTopics.join(", ")}
- Mensagens recentes: ${recentMessages.substring(0, 500)}
${researchRagContext}

INSTRUÇÕES:
1. Identifique 1-2 tópicos que o Rafael está estudando/trabalhando ativamente
2. Use web_search para pesquisar NOVIDADES, TUTORIAIS ou ATUALIZAÇÕES sobre esses tópicos
3. Compile os achados em um mini-relatório de pesquisa

FORMATO DO RELATÓRIO:
🔬 **Pesquisa Proativa do Megamind**

📌 **Tópico:** [nome do tópico]
🔗 **Descobertas:**
• [achado 1 com link se possível]
• [achado 2]
• [achado 3]

💡 **Como isso te ajuda:** [conexão prática com os objetivos do Rafael]

REGRAS:
- Máximo 15 linhas
- Foque em informação ACIONÁVEL, não genérica
- Se não encontrar nada novo, NÃO envie nada (responda apenas "SKIP_RESEARCH")`;

        const result = await runAgent(chatId, prompt);

        if (result.text.includes("SKIP_RESEARCH") || result.text.trim().length < 50) {
            console.log(`🔬 [ProactiveEngine] No new research to report for ${chatId}`);
            return;
        }

        await sendTelegramMessage(chatId, result.text);

        // Log the research
        db.prepare("INSERT INTO research_log (chat_id, topic, result_summary) VALUES (?, ?, ?)").run(
            chatId, topTopics[0] || "general", result.text.substring(0, 500)
        );

        markRoutineRun(chatId, "curiosity_research");
        console.log(`🔬 [ProactiveEngine] Curiosity research sent for ${chatId}`);
    } catch (err) {
        console.error(`❌ [ProactiveEngine] Curiosity research error:`, err);
    }
}

// ── 3. Daily Digest ───────────────────────────────────────────────────

export async function runDailyDigest(chatId: string): Promise<void> {
    if (!canRunRoutine(chatId, "daily_digest", 20)) return;

    console.log(`🌙 [ProactiveEngine] Running daily digest for ${chatId}...`);

    try {
        const history = await getChatHistory(chatId, 100);
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];

        // Count today's interactions
        const todayMessages = history.filter(m => {
            try {
                const msgDate = new Date(m.timestamp || 0).toISOString().split("T")[0];
                return msgDate === todayStr;
            } catch { return false; }
        });

        const userMsgCount = todayMessages.filter(m => m.role === "user").length;
        const toolsUsed = todayMessages
            .filter(m => m.role === "assistant" && String(m.content).includes("tool_calls"))
            .length;

        const recentTopics = getTopTopics(chatId, 3);

        if (userMsgCount === 0) {
            // User didn't interact today — send a gentle ping instead
            await sendTelegramMessage(chatId,
                `🌙 *Boa noite, Rafael!*\n\n` +
                `Não nos falamos hoje, mas estou aqui se precisar de algo amanhã. ` +
                `Descanse bem! 😴`
            );
            markRoutineRun(chatId, "daily_digest");
            return;
        }

        const prompt = `[SISTEMA PROATIVO - DAILY DIGEST]

Você é o Megamind fazendo o resumo do dia do Rafael.

ESTATÍSTICAS DO DIA:
- Mensagens do usuário: ${userMsgCount}
- Interações com ferramentas: ~${toolsUsed}
- Tópicos mais discutidos: ${recentTopics.join(", ") || "variados"}

MENSAGENS RECENTES (últimas do dia):
${todayMessages.slice(-10).map(m => `[${m.role}]: ${String(m.content).substring(0, 120)}`).join("\n")}

INSTRUÇÕES:
1. Resuma o dia em 3-5 bullets
2. Destaque conquistas ou progresso feito
3. Sugira 1-2 tarefas para amanhã baseado no que ficou pendente
4. Feche com uma mensagem motivacional curta

FORMATO:
🌙 **Resumo do Dia — ${todayStr}**

📊 **Números:** X mensagens, Y ferramentas usadas
📝 **Destaques:** [bullets]
🎯 **Para amanhã:** [sugestões]
💪 [motivação]

Máximo 15 linhas. Use markdown e emojis.`;

        // 🌟 TIER: LIGHT — daily digest is text-only, no tools needed
        const systemPrompt = "Você é o Megamind (Megamente), agente pessoal do Rafael. Gere resumos concisos e motivacionais do dia. Responda em pt-BR.";
        const resultText = await runLightAgent(systemPrompt, prompt);
        await sendTelegramMessage(chatId, resultText);
        markRoutineRun(chatId, "daily_digest");
        console.log(`🌙 [ProactiveEngine] Daily digest sent for ${chatId}`);
    } catch (err) {
        console.error(`❌ [ProactiveEngine] Daily digest error:`, err);
    }
}

// ── 4. Smart Suggestions (triggered by patterns) ──────────────────────

export async function runSmartSuggestions(chatId: string): Promise<void> {
    if (!canRunRoutine(chatId, "smart_suggestions", 48)) return;

    const hour = nowBRT().getHours();
    if (hour < 10 || hour > 20) return;

    console.log(`💡 [ProactiveEngine] Running smart suggestions for ${chatId}...`);

    try {
        const patterns = getPatterns(chatId, "topic_frequency");
        const topTopics = getTopTopics(chatId, 10);

        if (topTopics.length < 3) return; // Not enough data

        // RAG: get user preferences for tailored suggestions
        let ragContext = "";
        try {
            const memories = await rag.searchFacts(chatId, "preferências feedback sugestões rotina", 3);
            if (memories.length > 0) {
                ragContext = `\n\nMEMÓRIAS RELEVANTES:\n${memories.map(m => `• ${m}`).join("\n")}`;
            }
        } catch { /* RAG offline */ }

        const prompt = `[SISTEMA PROATIVO - SMART SUGGESTIONS]

Você é o Megamind, assistente pessoal proativo do Rafael.

PADRÕES DE ATIVIDADE:
- Tópicos frequentes: ${topTopics.join(", ")}
- Padrões identificados: ${patterns.slice(0, 5).map((p: any) => p.patternValue || p.patternKey).join("; ")}
${ragContext}

Com base nesses padrões, sugira 2-3 ações que o Rafael poderia tomar AGORA que seriam úteis:

Exemplos de boas sugestões:
- "Que tal revisar o módulo 3 de Python? Faz 3 dias que não estuda"
- "Vi que você tem um card no Trello sobre X — quer que eu pesquise soluções?"
- "Seus gastos em delivery subiram 30% — quer organizar um orçamento?"

REGRAS:
- Sugestões devem ser ACIONÁVEIS e ESPECÍFICAS
- Se não tem dados suficientes, responda "SKIP_SUGGESTIONS"
- Máximo 8 linhas
- Use o formato:

💡 **Sugestões do Megamind**
• [sugestão 1]
• [sugestão 2]
Quer que eu execute alguma? É só pedir!`;

        // 🌟 TIER: LIGHT — smart suggestions are text-only, no tools needed
        const systemPrompt = "Você é o Megamind (Megamente), agente pessoal proativo do Rafael. Gere sugestões práticas e acionáveis. Responda em pt-BR.";
        const resultText = await runLightAgent(systemPrompt, prompt);

        if (resultText.includes("SKIP_SUGGESTIONS") || resultText.trim().length < 30) {
            return;
        }

        await sendTelegramMessage(chatId, resultText);
        markRoutineRun(chatId, "smart_suggestions");
        console.log(`💡 [ProactiveEngine] Smart suggestions sent for ${chatId}`);
    } catch (err) {
        console.error(`❌ [ProactiveEngine] Smart suggestions error:`, err);
    }
}

// ── Master Runner ─────────────────────────────────────────────────────

/**
 * Runs all proactive intelligence routines.
 * Called by the scheduler at appropriate times.
 */
export async function runProactiveEngine(chatId: string, routine?: string): Promise<void> {
    const hour = nowBRT().getHours();

    if (routine) {
        // Run specific routine
        switch (routine) {
            case "morning_briefing": await runMorningBriefing(chatId); break;
            case "curiosity_research": await runCuriosityResearch(chatId); break;
            case "daily_digest": await runDailyDigest(chatId); break;
            case "smart_suggestions": await runSmartSuggestions(chatId); break;
        }
        return;
    }

    // Auto-select based on time
    if (hour >= 7 && hour <= 9) {
        await runMorningBriefing(chatId);
    } else if (hour >= 13 && hour <= 15) {
        await runCuriosityResearch(chatId);
    } else if (hour >= 16 && hour <= 18) {
        await runSmartSuggestions(chatId);
    } else if (hour >= 21 && hour <= 22) {
        await runDailyDigest(chatId);
    }
}

console.log("🧠 Proactive Intelligence Engine loaded (morning briefing, curiosity research, daily digest, smart suggestions)");
