/**
 * Dynamic Routine Manager
 *
 * Allows the user to create automated routines via natural language:
 *   "Megamind, todo dia às 9h busca as cotações do dólar e me manda"
 *
 * The system:
 *   1. LLM extracts: name, cron expression, action prompt
 *   2. Saves in SQLite table user_routines
 *   3. Scheduler checks every 15 min and executes due routines via runAgent
 *   4. User can list, pause, resume, or delete routines
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { registerTool } from "./tools/registry.js";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./telegram-utils.js";
import { config } from "./config.js";

// ── Database Setup ────────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const db = new Database(path.join(GRAVITY_DIR, "routines.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS user_routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action_prompt TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    last_run DATETIME,
    run_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, name)
  );

  CREATE TABLE IF NOT EXISTS routine_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    result_summary TEXT,
    success INTEGER DEFAULT 1,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("⚙️ Routine Manager ready (routines.sqlite)");

// ── Types ─────────────────────────────────────────────────────────────

interface UserRoutine {
    id: number;
    chat_id: string;
    name: string;
    cron_expression: string;
    action_prompt: string;
    active: boolean;
    last_run: string | null;
    run_count: number;
    created_at: string;
}

// ── Cron Matching ─────────────────────────────────────────────────────
// Simplified cron matching that checks if the current minute matches.
// Supports: minute hour day-of-month month day-of-week
// Special values: * (any), */N (every N), N (exact)

function nowBRT(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function matchesCronField(field: string, value: number, maxValue: number): boolean {
    if (field === "*") return true;
    if (field.startsWith("*/")) {
        const step = parseInt(field.substring(2), 10);
        return step > 0 && value % step === 0;
    }
    if (field.includes(",")) {
        return field.split(",").some(v => parseInt(v, 10) === value);
    }
    if (field.includes("-")) {
        const [start, end] = field.split("-").map(v => parseInt(v, 10));
        return value >= start && value <= end;
    }
    return parseInt(field, 10) === value;
}

function shouldRunNow(cronExpression: string): boolean {
    const now = nowBRT();
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) return false;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    return (
        matchesCronField(minute, now.getMinutes(), 59) &&
        matchesCronField(hour, now.getHours(), 23) &&
        matchesCronField(dayOfMonth, now.getDate(), 31) &&
        matchesCronField(month, now.getMonth() + 1, 12) &&
        matchesCronField(dayOfWeek, now.getDay(), 6)
    );
}

// ── Core Functions ────────────────────────────────────────────────────

function createRoutine(chatId: string, name: string, cronExpression: string, actionPrompt: string): string {
    try {
        db.prepare(`
            INSERT INTO user_routines (chat_id, name, cron_expression, action_prompt, active)
            VALUES (?, ?, ?, ?, 1)
        `).run(chatId, name, cronExpression, actionPrompt);
        return `✅ Rotina **"${name}"** criada!\n⏰ Agenda: \`${cronExpression}\`\n📝 Ação: ${actionPrompt.substring(0, 100)}`;
    } catch (err: any) {
        if (err.message?.includes("UNIQUE")) {
            return `❌ Já existe uma rotina chamada "${name}". Use outro nome ou delete a existente.`;
        }
        return `❌ Erro ao criar rotina: ${err.message}`;
    }
}

function listRoutines(chatId: string): UserRoutine[] {
    return db.prepare("SELECT * FROM user_routines WHERE chat_id = ? ORDER BY created_at DESC").all(chatId) as UserRoutine[];
}

function pauseRoutine(chatId: string, name: string): string {
    const result = db.prepare("UPDATE user_routines SET active = 0 WHERE chat_id = ? AND name = ?").run(chatId, name);
    return result.changes > 0 ? `⏸️ Rotina **"${name}"** pausada.` : `❌ Rotina "${name}" não encontrada.`;
}

function resumeRoutine(chatId: string, name: string): string {
    const result = db.prepare("UPDATE user_routines SET active = 1 WHERE chat_id = ? AND name = ?").run(chatId, name);
    return result.changes > 0 ? `▶️ Rotina **"${name}"** retomada!` : `❌ Rotina "${name}" não encontrada.`;
}

function deleteRoutine(chatId: string, name: string): string {
    const result = db.prepare("DELETE FROM user_routines WHERE chat_id = ? AND name = ?").run(chatId, name);
    return result.changes > 0 ? `🗑️ Rotina **"${name}"** deletada.` : `❌ Rotina "${name}" não encontrada.`;
}

// ── Execution Engine ──────────────────────────────────────────────────

