import OpenAI from "openai";
import { config } from "./config.js";
import { registerTool } from "./tools/registry.js";

// ── Code Agent Configuration ──────────────────────────────────────
const CODE_MODEL_MODAL = "zai-org/GLM-5-FP8";
const CODE_MODEL_OPENROUTER = "qwen/qwen-2.5-72b-instruct";

// Cache Puter module to avoid repeated imports
let puterModule: any = null;

// ── Modal Client (Primary) ────────────────────────────────────────
function getModalClient(): OpenAI | null {
    if (!config.modalBaseUrl || !config.modalApiKey) {
        return null;
    }
    return new OpenAI({
        baseURL: config.modalBaseUrl,
        apiKey: config.modalApiKey,
    });
}

// ── OpenRouter Client (Fallback 1) ────────────────────────────────
function getOpenRouterClient(): OpenAI {
    return new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: config.openRouterKey,
        defaultHeaders: {
            "HTTP-Referer": "https://github.com/gravity-claw",
            "X-Title": "Gravity Claw Code Agent",
        },
    });
}

// ── Puter Client (Fallback 2) ─────────────────────────────────────
async function getPuterClient(): Promise<any> {
    if (!puterModule) {
        puterModule = await import("@heyputer/puter.js");
    }
    return puterModule.default;
}

// ─── System Prompt for Code Agent ─────────────────────────────────
const CODE_SYSTEM_PROMPT = `You are a senior software engineer and code specialist. You write clean, production-ready code.

RULES:
1. Write complete, working code — no placeholders, no "TODO" comments.
2. Include brief inline comments only where logic is non-obvious.
3. Use modern best practices for the language requested.
4. If the task is ambiguous, make reasonable assumptions and state them.
5. Always respond in Brazilian Portuguese (pt-BR) for explanations, but keep code in English.
6. Keep explanations short and practical — focus on the code.
7. If the task involves database queries, provide working SQL or code examples.`;

// ── Run Code Agent with Fallback Chain ────────────────────────────
export async function runCodeAgent(task: string): Promise<string> {
    const startTime = Date.now();
    
    // Try Modal first (GLM-5-FP8 Code Specialist)
    const modalClient = getModalClient();
    if (modalClient) {
        try {
            console.log(`⚡ Code Agent: Trying Modal (${CODE_MODEL_MODAL})...`);
            const response = await modalClient.chat.completions.create({
                model: CODE_MODEL_MODAL,
                max_tokens: 8192,
                messages: [
                    { role: "system", content: CODE_SYSTEM_PROMPT },
                    { role: "user", content: task }
                ],
            });
            
            const result = response.choices[0]?.message?.content ?? "";
            if (result && !result.includes("502") && !result.includes("upstream")) {
                const elapsed = Date.now() - startTime;
                console.log(`✅ Code Agent (Modal) responded in ${elapsed}ms`);
                return result;
            }
            console.log("⚠️ Modal returned error response, trying fallback...");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`⚠️ Modal failed: ${msg}. Trying fallback...`);
        }
    } else {
        console.log("ℹ️ Modal not configured, using fallback...");
    }

    // Fallback 1: OpenRouter (Qwen)
    try {
        console.log(`⚡ Code Agent: Trying OpenRouter (${CODE_MODEL_OPENROUTER})...`);
        const openRouterClient = getOpenRouterClient();
        const response = await openRouterClient.chat.completions.create({
            model: CODE_MODEL_OPENROUTER,
            max_tokens: 8192,
            messages: [
                { role: "system", content: CODE_SYSTEM_PROMPT },
                { role: "user", content: task }
            ],
        });
        
        const result = response.choices[0]?.message?.content ?? "";
        if (result) {
            const elapsed = Date.now() - startTime;
            console.log(`✅ Code Agent (OpenRouter) responded in ${elapsed}ms`);
            return result;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`⚠️ OpenRouter failed: ${msg}. Trying Puter...`);
    }

    // Fallback 2: Puter (Kimi or other model)
    try {
        console.log(`⚡ Code Agent: Trying Puter...`);
        const puter = await getPuterClient();
        
        // Puter AI chat
        const response = await puter.ai.chat(
            [
                { role: "system", content: CODE_SYSTEM_PROMPT },
                { role: "user", content: task }
            ],
            { model: config.puterDefaultModel || "moonshotai/kimi-k2.5" }
        );
        
        // Extract text from Puter response
        let result = "";
        if (typeof response === "string") {
            result = response;
        } else if (response?.message?.content) {
            result = response.message.content;
        } else if (response?.content) {
            result = response.content;
        } else if (response?.text) {
            result = response.text;
        } else {
            result = JSON.stringify(response);
        }
        
        if (result) {
            const elapsed = Date.now() - startTime;
            console.log(`✅ Code Agent (Puter) responded in ${elapsed}ms`);
            return result;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Puter also failed: ${msg}`);
    }

    // All fallbacks failed
    return JSON.stringify({ 
        error: "All code agent backends failed",
        details: "Modal, OpenRouter, and Puter all returned errors. Please check API keys.",
        suggestion: "Verify MODAL_API_KEY, OPENROUTER_API_KEY in .env"
    });
}

// ── Register as a Tool ────────────────────────────────────────────
registerTool({
    name: "delegate_to_code_agent",
    description: "Delegate a coding task or complex technical problem to the code specialist. Use this when the user asks you to write code, build scripts, debug programs, explain complex algorithms, or handle any programming-related task. Has automatic fallback: Modal (GLM-5) → OpenRouter (Qwen) → Puter (Kimi).",
    parameters: {
        type: "object",
        properties: {
            task: {
                type: "string",
                description: "The full task description to send to the code specialist. Be detailed — include language, requirements, and any context."
            }
        },
        required: ["task"]
    },
    execute: async ({ task }) => {
        try {
            return await runCodeAgent(task as string);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Code Agent error: ${msg}`);
            return JSON.stringify({ error: `Code Agent failed: ${msg}` });
        }
    }
});

console.log("🔧 Code Agent registered with fallback chain: Modal → OpenRouter → Puter");
