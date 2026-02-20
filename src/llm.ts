import OpenAI from "openai";
import { config } from "./config.js";
import { getOpenAITools } from "./tools/registry.js";

// ── client (OpenRouter via OpenAI SDK) ───────────────────
const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.openRouterKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/gravity-claw",
        "X-Title": "Gravity Claw",
    },
});

// ── Models ────────────────────────────────────────────────
const MODELS = {
    standard: "google/gemini-2.0-flash-001",
    thinking: "qwen/qwen3-235b-a22b-thinking-2507",
    fast: "google/gemini-2.0-flash-001",
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

    // Determine model based on thinking level
    let model = MODELS.standard;
    if (globalThinkingLevel === 'high') model = MODELS.thinking;
    if (globalThinkingLevel === 'off') model = MODELS.fast;

    console.log(`🤖 Requesting LLM (${model})...`);
    const startTime = Date.now();
    const response = await client.chat.completions.create({
        model: model,
        max_tokens: 4096,
        messages: messages, // Agent now handles system prompt injection
        tools: tools.length > 0 ? tools : undefined,
    });
    console.log(`✅ LLM Response received in ${Date.now() - startTime}ms`);
    return response;
}
