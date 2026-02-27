/**
 * Code Sandbox — Safe Self-Modification Layer
 *
 * Allows the bot to modify its own codebase with safety:
 *   1. Creates a git branch for each change proposal
 *   2. Sends diff + inline approve/reject buttons to user via Telegram
 *   3. On approval: merges branch + restarts process
 *   4. On rejection: deletes branch + notifies
 *
 * Security:
 *   - Only files under src/ and package.json
 *   - Blacklisted: .env, config.ts, security.ts, secrets.ts
 *   - Max 50KB per file, max 5 files per proposal
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import * as os from "os";
import { bot } from "./telegram-client.js";
import { config } from "./config.js";
import { InlineKeyboard } from "grammy";
import { registerTool } from "./tools/registry.js";
import { withRetry } from "./utils/network.js";

// ── Constants ─────────────────────────────────────────────────────────
const PROJECT_ROOT = process.cwd();
const MAX_FILE_SIZE = 50 * 1024; // 50KB
const MAX_FILES_PER_PROPOSAL = 5;
const BLACKLISTED_FILES = ["config.ts", "security.ts", "secrets.ts", ".env", ".env.local"];
const ALLOWED_DIRS = ["src"];

// ── Proposal Database ─────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const db = new Database(path.join(GRAVITY_DIR, "proposals.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS code_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    description TEXT NOT NULL,
    diff TEXT,
    files_changed TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );
`);

console.log("🔒 Code Sandbox ready (proposals.sqlite)");

// ── Validation ────────────────────────────────────────────────────────

function isAllowedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    // Must be in allowed directories
    const inAllowedDir = ALLOWED_DIRS.some(dir => normalized.startsWith(`${dir}/`) || normalized === dir);
    // Or be package.json at root
    const isRootFile = normalized === "package.json";
    if (!inAllowedDir && !isRootFile) return false;

    // Must not be blacklisted
    const basename = path.basename(normalized);
    if (BLACKLISTED_FILES.includes(basename)) return false;

    // No path traversal
    if (normalized.includes("..")) return false;

    return true;
}

// ── Git Helpers ───────────────────────────────────────────────────────

function git(cmd: string): string {
    return execSync(`git ${cmd}`, { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 15000 }).trim();
}

function getCurrentBranch(): string {
    return git("rev-parse --abbrev-ref HEAD");
}

function branchExists(name: string): boolean {
    try {
        git(`rev-parse --verify ${name}`);
        return true;
    } catch { return false; }
}

// ── Core Functions ────────────────────────────────────────────────────

/**
 * Read a project file (restricted to allowed paths)
 */
export function readProjectFile(filePath: string): { content: string } | { error: string } {
    if (!isAllowedPath(filePath)) {
        return { error: `🚫 Acesso negado: "${filePath}" não é permitido. Apenas arquivos em src/ ou package.json.` };
    }

    const absPath = path.join(PROJECT_ROOT, filePath);
    if (!fs.existsSync(absPath)) {
        return { error: `❌ Arquivo não encontrado: ${filePath}` };
    }

    const stats = fs.statSync(absPath);
    if (stats.size > MAX_FILE_SIZE) {
        return { error: `❌ Arquivo muito grande (${Math.round(stats.size / 1024)}KB). Máximo: ${MAX_FILE_SIZE / 1024}KB.` };
    }

    return { content: fs.readFileSync(absPath, "utf-8") };
}

/**
 * Propose a code change — creates branch, commits, sends approval request
 */
