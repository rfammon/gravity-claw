import axios from "axios";
import { registerTool } from "./registry.js";
import { getCachedCardsByList, getCachedBoards, getLastSyncTime } from "../trello-sync.js";

const TRELLO_BASE = "https://api.trello.com/1";

function getAuth() {
    const key = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    if (!key || !token) {
        throw new Error("❌ Chaves do Trello ausentes no .env (TRELLO_API_KEY e TRELLO_TOKEN)");
    }
    return { key, token };
}

/** List all boards authorized by the token */
registerTool({
    name: "trello_list_boards",
    description: "Lista todos os quadros (boards) do Trello aos quais o bot tem acesso.",
    parameters: { type: "object", properties: {} },
    execute: async () => {
        try {
            const { key, token } = getAuth();
            const response = await axios.get(`${TRELLO_BASE}/members/me/boards`, {
                params: { key, token, fields: "name,url" }
            });
            const boards = response.data.map((b: any) => `- ${b.name} (ID: ${b.id})`).join("\n");
            return `Quadros encontrados:\n${boards}`;
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) return "❌ Erro 401: Token do Trello inválido ou expirado. Verifique o TRELLO_TOKEN no seu .env.";
                if (error.response?.status === 403) return "❌ Erro 403: O bot não tem permissão para acessar este recurso. Verifique as scopes do seu Token.";
                return `❌ Erro no Trello (${error.response?.status}): ${error.message}`;
            }
            throw error;
        }
    }
});

/** Get lists in a board */
registerTool({
    name: "trello_get_board_lists",
    description: "Obtém as listas (colunas) de um quadro específico usando o ID do quadro.",
    parameters: {
        type: "object",
        properties: {
            boardId: { type: "string", description: "O ID do quadro" }
        },
        required: ["boardId"]
    },
    execute: async ({ boardId }) => {
        try {
            const { key, token } = getAuth();
            const response = await axios.get(`${TRELLO_BASE}/boards/${boardId}/lists`, {
                params: { key, token, fields: "name,id" }
            });
            const lists = response.data.map((l: any) => `- ${l.name} (ID: ${l.id})`).join("\n");
            return `Listas no quadro:\n${lists}`;
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) return "❌ Erro 401: Não autorizado. Verifique seu TRELLO_TOKEN.";
                if (error.response?.status === 404) return `❌ Erro 404: O quadro com ID ${boardId} não foi encontrado.`;
                return `❌ Erro no Trello (${error.response?.status}): ${error.message}`;
            }
            throw error;
        }
    }
});

/** Create a card in a list */
registerTool({
    name: "trello_create_card",
    description: "Cria um novo cartão em uma lista específica.",
    parameters: {
        type: "object",
        properties: {
            listId: { type: "string", description: "O ID da lista" },
            name: { type: "string", description: "Título do cartão" },
            desc: { type: "string", description: "Descrição (opcional)" }
        },
        required: ["listId", "name"]
    },
    execute: async ({ listId, name, desc }) => {
        try {
            const { key, token } = getAuth();
            const response = await axios.post(`${TRELLO_BASE}/cards`, null, {
                params: { key, token, idList: listId, name, desc }
            });
            return `✅ Cartão criado: ${response.data.name} (${response.data.url})`;
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                return `❌ Erro ao criar cartão no Trello: ${error.response?.data || error.message}`;
            }
            throw error;
        }
    }
});

/** Get cards in a list */
registerTool({
    name: "trello_get_cards",
    description: "Lista os cartões de uma lista específica.",
    parameters: {
        type: "object",
        properties: {
            listId: { type: "string", description: "O ID da lista" }
        },
        required: ["listId"]
    },
    execute: async ({ listId }) => {
        try {
            const { key, token } = getAuth();
            const response = await axios.get(`${TRELLO_BASE}/lists/${listId}/cards`, {
                params: { key, token, fields: "name,desc" }
            });
            const cards = response.data.map((c: any) => `- ${c.name} (ID: ${c.id}): ${c.desc || '(sem descrição)'}`).join("\n");
            return `Cartões na lista:\n${cards}`;
        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                return `❌ Erro ao listar cartões: ${error.response?.status === 404 ? 'Lista não encontrada' : error.message}`;
            }
            throw error;
        }
    }
});

/** Move a card to a different list */
registerTool({
    name: "trello_move_card",
    description: "Move um cartão para uma lista diferente.",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" },
            listId: { type: "string", description: "O ID da nova lista" }
        },
        required: ["cardId", "listId"]
    },
    execute: async ({ cardId, listId }) => {
        try {
            const { key, token } = getAuth();
            await axios.put(`${TRELLO_BASE}/cards/${cardId}`, null, {
                params: { key, token, idList: listId }
            });
            return `✅ Cartão movido para a lista ${listId}`;
        } catch (error: any) {
            return `❌ Erro ao mover cartão: ${error.message}`;
        }
    }
});

/** Mark a card as complete */
registerTool({
    name: "trello_complete_card",
    description: "Marca um cartão como concluído (check no campo 'dueComplete').",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" }
        },
        required: ["cardId"]
    },
    execute: async ({ cardId }) => {
        try {
            const { key, token } = getAuth();
            await axios.put(`${TRELLO_BASE}/cards/${cardId}`, null, {
                params: { key, token, dueComplete: true }
            });
            return `✅ Cartão marcado como concluído.`;
        } catch (error: any) {
            return `❌ Erro ao concluir cartão: ${error.message}`;
        }
    }
});

