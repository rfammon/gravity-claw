/**
 * Trigger Manager — Sistema de Triggers Dinâmicos (Fase 2.1 avançada)
 *
 * Triggers são armazenados no banco de dados e gerenciados por um agente de IA
 * que analisa as conversas periodicamente e decide:
 *   - criar novos triggers relevantes para o usuário
 *   - modificar thresholds e mensagens de triggers existentes
 *   - arquivar triggers que se tornaram irrelevantes
 *
 * Fluxo:
 *   1. runDynamicTriggers(chatId) — avalia todos os triggers ativos do DB a cada hora
 *   2. evolveTriggers(chatId)     — roda semanalmente e usa LLM para evoluir a lista
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { chat, type Message } from "./llm.js";
import { sendTelegramMessage } from "./bot.js";
import { getTopTopics, getActiveHours, getPatterns, detectTopicSilence } from "./recommendations.js";
import { getChatHistory } from "./db-provider.js";

// ── Local SQLite for trigger storage ─────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const DB_PATH = path.join(GRAVITY_DIR, "triggers.sqlite");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS dynamic_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    condition_type TEXT NOT NULL CHECK(condition_type IN ('topic_silence', 'time_based', 'custom_llm')),
    condition_params TEXT NOT NULL,   -- JSON: e.g. {"topic":"petrobras","threshold_hours":24}
    message_template TEXT NOT NULL,  -- The alert message to send
    active INTEGER DEFAULT 1,
    fire_count INTEGER DEFAULT 0,
    last_fired DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'ai',        -- 'seed' | 'ai' | 'user'
    UNIQUE(chat_id, name)
  );

  CREATE TABLE IF NOT EXISTS trigger_evolution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action TEXT NOT NULL,            -- 'created' | 'modified' | 'archived'
    trigger_name TEXT NOT NULL,
    reason TEXT
  );
`);

// ── Types ─────────────────────────────────────────────────────────────

export interface DynamicTrigger {
    id: number;
    name: string;
    description: string;
    conditionType: "topic_silence" | "time_based" | "custom_llm";
    conditionParams: Record<string, unknown>;
    messageTemplate: string;
    active: boolean;
    fireCount: number;
    lastFired?: string;
    source: string;
}

export interface TriggerEvolutionAction {
    action: "create" | "modify" | "archive";
    name: string;
    description?: string;
    conditionType?: "topic_silence" | "time_based" | "custom_llm";
    conditionParams?: Record<string, unknown>;
    messageTemplate?: string;
    reason: string;
}

// ── Seed Triggers (bootstrap padrão para Rafael) ─────────────────────

const SEED_TRIGGERS: Omit<DynamicTrigger, "id" | "fireCount" | "lastFired">[] = [
    {
        name: "petrobras_consistency",
        description: "Lembra Rafael de estudar para o concurso Petrobras após 24h de silêncio",
        conditionType: "topic_silence",
        conditionParams: { topic: "petrobras", threshold_hours: 24, weekdays_only: true, hour_start: 9, hour_end: 21 },
        messageTemplate:
            "🧠⚡ *Lembrete Megamental!*\n\nRafael, hoje não ouvi nada sobre o concurso da Petrobras ou Python!\n\n" +
            "O seu **Plano de Consistência** continua de pé! Uma revisão rápida de 30 minutos faz ENORME diferença! 💡\n\n" +
            "Me pergunte sobre o concurso para eu te ajudar a manter o foco!",
        active: true,
        source: "seed",
    },
    {
        name: "casa_nova_deadline",
        description: "Alerta sobre tarefas de mudança com prazo chegando, após 48h sem discutir",
        conditionType: "topic_silence",
        conditionParams: { topic: "casa_nova", threshold_hours: 48, hour_start: 9, hour_end: 20 },
        messageTemplate:
            "🏠 *Casa Nova Alert!*\n\nRafael, faz um tempo que não falamos das tarefas da mudança. " +
            "Há algum item pendente? Posso verificar seu Trello agora!",
        active: true,
        source: "seed",
    },
    {
        name: "finance_gap",
        description: "Alerta quando ficam 48h sem registro de despesas em dia útil",
        conditionType: "topic_silence",
        conditionParams: { topic: "finance", threshold_hours: 48, weekdays_only: true, hour_start: 18, hour_end: 21 },
        messageTemplate:
            "💰 *Balanço Pendente!*\n\nHmm, faz 2 dias que não registro nenhuma transação financeira contigo. " +
            "Tudo sob controle, Rafael?\n\nSe tiver algum gasto recente, é só me falar! Ex: _\"Gastei R$50 no mercado\"_ 🛒",
        active: true,
        source: "seed",
    },
];

/** Expande as seed triggers do código no DB se ainda não existem */
function seedDefaultTriggers(chatId: string): void {
    const upsert = db.prepare(`
    INSERT INTO dynamic_triggers (chat_id, name, description, condition_type, condition_params, message_template, active, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, name) DO NOTHING
  `);

    for (const t of SEED_TRIGGERS) {
        upsert.run(
            chatId,
            t.name,
            t.description,
            t.conditionType,
            JSON.stringify(t.conditionParams),
            t.messageTemplate,
            t.active ? 1 : 0,
            t.source,
        );
    }
}

