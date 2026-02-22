import OpenAI from "openai";
import { config } from "./config.js";
import { registerTool, getOpenAITools, getTool } from "./tools/registry.js";

// ── Code Agent Configuration ──────────────────────────────────────
const CODE_MODEL_MODAL = "zai-org/GLM-5-FP8";
const CODE_MODEL_OPENROUTER = "qwen/qwen-2.5-72b-instruct";

// Cache Puter module to avoid repeated imports
let puterModule: any = null;

// ── Modal Client (Fallback 1) ──────────────────────────────────────
function getModalClient(): OpenAI | null {
    if (!config.modalBaseUrl || !config.modalApiKey) {
        return null;
    }
    return new OpenAI({
        baseURL: config.modalBaseUrl,
        apiKey: config.modalApiKey,
    });
}

// ── OpenRouter Client (Fallback 2) ────────────────────────────────
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

// ── Puter Client (Primary) ─────────────────────────────────────────
async function getPuterClient(authToken?: string): Promise<any> {
    if (!puterModule) {
        puterModule = await import("@heyputer/puter.js/src/init.cjs");
    }

    const { init } = puterModule;

    // Try to get token from:
    // 1. Parameter
    // 2. Environment variable
    // 3. Saved token file
    let token = authToken || process.env.PUTER_TOKEN;

    if (!token) {
        try {
            const fs = await import("fs");
            const tokenPath = "./.puter-token";
            if (fs.existsSync(tokenPath)) {
                token = fs.readFileSync(tokenPath, "utf-8").trim();
                console.log("📂 Loaded Puter token from .puter-token file");
            }
        } catch {
            // Ignore - token file doesn't exist
        }
    }

    return init(token || undefined);
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
7. If the task involves database queries, provide working SQL or code examples.
8. [CRITICAL] You HAVE ACCESS to the Supabase database via the 'supabase_query' tool. The previous 'disconnection' reports were due to execution environment limitations. Use 'supabase_query' to fetch memories, facts, or judgments instead of writing JS/Python code that connects to Supabase directly.`;

// ── Run Code Agent with Fallback Chain ────────────────────────────
// Order: Puter (Primary) → Modal → OpenRouter
export async function runCodeAgent(task: string): Promise<string> {
    const startTime = Date.now();

    // PRIMARY: Try Puter first (free, reliable)
    try {
        console.log(`⚡ Code Agent: Trying Puter (${config.puterDefaultModel})...`);
        const puter = await getPuterClient();

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
        } else if (response?.message && typeof response.message === "string") {
            // Handle error messages like "Missing authentication token"
            if (response.message.includes("token") || response.message.includes("auth")) {
                console.log(`⚠️ Puter auth issue: ${response.message}. Trying fallback...`);
                throw new Error(response.message);
            }
            result = response.message;
        } else {
            result = JSON.stringify(response);
        }

        // Check for auth errors in string response
        if (result.includes("token_missing") || result.includes("authentication")) {
            console.log("⚠️ Puter requires authentication. Trying fallback...");
            throw new Error("Puter authentication required");
        }

        if (result && result.length > 10 && !result.includes("undefined")) {
            const elapsed = Date.now() - startTime;
            console.log(`✅ Code Agent (Puter) responded in ${elapsed}ms`);
            return result;
        }

        console.log("⚠️ Puter returned empty/short response, trying fallback...");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`⚠️ Puter failed: ${msg}. Trying fallback...`);
    }

    // FALLBACK 1: Modal (GLM-5-FP8 Code Specialist)
    const modalClient = getModalClient();
    if (modalClient) {
        try {
            console.log(`⚡ Code Agent: Trying Modal (${CODE_MODEL_MODAL})...`);
            const tools = getOpenAITools();
            let messages: any[] = [
                { role: "system", content: CODE_SYSTEM_PROMPT },
                { role: "user", content: task }
            ];

            let iterations = 0;
            while (iterations < 5) {
                iterations++;
                const response = await modalClient.chat.completions.create({
                    model: CODE_MODEL_MODAL,
                    max_tokens: 8192,
                    messages,
                    tools: tools.length > 0 ? tools : undefined,
                });

                const choice = response.choices[0];
                if (!choice) break;

                const assistantMessage = choice.message;
                messages.push(assistantMessage);

                if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                    const result = assistantMessage.content ?? "";
                    if (result && !result.includes("502") && !result.includes("upstream")) {
                        const elapsed = Date.now() - startTime;
                        console.log(`✅ Code Agent (Modal) responded in ${elapsed}ms`);
                        return result;
                    }
                    break;
                }

                // Handle tool calls
                for (const toolCall of assistantMessage.tool_calls) {
                    if (toolCall.type !== "function") continue;

                    const fnName = toolCall.function.name;
                    const fnArgs = JSON.parse(toolCall.function.arguments || "{}");
                    const tool = getTool(fnName);

                    console.log(`🛠️ Code Agent (Modal) calling tool: ${fnName}`);
                    let resultText: string;
                    if (!tool) {
                        resultText = JSON.stringify({ error: "Unknown tool: " + fnName });
                    } else {
                        try {
                            const rawResult = await tool.execute(fnArgs);
                            resultText = typeof rawResult === 'string' ? rawResult : rawResult.text;
                        } catch (err) {
                            resultText = JSON.stringify({
                                error: "Tool threw: " + (err instanceof Error ? err.message : String(err)),
                            });
                        }
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: resultText,
                    });
                }
            }
            console.log("⚠️ Modal returned error or reached iteration limit, trying next fallback...");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`⚠️ Modal failed: ${msg}. Trying next fallback...`);
        }
    } else {
        console.log("ℹ️ Modal not configured, skipping...");
    }

    // FALLBACK 2: OpenRouter (Qwen)
    try {
        console.log(`⚡ Code Agent: Trying OpenRouter (${CODE_MODEL_OPENROUTER})...`);
        const openRouterClient = getOpenRouterClient();
        const tools = getOpenAITools();

        let messages: any[] = [
            { role: "system", content: CODE_SYSTEM_PROMPT },
            { role: "user", content: task }
        ];

        let iterations = 0;
        while (iterations < 5) {
            iterations++;
            const response = await openRouterClient.chat.completions.create({
                model: CODE_MODEL_OPENROUTER,
                max_tokens: 8192,
                messages,
                tools: tools.length > 0 ? tools : undefined,
            });

            const choice = response.choices[0];
            if (!choice) break;

            const assistantMessage = choice.message;
            messages.push(assistantMessage);

            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                const result = assistantMessage.content ?? "";
                if (result) {
                    const elapsed = Date.now() - startTime;
                    console.log(`✅ Code Agent (OpenRouter) responded in ${elapsed}ms`);
                    return result;
                }
                break;
            }

            // Handle tool calls
            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.type !== "function") continue;

                const fnName = toolCall.function.name;
                const fnArgs = JSON.parse(toolCall.function.arguments || "{}");
                const tool = getTool(fnName);

                console.log(`🛠️ Code Agent calling tool: ${fnName}`);
                let resultText: string;
                if (!tool) {
                    resultText = JSON.stringify({ error: "Unknown tool: " + fnName });
                } else {
                    try {
                        const rawResult = await tool.execute(fnArgs);
                        resultText = typeof rawResult === 'string' ? rawResult : rawResult.text;
                    } catch (err) {
                        resultText = JSON.stringify({
                            error: "Tool threw: " + (err instanceof Error ? err.message : String(err)),
                        });
                    }
                }

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: resultText,
                });
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ OpenRouter also failed: ${msg}`);
    }

    // All fallbacks failed
    return JSON.stringify({
        error: "All code agent backends failed",
        details: "Puter, Modal, and OpenRouter all returned errors.",
        suggestion: "Check if Puter is authenticated or verify API keys in .env"
    });
}

// ── Register as a Tool ────────────────────────────────────────────
registerTool({
    name: "delegate_to_code_agent",
    description: "Delegate a coding task or complex technical problem to the code specialist. Use this when the user asks you to write code, build scripts, debug programs, explain complex algorithms, or handle any programming-related task. Fallback chain: Puter (Kimi) → Modal (GLM-5) → OpenRouter (Qwen).",
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

console.log("🔧 Code Agent registered: Puter → Modal → OpenRouter");