/**
 * Called every 15 minutes by the scheduler.
 * Checks all active routines and executes those whose cron matches NOW.
 */
export async function runDueRoutines(chatId: string): Promise<void> {
    const routines = db.prepare(
        "SELECT * FROM user_routines WHERE chat_id = ? AND active = 1"
    ).all(chatId) as UserRoutine[];

    if (routines.length === 0) return;

    for (const routine of routines) {
        try {
            if (!shouldRunNow(routine.cron_expression)) continue;

            // Cooldown: don't run if already ran in the last 50 minutes
            if (routine.last_run) {
                const minutesSince = (Date.now() - new Date(routine.last_run).getTime()) / (1000 * 60);
                if (minutesSince < 50) continue;
            }

            console.log(`⚙️ [RoutineManager] Executing routine "${routine.name}" for ${chatId}...`);

            const result = await runAgent(chatId, `[ROTINA AUTOMÁTICA: ${routine.name}]\n\n${routine.action_prompt}`);

            // Send result to user
            const message = `⚙️ *Rotina: ${routine.name}*\n\n${result.text}`;
            await sendTelegramMessage(chatId, message);

            // Update last_run and log
            db.prepare("UPDATE user_routines SET last_run = CURRENT_TIMESTAMP, run_count = run_count + 1 WHERE id = ?").run(routine.id);
            db.prepare("INSERT INTO routine_log (routine_id, result_summary, success) VALUES (?, ?, 1)").run(
                routine.id, result.text.substring(0, 500)
            );

            console.log(`✅ [RoutineManager] Routine "${routine.name}" executed successfully`);
        } catch (err) {
            console.error(`❌ [RoutineManager] Routine "${routine.name}" failed:`, err);
            db.prepare("INSERT INTO routine_log (routine_id, result_summary, success) VALUES (?, ?, 0)").run(
                routine.id, err instanceof Error ? err.message : String(err)
            );
        }
    }
}

// ── Register Tools ────────────────────────────────────────────────────

registerTool({
    name: "create_routine",
    description: `Cria uma nova rotina automatizada que será executada periodicamente. O bot executa a ação no horário definido e envia o resultado ao usuário automaticamente. Exemplos de cron:
- "0 9 * * *" = todo dia às 9h
- "0 9 * * 1-5" = dias úteis às 9h
- "0 */3 * * *" = a cada 3 horas
- "30 14 * * 3" = quartas às 14:30`,
    parameters: {
        type: "object",
        properties: {
            name: { type: "string", description: "Nome curto da rotina (ex: cotacao_dolar, piada_diaria)" },
            cron_expression: { type: "string", description: "Expressão cron (minuto hora dia mês dia-semana)" },
            action_prompt: { type: "string", description: "O que o agente deve fazer quando a rotina executa (prompt completo)" }
        },
        required: ["name", "cron_expression", "action_prompt"]
    },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        return createRoutine(chatId, args.name, args.cron_expression, args.action_prompt);
    }
});

registerTool({
    name: "list_routines",
    description: "Lista todas as rotinas automatizadas do usuário (ativas e pausadas).",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        const routines = listRoutines(chatId);
        if (routines.length === 0) return "📋 Nenhuma rotina criada ainda.\n\nUse `create_routine` para criar uma!";

        const lines = routines.map(r => {
            const status = r.active ? "🟢" : "⏸️";
            const lastRun = r.last_run ? `último: ${r.last_run}` : "nunca executada";
            return `${status} **${r.name}** — \`${r.cron_expression}\`\n   📝 ${r.action_prompt.substring(0, 60)}...\n   🔄 ${r.run_count}x executada (${lastRun})`;
        });

        return `📋 **Suas Rotinas:**\n\n${lines.join("\n\n")}`;
    }
});

registerTool({
    name: "pause_routine",
    description: "Pausa uma rotina automatizada (ela para de executar mas não é deletada).",
    parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Nome da rotina a pausar" } },
        required: ["name"]
    },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        return pauseRoutine(chatId, args.name);
    }
});

registerTool({
    name: "resume_routine",
    description: "Retoma uma rotina que estava pausada.",
    parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Nome da rotina a retomar" } },
        required: ["name"]
    },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        return resumeRoutine(chatId, args.name);
    }
});

registerTool({
    name: "delete_routine",
    description: "Deleta permanentemente uma rotina automatizada.",
    parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Nome da rotina a deletar" } },
        required: ["name"]
    },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        return deleteRoutine(chatId, args.name);
    }
});

console.log("⚙️ Routine Manager tools registered: create_routine, list_routines, pause_routine, resume_routine, delete_routine");
