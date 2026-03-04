import OpenAI from "openai";
import { config } from "./config.js";
import { registerTool } from "./tools/registry.js";
import { routeChat } from "./llm-router.js";

// ── Finance Agent Runner ─────────────────────────────────────
export async function runFinanceAgent(history: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<string> {
    console.log(`⚡ Finance Agent processing task (History length: ${history.length})...`);
    const startTime = Date.now();

    // Uses the LLM router — routes through all free providers automatically
    const response = await routeChat(history as any, {
        maxTokens: 8192,
    });

    const elapsed = Date.now() - startTime;
    const result = response.choices[0]?.message?.content ?? "⚠️ Finance agent returned no response.";
    console.log(`✅ Finance Agent responded in ${elapsed}ms (${result.length} chars)`);
    return result;
}

// ── Register as a Tool ────────────────────────────────────
registerTool({
    name: "delegate_to_finance_agent",
    description: "Delega uma tarefa de planejamento financeiro complexo (como montar um projeto financeiro focado, buscar melhores taxas para quitar um apartamento, organizar um plano de amortização ou estruturar uma reserva) para o especialista financeiro focado. Use esta ferramenta SEMPRE que a tarefa financeira for complexa e exigir mais raciocínio ou pesquisa. Passe os detalhes financeiros do usuário, saldos, gastos e o pedido original.",
    parameters: {
        type: "object",
        properties: {
            task: {
                type: "string",
                description: "A descrição completa da tarefa e contexto financeiro completo (renda atual, despesas, meta). Seja o mais detalhista possível."
            }
        },
        required: ["task"]
    },
    execute: async ({ task }) => {
        try {
            const systemPrompt = `Você é um planejador financeiro, economista chefe e agente autônomo. Você é especialista em traçar projetos financeiros, planos de fuga de dívidas e construção de reservas de emergência.

REGRAS:
1. Pense detalhadamente. Forneça planos mensuráveis (com valores tangíveis) baseados sempre na demanda do usuário.
2. Analise os cenários usando lógica econômica sólida.
3. Esteja focado em respostas assertivas, práticas e diretas para quem quer melhorar de vida.
4. Você deve agir como um conselheiro "CFO" financeiro premium.
5. Sempre responda em pt-BR de forma clara e profissional. Use markdown para deixar a leitura fácil e bonita.`;

            const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: "system", content: systemPrompt },
                { role: "user", content: task as string }
            ];

            return await runFinanceAgent(history);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Finance Agent error: ${msg}`);
            return JSON.stringify({ error: `Finance Agent failed: ${msg}` });
        }
    }
});