// ── CRUD helpers ──────────────────────────────────────────────────────

function getActiveTriggers(chatId: string): DynamicTrigger[] {
    const rows = db
        .prepare("SELECT * FROM dynamic_triggers WHERE chat_id = ? AND active = 1 ORDER BY created_at ASC")
        .all(chatId) as any[];

    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        conditionType: r.condition_type as DynamicTrigger["conditionType"],
        conditionParams: JSON.parse(r.condition_params),
        messageTemplate: r.message_template,
        active: !!r.active,
        fireCount: r.fire_count,
        lastFired: r.last_fired ?? undefined,
        source: r.source,
    }));
}

function markFired(triggerId: number): void {
    db.prepare("UPDATE dynamic_triggers SET fire_count = fire_count + 1, last_fired = CURRENT_TIMESTAMP WHERE id = ?").run(triggerId);
}

function applyEvolutionActions(chatId: string, actions: TriggerEvolutionAction[]): void {
    const upsert = db.prepare(`
    INSERT INTO dynamic_triggers (chat_id, name, description, condition_type, condition_params, message_template, active, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'ai', CURRENT_TIMESTAMP)
    ON CONFLICT(chat_id, name) DO UPDATE SET
      description = excluded.description,
      condition_type = excluded.condition_type,
      condition_params = excluded.condition_params,
      message_template = excluded.message_template,
      active = 1,
      source = 'ai',
      updated_at = CURRENT_TIMESTAMP
  `);

    const archive = db.prepare("UPDATE dynamic_triggers SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ? AND name = ?");
    const logEvolution = db.prepare(
        "INSERT INTO trigger_evolution_log (chat_id, action, trigger_name, reason) VALUES (?, ?, ?, ?)",
    );

    for (const action of actions) {
        if (action.action === "archive") {
            archive.run(chatId, action.name);
            logEvolution.run(chatId, "archived", action.name, action.reason);
            console.log(`🗑️ [TriggerMgr] Archived trigger "${action.name}": ${action.reason}`);
        } else if (action.action === "create" || action.action === "modify") {
            upsert.run(
                chatId,
                action.name,
                action.description ?? "",
                action.conditionType ?? "topic_silence",
                JSON.stringify(action.conditionParams ?? {}),
                action.messageTemplate ?? "",
            );
            logEvolution.run(chatId, action.action === "create" ? "created" : "modified", action.name, action.reason);
            console.log(`✨ [TriggerMgr] ${action.action === "create" ? "Created" : "Modified"} trigger "${action.name}": ${action.reason}`);
        }
    }
}

// ── Condition Evaluators ──────────────────────────────────────────────

