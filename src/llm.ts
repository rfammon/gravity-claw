import OpenAI from "openai";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";

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
    modal: {
        standard: "zai-org/GLM-5-FP8",
        thinking: "zai-org/GLM-5-FP8",
        fast: "zai-org/GLM-5-FP8",
    },
    openRouter: {
        standard: "qwen/qwen-2.5-72b-instruct",
        thinking: "qwen/qwen3-235b-a22b-thinking-2507",
        fast: "qwen/qwen-2.5-72b-instruct",
    }
};

// ── State (Simple thinking level state - could be moved to memory.ts later) ─
let globalThinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

export function setThinkingLevel(level: 'off' | 'low' | 'medium' | 'high') {
    globalThinkingLevel = level;
}

// ── chat ─────────────────────────────────────────────────
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const tools = getOpenAITools();

    // Determine models based on thinking level
    let modalModel = MODELS.modal.standard;
    let openRouterModel = MODELS.openRouter.standard;
    if (globalThinkingLevel === 'high') {
        modalModel = MODELS.modal.thinking;
        openRouterModel = MODELS.openRouter.thinking;
    }
    if (globalThinkingLevel === 'off') {
        modalModel = MODELS.modal.fast;
        openRouterModel = MODELS.openRouter.fast;
    }

    console.log(`🤖 Requesting LLM (Primary: Modal [${modalModel}], Fallback: OpenRouter [${openRouterModel}])...`);
    const startTime = Date.now();

    // Sanitize messages for Gemini via OpenRouter (null content crashes the request)
    const sanitizedMessages = messages.map(msg => {
        // Remove 'timestamp' as OpenRouter Gemini rejects it
        const { timestamp, ...msgWithoutTimestamp } = msg as any;

        if (msgWithoutTimestamp.role === 'assistant' && msgWithoutTimestamp.content === null && msgWithoutTimestamp.tool_calls) {
            const { content, ...rest } = msgWithoutTimestamp;
            return rest as Message;
        }
        return msgWithoutTimestamp as Message;
    });

    const callArgs: any = {
        max_tokens: 4096,
        messages: sanitizedMessages, // Agent now handles system prompt injection
        tools: tools.length > 0 ? tools : undefined,
    };

    try {
        const response = await modalClient.chat.completions.create({
            model: modalModel,
            ...callArgs
        });
        console.log(`✅ LLM Response received from Modal in ${Date.now() - startTime}ms`);
        return response;
    } catch (error) {
        console.warn(`⚠️ Modal API failed: ${error instanceof Error ? error.message : String(error)}. Falling back to OpenRouter...`);
        const fallbackStartTime = Date.now();
        const response = await openRouterClient.chat.completions.create({
            model: openRouterModel,
            ...callArgs
        });
        console.log(`✅ LLM Response received from OpenRouter in ${Date.now() - fallbackStartTime}ms`);
        return response;
    }
}
