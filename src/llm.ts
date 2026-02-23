import OpenAI from "openai";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";
import { puterChat } from "./llm-utils.js";
import { withRetry } from "./utils/network.js";

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
        standard: "google/gemini-2.0-flash-001", // Upgrade from Qwen to reduce hallucinations
    }
};

// ── State (Simple thinking level state) ─
let globalThinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

export function setThinkingLevel(level: 'off' | 'low' | 'medium' | 'high') {
    globalThinkingLevel = level;
}

// ── chat ─────────────────────────────────────────────────
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

    const callArgs: any = {
        max_tokens: 4096,
        messages: sanitizedMessages,
        tools: tools.length > 0 ? tools : undefined,
    };

    // ── PRIMARY: PUTER ─────────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Primary: Puter [${MODELS.puter.standard}])...`);
        const text = await withRetry(
            () => puterChat(sanitizedMessages as any, MODELS.puter.standard),
            { maxRetries: 2 }
        );

        console.log(`✅ LLM Response received from Puter in ${Date.now() - startTime}ms`);

        // Mocking OpenAI response structure for compatibility with agent.ts
        return {
            choices: [{
                message: {
                    role: "assistant",
                    content: text,
                    tool_calls: undefined // Puter standard chat doesn't support tools easily yet via this wrapper
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
        console.error(`❌ All LLM providers failed! Last error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