function nowBRT(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function evaluateTopicSilence(chatId: string, params: Record<string, unknown>): boolean {
    const topic = params.topic as string;
    const thresholdHours = (params.threshold_hours as number) ?? 24;
    const weekdaysOnly = (params.weekdays_only as boolean) ?? false;
    const hourStart = (params.hour_start as number) ?? 0;
    const hourEnd = (params.hour_end as number) ?? 23;

    const now = nowBRT();
    const hour = now.getHours();
    const day = now.getDay();

    if (weekdaysOnly && (day === 0 || day === 6)) return false;
    if (hour < hourStart || hour > hourEnd) return false;

    return detectTopicSilence(chatId, topic, thresholdHours);
}

// ── Core: Run Dynamic Triggers ────────────────────────────────────────

/**
 * Avalia todos os triggers ativos do DB e dispara mensagens quando as condições forem atendidas.
 * Chamado pelo scheduler a cada hora.
 */
export async function runDynamicTriggers(chatId: string): Promise<void> {
    // Garante que as seed triggers existam no DB
    seedDefaultTriggers(chatId);

    const triggers = getActiveTriggers(chatId);
    console.log(`🤖 [TriggerMgr] Evaluating ${triggers.length} triggers for ${chatId}...`);

    for (const trigger of triggers) {
        try {
            // Evita rodar o mesmo trigger mais de 1x no mesmo período de 1h
            if (trigger.lastFired) {
                const hoursSinceFired = (Date.now() - new Date(trigger.lastFired).getTime()) / (1000 * 60 * 60);
                if (hoursSinceFired < 12) continue; // Cooldown mínimo de 12h por trigger
            }

            let shouldFire = false;

            if (trigger.conditionType === "topic_silence") {
                shouldFire = evaluateTopicSilence(chatId, trigger.conditionParams);
            }
            // Outros tipos de condição podem ser adicionados aqui futuramente

            if (shouldFire) {
                await sendTelegramMessage(chatId, trigger.messageTemplate);
                markFired(trigger.id);
                console.log(`🎯 [TriggerMgr] Fired trigger "${trigger.name}" for ${chatId}`);
            }
        } catch (err) {
            console.error(`❌ [TriggerMgr] Error evaluating trigger "${trigger.name}":`, err);
        }
    }
}

// ── Core: Evolve Triggers via AI ──────────────────────────────────────

/**
 * Usa o LLM para analisar os padrões do usuário e evoluir a lista de triggers.
 * Pode criar novos, modificar thresholds, ou arquivar os irrelevantes.
 * Chamado semanalmente pelo scheduler.
 */
export async function evolveTriggers(chatId: string): Promise<void> {
    console.log(`🧬 [TriggerMgr] Starting trigger evolution for ${chatId}...`);

    // Coleta contexto para o LLM
    const topTopics = getTopTopics(chatId, 10);
    const activeHours = getActiveHours(chatId);
    const allTriggers = db
        .prepare("SELECT name, description, condition_params, active, fire_count, last_fired FROM dynamic_triggers WHERE chat_id = ?")
        .all(chatId) as any[];

    const recentHistory = (await getChatHistory(chatId, 30))
        .slice(-20)
        .map((m) => `[${m.role}]: ${String(m.content).substring(0, 150)}`)
        .join("\n");

    const triggersJson = JSON.stringify(
        allTriggers.map((t) => ({
            name: t.name,
            description: t.description,
            params: JSON.parse(t.condition_params),
            active: !!t.active,
            fire_count: t.fire_count,
            last_fired: t.last_fired,
        })),
        null,
        2,
    );

    const systemPrompt: Message = {
        role: "system",
        content: `Você é o MEGAMIND, analista de padrões comportamentais do Rafael.
Sua tarefa é EVOLUIR a lista de triggers proativos com base no contexto do usuário.

TRIGGERS ATUAIS (ativos e inativos):
${triggersJson}

TÓPICOS MAIS FREQUENTES DO USUÁRIO: ${topTopics.join(", ")}
HORÁRIOS DE MAIOR ATIVIDADE: ${activeHours.join("h, ")}h
HISTÓRICO RECENTE (últimas mensagens):
${recentHistory}

Analise os dados e decida QUAIS AÇÕES tomar. Retorne um JSON array de ações:
[
  {
    "action": "create" | "modify" | "archive",
    "name": "nome_do_trigger_snake_case",
    "description": "O que este trigger faz",
    "conditionType": "topic_silence",
    "conditionParams": { "topic": "...", "threshold_hours": 24, "weekdays_only": true, "hour_start": 9, "hour_end": 21 },
    "messageTemplate": "Mensagem em Markdown que será enviada ao usuário (use **negrito**, _itálico_, emojis)",
    "reason": "Por que esta ação é necessária"
  }
]

REGRAS:
- Crie triggers APENAS para tópicos com alta frequência (>5 ocorrências) ou claramente importantes para o usuário
- Archive triggers com fire_count > 10 e low relevance, ou tópicos que o usuário claramente abandonou
- Modify thresholds se o trigger está disparando muito (aumente threshold) ou nunca dispara (diminua)
- Triggers de topic_silence são os mais simples e confiáveis — prefira-os
- NÃO crie mais de 3 novos triggers por evolução
- Se não houver nada a fazer, retorne []
- Responda APENAS com o JSON array, sem explicações adicionais`,
    };

    try {
        const response = await chat([systemPrompt, { role: "user", content: "Execute a evolução dos triggers agora." }]);
        const rawContent = response.choices[0]?.message?.content?.trim() ?? "[]";

        // Extrai o JSON mesmo se vier envolvido em markdown
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.log("🧬 [TriggerMgr] LLM returned no actions (empty response).");
            return;
        }

        const actions: TriggerEvolutionAction[] = JSON.parse(jsonMatch[0]);

        if (!Array.isArray(actions) || actions.length === 0) {
            console.log("🧬 [TriggerMgr] No trigger evolution actions needed.");
            return;
        }

        applyEvolutionActions(chatId, actions);
        console.log(`✅ [TriggerMgr] Evolution complete: ${actions.length} action(s) applied for ${chatId}`);

        // Notifica Rafael brevemente sobre as mudanças
        const summary = actions
            .map((a) => `• **${a.action === "create" ? "Novo" : a.action === "modify" ? "Atualizado" : "Arquivado"}**: ${a.name} — ${a.reason}`)
            .join("\n");

        await sendTelegramMessage(
            chatId,
            `🧬 *Sistema de Triggers Evoluído!*\n\nO Megamente atualizou seus alertas proativos:\n\n${summary}`,
        );
    } catch (err) {
        console.error("❌ [TriggerMgr] Evolution failed:", err);
    }
}

/** Lista todos os triggers (ativos e inativos) de um chatId — para diagnóstico */
export function listAllTriggers(chatId: string): DynamicTrigger[] {
    const rows = db.prepare("SELECT * FROM dynamic_triggers WHERE chat_id = ? ORDER BY created_at ASC").all(chatId) as any[];
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        conditionType: r.condition_type as DynamicTrigger["conditionType"],
        conditionParams: JSON.parse(r.condition_params),
        messageTemplate: r.message_template,
        active: !!r.active,
        fireCount: r.fire_count,
        lastFired: r.last_fired ?? undefined,
        source: r.source,
    }));
}