export async function proposeCodeChange(
    chatId: string,
    files: { path: string; content: string }[],
    description: string
): Promise<string> {
    // Validate
    if (files.length === 0) return "❌ Nenhum arquivo para alterar.";
    if (files.length > MAX_FILES_PER_PROPOSAL) return `❌ Máximo ${MAX_FILES_PER_PROPOSAL} arquivos por proposta.`;

    for (const f of files) {
        if (!isAllowedPath(f.path)) {
            return `🚫 Acesso negado: "${f.path}" é protegido ou fora do escopo.`;
        }
        if (Buffer.byteLength(f.content, "utf-8") > MAX_FILE_SIZE) {
            return `❌ "${f.path}" excede ${MAX_FILE_SIZE / 1024}KB.`;
        }
    }

    const originalBranch = getCurrentBranch();
    const timestamp = Date.now();
    const slug = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .substring(0, 30)
        .replace(/-$/, "");
    const branchName = `auto/${timestamp}-${slug}`;

    try {
        // 1. Create branch and commit
        git(`checkout -b ${branchName}`);

        for (const f of files) {
            const absPath = path.join(PROJECT_ROOT, f.path);
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(absPath, f.content, "utf-8");
        }

        const filePaths = files.map(f => f.path).join(" ");
        git(`add ${filePaths}`);
        git(`commit -m "auto: ${description}"`);

        // 2. Get diff
        const diff = git(`diff ${originalBranch}..${branchName} --stat`);
        const diffDetail = git(`diff ${originalBranch}..${branchName} -- ${filePaths}`);

        // 3. Switch back to original branch
        git(`checkout ${originalBranch}`);

        // 4. Save proposal to DB
        const result = db.prepare(`
            INSERT INTO code_proposals (chat_id, branch_name, description, diff, files_changed, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(chatId, branchName, description, diffDetail, JSON.stringify(files.map(f => f.path)));

        const proposalId = result.lastInsertRowid;

        // 5. Send to Telegram with inline buttons
        const truncatedDiff = diffDetail.length > 2000
            ? diffDetail.substring(0, 2000) + "\n... (diff truncado)"
            : diffDetail;

        const message =
            `🔧 *Proposta de Código #${proposalId}*\n\n` +
            `📝 ${description}\n\n` +
            `📊 *Resumo:*\n\`\`\`\n${diff}\n\`\`\`\n\n` +
            `📄 *Diff:*\n\`\`\`\n${truncatedDiff}\n\`\`\`\n\n` +
            `Aprovar para fazer merge na branch \`${originalBranch}\` e reiniciar o bot.`;

        const keyboard = new InlineKeyboard()
            .text("✅ Aprovar", `code_approve:${proposalId}`)
            .text("❌ Rejeitar", `code_reject:${proposalId}`);

        if (config.allowedUserIds.includes(Number(chatId))) {
            await withRetry(
                () => bot.api.sendMessage(chatId, message, {
                    parse_mode: "Markdown",
                    reply_markup: keyboard,
                }),
                { maxRetries: 2 }
            );
        }

        return `✅ Proposta #${proposalId} criada e enviada para aprovação.\n\nBranch: \`${branchName}\`\nArquivos: ${files.map(f => f.path).join(", ")}`;
    } catch (err) {
        // Cleanup: go back to original branch
        try { git(`checkout ${originalBranch}`); } catch { /* ignore */ }
        if (branchExists(branchName)) {
            try { git(`branch -D ${branchName}`); } catch { /* ignore */ }
        }
        const msg = err instanceof Error ? err.message : String(err);
        return `❌ Erro ao criar proposta: ${msg}`;
    }
}

/**
 * Apply an approved proposal — merge branch + restart
 */
export async function applyProposal(proposalId: number, chatId: string): Promise<void> {
    const proposal = db.prepare("SELECT * FROM code_proposals WHERE id = ? AND status = 'pending'").get(proposalId) as any;
    if (!proposal) {
        await sendMsg(chatId, `❌ Proposta #${proposalId} não encontrada ou já processada.`);
        return;
    }

    try {
        const currentBranch = getCurrentBranch();
        git(`merge ${proposal.branch_name} --no-ff -m "merge: ${proposal.description}"`);
        git(`branch -d ${proposal.branch_name}`);

        db.prepare("UPDATE code_proposals SET status = 'approved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(proposalId);

        await sendMsg(chatId,
            `✅ *Proposta #${proposalId} aplicada!*\n\n` +
            `Branch \`${proposal.branch_name}\` merged em \`${currentBranch}\`.\n` +
            `♻️ Reiniciando em 3 segundos...`
        );

        // Push changes
        try { git(`push origin ${currentBranch}`); } catch { /* might fail if no remote */ }

        // Restart process after a short delay
        setTimeout(() => {
            console.log("♻️ Restarting process after code approval...");
            process.exit(0); // Will be restarted by the process manager
        }, 3000);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.prepare("UPDATE code_proposals SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(proposalId);
        await sendMsg(chatId, `❌ Merge falhou para proposta #${proposalId}: ${msg}\n\nProposta marcada como rejeitada.`);
    }
}

/**
 * Reject a proposal — delete branch
 */
export async function rejectProposal(proposalId: number, chatId: string): Promise<void> {
    const proposal = db.prepare("SELECT * FROM code_proposals WHERE id = ? AND status = 'pending'").get(proposalId) as any;
    if (!proposal) {
        await sendMsg(chatId, `❌ Proposta #${proposalId} não encontrada ou já processada.`);
        return;
    }

    try {
        if (branchExists(proposal.branch_name)) {
            git(`branch -D ${proposal.branch_name}`);
        }
    } catch { /* ignore */ }

    db.prepare("UPDATE code_proposals SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(proposalId);
    await sendMsg(chatId, `🗑️ Proposta #${proposalId} rejeitada.\nBranch \`${proposal.branch_name}\` deletada.`);
}

/**
 * List pending proposals
 */
export function getPendingProposals(chatId: string): any[] {
    return db.prepare("SELECT id, description, branch_name, created_at FROM code_proposals WHERE chat_id = ? AND status = 'pending' ORDER BY created_at DESC").all(chatId) as any[];
}

// ── Helper ────────────────────────────────────────────────────────────

async function sendMsg(chatId: string, text: string) {
    if (!config.allowedUserIds.includes(Number(chatId))) return;
    try {
        await withRetry(
            () => bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" }),
            { maxRetries: 2 }
        );
    } catch (err) {
        console.error(`❌ Failed to send sandbox message:`, err);
    }
}

// ── Register Tools ────────────────────────────────────────────────────

registerTool({
    name: "read_project_file",
    description: "Lê um arquivo do projeto Gravity Claw. Apenas arquivos em src/ e package.json são permitidos. Use para entender o código antes de propor mudanças.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Caminho relativo ao projeto (ex: src/scheduler.ts)" }
        },
        required: ["path"]
    },
    execute: async ({ path: filePath }) => {
        const result = readProjectFile(filePath as string);
        if ("error" in result) return result.error;
        return `📄 **${filePath}** (${result.content.length} chars):\n\`\`\`\n${result.content}\n\`\`\``;
    }
});

registerTool({
    name: "propose_code_change",
    description: "Propõe uma mudança no código do Gravity Claw. Cria uma branch git, commita as alterações, e envia um diff para o usuário aprovar via Telegram. O merge só acontece após aprovação explícita. Use quando o usuário pedir para criar funções, modificar comportamentos, ou adicionar features.",
    parameters: {
        type: "object",
        properties: {
            description: { type: "string", description: "Descrição concisa da mudança (será o commit message)" },
            files: {
                type: "array",
                description: "Lista de arquivos a alterar. Cada item tem 'path' (relativo) e 'content' (conteúdo completo do arquivo).",
                items: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Caminho relativo (ex: src/tools/new-tool.ts)" },
                        content: { type: "string", description: "Conteúdo completo do arquivo" }
                    },
                    required: ["path", "content"]
                }
            }
        },
        required: ["description", "files"]
    },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        return await proposeCodeChange(chatId, args.files, args.description);
    }
});

registerTool({
    name: "list_code_proposals",
    description: "Lista propostas de código pendentes de aprovação.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (args: any) => {
        const chatId = args._chatId || config.allowedUserIds[0]?.toString() || "";
        const proposals = getPendingProposals(chatId);
        if (proposals.length === 0) return "📋 Nenhuma proposta pendente.";
        const list = proposals.map((p: any) =>
            `• #${p.id}: ${p.description} (branch: \`${p.branch_name}\`, criada: ${p.created_at})`
        ).join("\n");
        return `📋 **Propostas pendentes:**\n${list}`;
    }
});

console.log("🔒 Code Sandbox tools registered: read_project_file, propose_code_change, list_code_proposals");
