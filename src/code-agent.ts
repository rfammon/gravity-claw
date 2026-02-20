import OpenAI from "openai";
import { config } from "./config.js";
import { registerTool } from "./tools/registry.js";

// ── Modal client (GLM-5-FP8 Code Specialist) ─────────────
const CODE_MODEL = "zai-org/GLM-5-FP8";

function getModalClient(): OpenAI {
    if (!config.modalBaseUrl || !config.modalApiKey) {
        throw new Error("❌ Modal API credentials missing. Set MODAL_BASE_URL and MODAL_API_KEY in .env");
    }
    return new OpenAI({
        baseURL: config.modalBaseUrl,
        apiKey: config.modalApiKey,
    });
}

// ── Code Agent Runner ─────────────────────────────────────
export async function runCodeAgent(task: string): Promise<string> {
    const client = getModalClient();

    console.log(`⚡ Code Agent (${CODE_MODEL}) processing task...`);
    const startTime = Date.now();

    const response = await client.chat.completions.create({
        model: CODE_MODEL,
        max_tokens: 8192,
        messages: [
            {
                role: "system",
                content: `You are a senior software engineer and code specialist. You write clean, production-ready code.

RULES:
1. Write complete, working code — no placeholders, no "TODO" comments.
2. Include brief inline comments only where logic is non-obvious.
3. Use modern best practices for the language requested.
4. If the task is ambiguous, make reasonable assumptions and state them.
5. Always respond in Brazilian Portuguese (pt-BR) for explanations, but keep code in English.
6. Keep explanations short and practical — focus on the code.`
            },
            {
                role: "user",
                content: task
            }
        ],
    });

    const elapsed = Date.now() - startTime;
    const result = response.choices[0]?.message?.content ?? "⚠️ Code agent returned no response.";
    console.log(`✅ Code Agent responded in ${elapsed}ms (${result.length} chars)`);
    return result;
}

// ── Register as a Tool ────────────────────────────────────
registerTool({
    name: "delegate_to_code_agent",
    description: "Delegate a coding task or complex technical problem to the GLM-5 code specialist. Use this when the user asks you to write code, build scripts, debug programs, explain complex algorithms, or handle any programming-related task. Pass the full task description.",
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
