import OpenAI from "openai";
import Groq from "groq-sdk";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";

// ── Clients ──────────────────────────────────────────────
const openRouterClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.openRouterKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/gravity-claw",
        "X-Title": "Gravity Claw",
    },
});

const groqClient = config.groqApiKey
    ? new Groq({ apiKey: config.groqApiKey })
    : null;

const modalClient = (config.modalBaseUrl && config.modalApiKey)
    ? new OpenAI({
        baseURL: config.modalBaseUrl,
        apiKey: config.modalApiKey,
    })
    : null;

// ── Models ────────────────────────────────────────────────
const MODELS = {
    openRouter: {
        standard: "google/gemini-2.5-flash",
        thinking: "qwen/qwen3-235b-a22b-thinking-2507",
        fast: "google/gemini-2.5-flash",
    },
    groq: {
        standard: "llama-3.3-70b-versatile",
        thinking: "llama-3.3-70b-versatile",
        fast: "llama-3.3-70b-versatile",
    },
    modal: {
        standard: "zai-org/GLM-5-FP8",
        thinking: "zai-org/GLM-5-FP8",
        fast: "zai-org/GLM-5-FP8",
    },
};

// ── Thinking Level State ─────────────────────────────────
let globalThinkingLevel: 'off' | 'low' | 'medium' | 'high' = 'off';

export function setThinkingLevel(level: 'off' | 'low' | 'medium' | 'high') {
    globalThinkingLevel = level;
}

// ── Retry Helper ─────────────────────────────────────────
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * attempt;
                console.warn(`⚠️ Operation failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }
    throw lastError;
}

// ── History Sanitization (CRITICAL FIX) ──────────────────
/**
 * Sanitizes the message array before sending to any LLM provider.
 * 
 * The problem: Chat history loaded from the DB may contain `tool` role messages
 * without `tool_call_id`, and `assistant` messages without proper `tool_calls`.
 * OpenRouter and Groq reject these with HTTP 400.
 * 
 * Solution: We strip any messages from history that would be invalid:
 * 1. Remove `tool` role messages that lack `tool_call_id`
 * 2. Remove `assistant` messages that have `tool_calls` but whose corresponding
 *    `tool` responses are not in the array
 * 3. Remove `null` content from assistant messages (Gemini crashes on null)
 */
function sanitizeMessages(messages: Message[]): Message[] {
    const sanitized: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i] as any;

        // Skip tool messages without tool_call_id (the root cause of 400 errors)
        if (msg.role === 'tool' && !msg.tool_call_id) {
            continue;
        }

        // Handle assistant messages with tool_calls
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            // Check if ALL corresponding tool responses exist after this message
            const expectedIds = new Set(msg.tool_calls.map((tc: any) => tc.id));
            const remainingMessages = messages.slice(i + 1);
            const foundIds = new Set(
                remainingMessages
                    .filter((m: any) => m.role === 'tool' && m.tool_call_id)
                    .map((m: any) => m.tool_call_id)
            );

            const allFound = [...expectedIds].every(id => foundIds.has(id));

            if (allFound) {
                // Keep the assistant message but fix null content
                const { content, ...rest } = msg;
                sanitized.push(content === null ? rest as Message : msg);
            } else {
                // Tool responses are missing — convert to a plain assistant message
                // with just the text content (if any), dropping tool_calls
                if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
                    sanitized.push({ role: 'assistant', content: msg.content } as Message);
                }
                // Otherwise skip entirely — an assistant message with only tool_calls but no matching
                // tool results will cause API errors
            }
            continue;
        }

        // Handle assistant messages with null content (no tool_calls)
        if (msg.role === 'assistant' && msg.content === null) {
            continue; // Skip empty assistant messages
        }

        sanitized.push(msg);
    }

    return sanitized;
}

// ── Chat ─────────────────────────────────────────────────
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const tools = getOpenAITools();

    // Determine models based on thinking level
    let tierKey: 'standard' | 'thinking' | 'fast' = 'standard';
    if (globalThinkingLevel === 'high') tierKey = 'thinking';
    if (globalThinkingLevel === 'off') tierKey = 'fast';

    const openRouterModel = MODELS.openRouter[tierKey];
    const groqModel = MODELS.groq[tierKey];
    const modalModel = MODELS.modal[tierKey];

    // CRITICAL: Sanitize messages to remove malformed tool messages from history
    const sanitizedMessages = sanitizeMessages(messages);

    const baseArgs = {
        max_tokens: 4096,
        messages: sanitizedMessages,
        tools: tools.length > 0 ? tools : undefined,
    };

    // ── Provider 1: OpenRouter (Primary) ─────────────────
    try {
        console.log(`🤖 Requesting LLM (Primary: OpenRouter [${openRouterModel}])...`);
        const startTime = Date.now();
        const response = await retryWithBackoff(() =>
            openRouterClient.chat.completions.create({
                model: openRouterModel,
                ...baseArgs,
            })
        );
        console.log(`✅ LLM Response received from OpenRouter in ${Date.now() - startTime}ms`);
        return response;
    } catch (error) {
        console.warn(`⚠️ OpenRouter failed: ${error instanceof Error ? error.message : String(error)}. Trying Groq...`);
    }

    // ── Provider 2: Groq (Fallback 1) ────────────────────
    if (groqClient) {
        try {
            console.log(`🤖 Requesting LLM (Fallback 1: Groq [${groqModel}])...`);
            const startTime = Date.now();
            const response = await retryWithBackoff(() =>
                groqClient.chat.completions.create({
                    model: groqModel,
                    max_tokens: 4096,
                    messages: sanitizedMessages as any,
                    tools: tools.length > 0 ? tools as any : undefined,
                })
            );
            console.log(`✅ LLM Response received from Groq in ${Date.now() - startTime}ms`);
            return response as unknown as OpenAI.Chat.Completions.ChatCompletion;
        } catch (error) {
            console.warn(`⚠️ Groq failed: ${error instanceof Error ? error.message : String(error)}. Trying Modal...`);
        }
    } else {
        console.warn(`⚠️ Groq client not available (no API key). Trying Modal...`);
    }

    // ── Provider 3: Modal (Fallback 2) ───────────────────
    if (modalClient) {
        console.log(`🤖 Requesting LLM (Fallback 2: Modal [${modalModel}])...`);
        const startTime = Date.now();
        // No retry for the last fallback — let the error propagate
        const response = await modalClient.chat.completions.create({
            model: modalModel,
            ...baseArgs,
        });
        console.log(`✅ LLM Response received from Modal in ${Date.now() - startTime}ms`);
        return response;
    }

    throw new Error("❌ All LLM providers failed. Check your API keys and network connection.");
}
