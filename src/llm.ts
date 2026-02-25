import OpenAI from "openai";
import Groq from "groq-sdk";
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

const groqClient = new Groq({
    apiKey: config.groqApiKey,
});

// ── Models ────────────────────────────────────────────────
const MODELS = {
    openRouter: {
        standard: "google/gemini-2.5-flash", // Correct ID (OpenRouter usually maps without the :free suffix if free is active or we use the base one)
    },
    groq: {
        standard: "llama-3.3-70b-versatile",
    },
    modal: {
        standard: "zai-org/GLM-5-FP8",
    },
    puter: {
        standard: config.puterDefaultModel || "moonshotai/kimi-k2.5",
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

    content = content.replace(functionCallsRegex, (substring, innerBlocks) => {
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

    // Support Moonshot "kimi" custom tool syntax
    // <|toolcallbegin|> functions.getcurrenttime:1 <|toolcallargumentbegin|> {"timezone": "America/SaoPaulo"} <|toolcallend|>
    const moonshotRegex = /<\|\s*tool_?call_?begin\s*\|>\s*(?:functions\.)?([a-zA-Z0-9_\-]+)(?::\d+)?\s*(?:<\|\s*tool_?call_?argument_?begin\s*\|>)?\s*({[\s\S]*?})\s*<\|\s*tool_?call_?end\s*\|>/gi;

    content = content.replace(moonshotRegex, (substring, name, argsJson) => {
        try {
            // Validate it's parseable JSON
            JSON.parse(argsJson);
            tool_calls.push({
                id: `call_${Date.now()}_${callIndex++}`,
                type: "function",
                function: {
                    name: name.trim(),
                    arguments: argsJson.trim()
                }
            });
        } catch (e) {
            console.warn("Failed to parse moonshot tool arguments:", argsJson);
        }
        return ""; // Remove from output text
    });

    // Remove the section wrappers if they exist
    content = content.replace(/<\|\s*tool_?calls_?section_?begin\s*\|>/gi, "");
    content = content.replace(/<\|\s*tool_?calls_?section_?end\s*\|>/gi, "");

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
        // Remove 'timestamp' as Groq/OpenAI reject it
        const { timestamp, ...msgWithoutTimestamp } = msg as any;

        if (msgWithoutTimestamp.role === 'assistant' && msgWithoutTimestamp.content === null && msgWithoutTimestamp.tool_calls) {
            const { content, ...rest } = msgWithoutTimestamp;
            return rest as Message;
        }
        return msgWithoutTimestamp as Message;
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

    // [NOTE]: Simple task shortcut removed — qwen2.5:0.5b was parroting raw JSON from
    // conversation history when receiving short messages (< 20 chars) like "Pessoal" or
    // "Bom dia". This caused an infinite loop of raw JSON responses.
    // All tasks now go through the cloud primary (Puter) or full Ollama fallback.

    // ── PRIMARY: OPENROUTER ─────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Primary: OpenRouter [${MODELS.openRouter.standard}])...`);
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
        console.warn(`⚠️ OpenRouter failed: ${error instanceof Error ? error.message : String(error)}. Trying Groq...`);
    }

    // ── FALLBACK 1: GROQ ───────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Fallback 1: Groq [${MODELS.groq.standard}])...`);
        const groqStartTime = Date.now();
        const response = await withRetry(
            () => groqClient.chat.completions.create({
                model: MODELS.groq.standard,
                ...callArgs
            }),
            { maxRetries: 2 }
        );
        console.log(`✅ LLM Response received from Groq in ${Date.now() - groqStartTime}ms`);
        return response;
    } catch (error) {
        console.warn(`⚠️ Groq failed: ${error instanceof Error ? error.message : String(error)}. Trying Modal...`);
    }

    // ── FALLBACK 2: MODAL ──────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Fallback 2: Modal [${MODELS.modal.standard}])...`);
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
        console.warn(`⚠️ Modal failed. Trying Local Ollama as ultimate fallback...`);
    }

    // ── FALLBACK 3: OLLAMA (Local) ─────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Final Fallback: Ollama [${MODELS.ollama.standard}])...`);
        const messageObj = await withRetry(
            () => ollamaChat(messagesWithToolsInstruction as any, MODELS.ollama.standard, tools),
            { maxRetries: 1 }
        );

        let parsed;
        if (messageObj.tool_calls && messageObj.tool_calls.length > 0) {
            // Native format support!
            parsed = { content: messageObj.content || "", tool_calls: messageObj.tool_calls };
        } else {
            // Fallback to text parsing if native didn't trigger
            parsed = parseTextToToolCalls(messageObj.content || "");
        }

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