/** Add a comment to a card */
registerTool({
    name: "trello_add_comment",
    description: "Adiciona um comentário em um cartão.",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" },
            text: { type: "string", description: "Texto do comentário" }
        },
        required: ["cardId", "text"]
    },
    execute: async ({ cardId, text }) => {
        try {
            const { key, token } = getAuth();
            await axios.post(`${TRELLO_BASE}/cards/${cardId}/actions/comments`, null, {
                params: { key, token, text }
            });
            return `✅ Comentário adicionado.`;
        } catch (error: any) {
            return `❌ Erro ao comentar: ${error.message}`;
        }
    }
});

/** Set a deadline (due date) for a card */
registerTool({
    name: "trello_set_deadline",
    description: "Define um prazo (data de entrega) para um cartão.",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" },
            due: { type: "string", description: "Data no formato ISO (ex: 2024-12-31T23:59:59Z)" }
        },
        required: ["cardId", "due"]
    },
    execute: async ({ cardId, due }) => {
        try {
            const { key, token } = getAuth();
            await axios.put(`${TRELLO_BASE}/cards/${cardId}`, null, {
                params: { key, token, due }
            });
            return `✅ Prazo definido para: ${due}`;
        } catch (error: any) {
            return `❌ Erro ao definir prazo: ${error.message}`;
        }
    }
});

/** Create a checklist and add items */
registerTool({
    name: "trello_add_checklist",
    description: "Cria uma lista de verificação (checklist) em um cartão.",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" },
            name: { type: "string", description: "Nome da checklist (ex: Check-list)" }
        },
        required: ["cardId", "name"]
    },
    execute: async ({ cardId, name }) => {
        try {
            const { key, token } = getAuth();
            const response = await axios.post(`${TRELLO_BASE}/checklists`, null, {
                params: { key, token, idCard: cardId, name }
            });
            return `✅ Checklist criada: ${response.data.name} (ID: ${response.data.id})`;
        } catch (error: any) {
            return `❌ Erro ao criar checklist: ${error.message}`;
        }
    }
});

/** Add an attachment to a card */
registerTool({
    name: "trello_add_attachment",
    description: "Anexa um arquivo ou foto via URL em um cartão.",
    parameters: {
        type: "object",
        properties: {
            cardId: { type: "string", description: "O ID do cartão" },
            url: { type: "string", description: "A URL do arquivo ou foto" },
            name: { type: "string", description: "Nome do anexo (opcional)" }
        },
        required: ["cardId", "url"]
    },
    execute: async ({ cardId, url, name }) => {
        try {
            const { key, token } = getAuth();
            await axios.post(`${TRELLO_BASE}/cards/${cardId}/attachments`, null, {
                params: { key, token, url, name }
            });
            return `✅ Anexo adicionado com sucesso.`;
        } catch (error: any) {
            return `❌ Erro ao anexar: ${error.message}`;
        }
    }
});

// ─── CACHED TOOLS (Anti-Hallucination) ──────────────────────────────
const DEFAULT_BOARD_ID = process.env.TRELLO_BOARD_ID || "";

/** List tasks from SQLite cache — the primary tool for listing Trello tasks */
registerTool({
    name: "trello_list_tasks",
    description: "Lista as tarefas/cartões do Trello lendo do cache local SQLite (sincronizado periodicamente). Use esta ferramenta SEMPRE para listar tarefas — nunca invente nomes de cartões. Se boardId não for informado, usa o quadro padrão (Gestão de Projetos).",
    parameters: {
        type: "object",
        properties: {
            boardId: { type: "string", description: "ID do quadro (opcional, padrão = Gestão de Projetos)" }
        }
    },
    execute: async (args: any) => {
        const targetBoard = args?.boardId || DEFAULT_BOARD_ID;
        if (!targetBoard) {
            // List all boards as a fallback
            const boards = getCachedBoards();
            if (boards.length === 0) return "⚠️ Cache vazio. Aguarde a próxima sincronização ou reinicie o bot.";
            return `Quadros disponíveis no cache:\n${boards.map((b: any) => `• ${b.name} (ID: ${b.id})`).join("\n")}\n\nUse o ID do quadro para listar as tarefas.`;
        }

        const data = getCachedCardsByList(targetBoard);
        const lastSync = getLastSyncTime();

        if (data.length === 0) return "⚠️ Nenhuma lista encontrada no cache para este quadro. Pode ser que a sincronização ainda não rodou.";

        let output = `📋 **TAREFAS DO TRELLO** (Cache atualizado: ${lastSync || "nunca"})\n\n`;
        for (const { listName, cards } of data) {
            if (cards.length === 0) continue;
            output += `**${listName}**\n`;
            for (const card of cards) {
                const dueStr = card.due ? ` 📅 ${card.due.substring(0, 10)}` : "";
                const doneStr = card.due_complete ? " ✅" : "";
                const labelStr = card.labels ? ` [${card.labels}]` : "";
                output += `• ${card.name}${dueStr}${doneStr}${labelStr}\n`;
            }
            output += "\n";
        }
        return output.trim();
    }
});
