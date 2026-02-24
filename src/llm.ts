import OpenAI from "openai";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";
import { puterChat } from "./llm-utils.js";
import { withRetry } from "./utils/network.js";
import { ollamaChat } from "./ollama.js";

// ── clients ──────────────────────────────────────────────
const openRouterClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.openRouterKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/gravity-claw",
        "X-Title": "Gravity Claw",
    },
});

const modalClient = new OpenAI({
    baseURL: config.modalBaseUrl,
    apiKey: config.modalApiKey,
});

// ── Models ────────────────────────────────────────────────
const MODELS = {
    puter: {
        standard: config.puterDefaultModel || "moonshotai/kimi-k2.5",
    },
    modal: {
        standard: "zai-org/GLM-5-FP8",
    },
    openRouter: {
        standard: "google/gemini-2.0-flash-001",
    },
    ollama: {
        simple: "qwen2.5:0.5b",
        standard: "llama3.2:3b",
    }
};

// ── State (Simple thinking level state) ─
let globalThinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

export function setThinkingLevel(level: 'off' | 'low' | 'medium' | 'high') {
    globalThinkingLevel = level;
}

// ── chat ─────────────────────────────────────────────────
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function parseTextToToolCalls(text: string): { content: string, tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] } {
    let content = text;
    const tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

    // Support both <functioncalls> and <function_calls>
    const functionCallsRegex = /<function_?calls>([\s\S]*?)<\/function_?calls>/gi;
    const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;

    let callIndex = 0;

    content = text.replace(functionCallsRegex, (substring, innerBlocks) => {
        let invokeMatch;
        while ((invokeMatch = invokeRegex.exec(innerBlocks)) !== null) {
            const name = invokeMatch[1];
            const paramsInner = invokeMatch[2];
            const args: any = {};

            let paramMatch;
            while ((paramMatch = paramRegex.exec(paramsInner)) !== null) {
                args[paramMatch[1]] = paramMatch[2].trim();
            }

            tool_calls.push({
                id: `call_${Date.now()}_${callIndex++}`,
                type: "function",
                function: {
                    name,
                    arguments: JSON.stringify(args)
                }
            });
        }
        return ""; // Remove from text
    });

    return {
        content: content.trim(),
        tool_calls: tool_calls.length > 0 ? tool_calls as any[] : undefined
    };
}

export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const tools = getOpenAITools();
    const startTime = Date.now();

    // Sanitize messages
    const sanitizedMessages = messages.map(msg => {
        if (msg.role === 'assistant' && msg.content === null && msg.tool_calls) {
            const { content, ...rest } = msg as any;
            return rest as Message;
        }
        return msg;
    });

    const systemInstruction = tools.length > 0 ? `\n\n[FERRAMENTAS DISPONÍVEIS]\nVocê DEVE usar OBRIGATORIAMENTE o seguinte formato XML para invocar funções:\n<function_calls>\n` +
        tools.map((t: any) => `<invoke name="${t.function.name}">\n${Object.keys(t.function.parameters?.properties || {}).map(
            (p: any) => `<parameter name="${p}">[valor]</parameter>`
        ).join("\n")
            }\n</invoke>`).join("\n") + `\n</function_calls>\n\nNunca escreva o código XML dentro de blocos de markdown. Apenas printe o XML direto no texto.` : "";

    const messagesWithToolsInstruction = sanitizedMessages.map((m, i) => {
        if (i === 0 && m.role === "system") {
            return { ...m, content: String(m.content) + systemInstruction };
        }
        return m;
    });

    const callArgs: any = {
        max_tokens: 4096,
        messages: sanitizedMessages,
        tools: tools.length > 0 ? tools : undefined,
    };

    // ── CHECK FOR SIMPLE TASK (Local Ollama Priority) ──────────
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || "";
    const isSimpleTask = typeof lastUserMessage === 'string' &&
        (lastUserMessage.toLowerCase().includes("status report") ||
            lastUserMessage.length < 20);

    if (isSimpleTask) {
        try {
            console.log(`🤖 Requesting LLM (Simple Task: Ollama [${MODELS.ollama.simple}])...`);
            const text = await withRetry(
                () => ollamaChat(messagesWithToolsInstruction as any, MODELS.ollama.simple),
                { maxRetries: 1 }
            );
            return {
                choices: [{ message: { role: "assistant", content: text } }]
            };
        } catch (error) {
            console.warn(`⚠️ Ollama simple task failed, falling back to cloud stack...`);
        }
    }

    // ── PRIMARY: PUTER ─────────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Primary: Puter [${MODELS.puter.standard}])...`);
        const text = await withRetry(
            () => puterChat(messagesWithToolsInstruction as any, MODELS.puter.standard),
            { maxRetries: 2 }
        );

        console.log(`✅ LLM Response received from Puter in ${Date.now() - startTime}ms`);

        const parsed = parseTextToToolCalls(text);

        // Mocking OpenAI response structure for compatibility with agent.ts
        return {
            choices: [{
                message: {
                    role: "assistant",
                    content: parsed.content,
                    tool_calls: parsed.tool_calls
                }
            }]
        };
    } catch (error) {
        console.warn(`⚠️ Puter failed: ${error instanceof Error ? error.message : String(error)}. Trying Modal...`);
    }

    // ── FALLBACK 1: MODAL ──────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Fallback 1: Modal [${MODELS.modal.standard}])...`);
        const modalStartTime = Date.now();
        const response = await withRetry(
            () => modalClient.chat.completions.create({
                model: MODELS.modal.standard,
                ...callArgs
            }),
            { maxRetries: 2 }
        );
        console.log(`✅ LLM Response received from Modal in ${Date.now() - modalStartTime}ms`);
        return response;
    } catch (error) {
        console.warn(`⚠️ Modal failed: ${error instanceof Error ? error.message : String(error)}. Trying OpenRouter...`);
    }

    // ── FALLBACK 2: OPENROUTER ─────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Fallback 2: OpenRouter [${MODELS.openRouter.standard}])...`);
        const orStartTime = Date.now();
        const response = await withRetry(
            () => openRouterClient.chat.completions.create({
                model: MODELS.openRouter.standard,
                ...callArgs
            }),
            { maxRetries: 2 }
        );
        console.log(`✅ LLM Response received from OpenRouter in ${Date.now() - orStartTime}ms`);
        return response;
    } catch (error) {
        console.warn(`⚠️ OpenRouter failed. Trying Local Ollama as ultimate fallback...`);
    }

    // ── FALLBACK 3: OLLAMA (Local) ─────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Final Fallback: Ollama [${MODELS.ollama.standard}])...`);
        const text = await withRetry(
            () => ollamaChat(messagesWithToolsInstruction as any, MODELS.ollama.standard),
            { maxRetries: 1 }
        );

        const parsed = parseTextToToolCalls(text);

        return {
            choices: [{
                message: {
                    role: "assistant",
                    content: parsed.content,
                    tool_calls: parsed.tool_calls
                }
            }]
        };
    } catch (error) {
        console.error(`❌ All LLM providers failed (including local)! Last error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

