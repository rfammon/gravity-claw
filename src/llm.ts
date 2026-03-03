import OpenAI from "openai";
import Groq from "groq-sdk";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";
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
    modal: "zai-org/GLM-5-FP8",
    openRouter: "deepseek/deepseek-chat", // DeepSeek V3 (Economic & Powerful)
    groq: "llama-3.3-70b-versatile",
    light: "liquid/lfm-40b" // For RAG/Memory tasks
};

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Lightweight chat for background tasks (Summarization, RAG).
 * Uses LFM or Groq as backup.
 */
export async function chatLight(
    messages: Message[],
    maxTokens: number = 1024
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    try {
        console.log(`🤖 [Light] Requesting OpenRouter [${MODELS.light}]...`);
        return await openRouterClient.chat.completions.create({
            model: MODELS.light,
            max_tokens: maxTokens,
            messages: messages as any,
        });
    } catch (error) {
        console.warn(`⚠️ [Light] Fallback to Groq...`);
        return await groqClient.chat.completions.create({
            model: MODELS.groq,
            max_tokens: maxTokens,
            messages: messages.slice(-5) as any,
        });
    }
}

/**
 * Main chat for the Agent.
 * Priority: Modal -> OpenRouter -> Groq
 */
export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const tools = getOpenAITools();
    const callArgs = {
        max_tokens: 4096,
        messages,
        tools: tools.length > 0 ? tools : undefined,
    };

    // 1. PRIMARY: MODAL (GLM-5)
    if (config.modalApiKey) {
        try {
            console.log(`🤖 Requesting LLM (Primary: Modal [${MODELS.modal}])...`);
            return await modalClient.chat.completions.create({
                model: MODELS.modal,
                ...callArgs
            });
        } catch (error) {
            console.warn(`⚠️ Modal failed. Falling back...`);
        }
    }

    // 2. SECONDARY: OPENROUTER (DeepSeek V3)
    try {
        console.log(`🤖 Requesting LLM (Secondary: OpenRouter [${MODELS.openRouter}])...`);
        return await openRouterClient.chat.completions.create({
            model: MODELS.openRouter,
            ...callArgs
        });
    } catch (error) {
        console.warn(`⚠️ OpenRouter failed. Falling back to Groq...`);
    }

    // 3. FALLBACK: GROQ
    try {
        console.log(`🤖 Requesting LLM (Fallback: Groq)...`);
        return await groqClient.chat.completions.create({
            model: MODELS.groq,
            ...callArgs,
            messages: messages.slice(-10) as any // Very limited context
        });
    } catch (error) {
        throw new Error("❌ All LLM providers failed.");
    }
}
