import { registerTool } from "../tools/registry.js";
import { sessionManager } from "./manager.js";
import { runFinanceAgent } from "../finance-agent.js";
import OpenAI from "openai";

const FINANCE_SYSTEM_PROMPT = `Você é um planejador financeiro, economista chefe e agente autônomo. Você é especialista em traçar projetos financeiros, planos de fuga de dívidas e construção de reservas de emergência.

REGRAS:
1. Pense detalhadamente. Forneça planos mensuráveis (com valores tangíveis) baseados sempre na demanda do usuário.
2. Analise os cenários usando lógica econômica sólida.
3. Esteja focado em respostas assertivas, práticas e diretas para quem quer melhorar de vida.
4. Você deve agir como um conselheiro "CFO" financeiro premium.
5. Sempre responda em pt-BR de forma clara e profissional. Use markdown para deixar a leitura fácil e bonita.`;

export function registerSessionTools() {
    registerTool({
        name: "sessions_list",
        description: "Lista todas as sessões ativas com sub-agentes.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            const sessions = sessionManager.listSessions();
            if (sessions.length === 0) return "Nenhuma sessão ativa no momento.";

            return sessions.map(s =>
                `ID: ${s.id} | Agente: ${s.agentType} | Atualizado: ${new Date(s.updatedAt).toLocaleTimeString()}`
            ).join("\\n");
        }
    });

    registerTool({
        name: "sessions_history",
        description: "Retorna o histórico completo de uma sessão ativa específica.",
        parameters: {
            type: "object",
            properties: {
                sessionId: { type: "string", description: "O ID curto da sessão." }
            },
            required: ["sessionId"]
        },
        execute: async ({ sessionId }) => {
            const session = sessionManager.getSession(sessionId as string);
            if (!session) return `❌ Sessão ${sessionId} não encontrada.`;

            return session.history.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\\n\\n");
        }
    });

    registerTool({
        name: "sessions_send",
        description: "Envia uma mensagem para uma sessão com um sub-agente especializado (ex: financeiro). Se o sessionId não existir, uma nova sessão será criada. O histórico é mantido para que vocês possam conversar de forma contínua.",
        parameters: {
            type: "object",
            properties: {
                sessionId: { type: "string", description: "O ID da sessão. Passe 'new' para criar uma nova sessão." },
                agentType: { type: "string", description: "O tipo de agente (ex: 'finance'). Requerido se for uma nova sessão." },
                message: { type: "string", description: "A mensagem que você quer enviar para o sub-agente." }
            },
            required: ["sessionId", "message"]
        },
        execute: async ({ sessionId, agentType, message }) => {
            let id = sessionId as string;
            let type = agentType as string;

            if (id === "new") {
                if (!type) return "❌ Você precisa especificar o 'agentType' (ex: 'finance') ao criar uma nova sessão.";

                let initialPrompt = "";
                if (type === "finance") initialPrompt = FINANCE_SYSTEM_PROMPT;
                else return `❌ Tipo de agente desconhecido: ${type}`;

                id = sessionManager.createSession(type, initialPrompt);
                console.log(`[Sessions] Orquestrador criou nova sessão: ${id}`);
            }

            const session = sessionManager.getSession(id);
            if (!session) return `❌ Sessão ${id} não encontrada.`;

            // Append orchestrator's message (as 'user' from the sub-agent's perspective)
            sessionManager.appendMessage(id, { role: "user", content: message as string });

            try {
                let reply = "";
                if (session.agentType === "finance") {
                    reply = await runFinanceAgent(session.history as OpenAI.Chat.Completions.ChatCompletionMessageParam[]);
                } else {
                    return `❌ Engine não configurada para o agente tipo: ${session.agentType}`;
                }

                // Append sub-agent's reply
                sessionManager.appendMessage(id, { role: "assistant", content: reply });

                return `🟢 [Sessão ${id}]: ${reply}`;
            } catch (err: any) {
                return `❌ Erro no sub-agente: ${err.message}`;
            }
        }
    });
}
