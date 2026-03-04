import OpenAI from "openai";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";
import { routeChat, type Message as RouterMessage } from "./llm-router.js";

// Re-export Message type from the router
export type Message = RouterMessage;

/**
 * Legacy stub for `/think` command from previous behavior.
 */
export function setThinkingLevel(level: "off" | "low" | "medium" | "high") {
    console.log(`🧠 [LLM] Thinking level set to ${level} (Stubbed)`);
}

/**
 * Lightweight chat for background tasks (Summarization, RAG).
 * Uses light providers: Groq 8B → Cerebras 8B → Gemini Flash Lite
 */
export async function chatLight(
    messages: Message[],
    maxTokens: number = 1024
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    return routeChat(messages, {
        maxTokens,
        light: true,
    });
}

/**
 * Main chat for the Agent.
 * Routes through: Google AI Studio → Groq → Cerebras → OpenRouter → Mistral
 * Automatic fallback on 429/5xx, with response caching.
 */
export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const tools = getOpenAITools();
    return routeChat(messages, {
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
        skipCache: true, // Agent calls involve tools, don't cache
    });
}
