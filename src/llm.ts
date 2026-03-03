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

const openCodeClient = new OpenAI({
    baseURL: config.openCodeBaseUrl,
    apiKey: config.openCodeApiKey || "sk-local-stub", // Allow local without key
});

// ── Google Gemini API (AI Studio - FREE) ──────────────────
async function googleChat(messages: Message[], tools?: any[]): Promise<any> {
    const apiKey = config.googleApiKey;
    const modelId = config.googleLlmModel || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    // Convert messages to Gemini format
    const contents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }]
    }));

    const body: any = {
        contents,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
        },
    };

    if (tools && tools.length > 0) {
        body.tools = [{ functionDeclarations: tools.map((t: any) => t.function) }];
    }

    const response = await fetch(`${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google API Error: ${err}`);
    }

    const data = await response.json() as any;
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) throw new Error("No candidates returned from Gemini");

    const part = candidate.content.parts[0];
    const message: any = {
        role: "assistant",
        content: part.text || null,
    };

    if (part.functionCall) {
        message.tool_calls = [{
            id: `call_${Date.now()}`,
            type: "function",
            function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args)
            }
        }];
    }

    return message;
}

// ── Models ────────────────────────────────────────────────
const MODELS = {
    openRouter: {
        standard: "z-ai/glm-4.5-air:free", // Free model with 131K context, supports tools
        light: "liquid/lfm-40b", // Liquid LFM for background summarizations
    },
    groq: {
        standard: "llama-3.3-70b-versatile",
    },
    modal: {
        standard: "zai-org/GLM-5-FP8",
    },
    opencode: {
        standard: config.openCodeDefaultModel || "big-pickle",
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

/**
 * Lightweight chat for simple/robotic autonomous tasks.
 * Uses Groq (fast, reliable, low hallucination) as primary.
 * Use for: daily digest, routine execution, simple notifications.
 * Does NOT support tools — text-only responses.
 */
export async function chatLight(
    messages: Message[],
    maxTokens: number = 1024
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const sanitizedMessages = messages.map(msg => {
        const { timestamp, reasoning_content, ...rest } = msg as any;
        return rest as Message;
    });

    // PRIMARY: Google Gemini (Fast & Free)
    if (config.googleApiKey) {
        try {
            console.log(`🤖 [Light] Requesting Google Gemini [${config.googleLlmModel}]...`);
            const message = await googleChat(sanitizedMessages as any);
            return {
                choices: [{ message, finish_reason: "stop", index: 0 }]
            };
        } catch (error) {
            console.warn(`⚠️ [Light] Google Gemini failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // FALLBACK: OpenRouter (Liquid LFM-40b)
    try {
        console.log(`🤖 [Light] Fallback to OpenRouter [${MODELS.openRouter.light}]...`);
        const response = await withRetry(
            () => openRouterClient.chat.completions.create({
                model: MODELS.openRouter.light,
                max_tokens: maxTokens,
                messages: sanitizedMessages as any,
            }),
            { maxRetries: 1 }
        );
        return response;
    } catch (error) {
        console.warn(`⚠️ [Light] OpenRouter (Liquid) failed.`);
    }

    // FINAL FALLBACK: Groq
    try {
        console.log(`🤖 [Light] Fallback to Groq [${MODELS.groq.standard}]...`);
        const response = await withRetry(
            () => groqClient.chat.completions.create({
                model: MODELS.groq.standard,
                max_tokens: maxTokens,
                messages: sanitizedMessages as any,
            }),
            { maxRetries: 1 }
        );
        return response;
    } catch (error) {
        throw error;
    }
}


export async function chat(
    messages: Message[]
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const tools = getOpenAITools();
    const startTime = Date.now();

    // Sanitize messages
    const sanitizedMessages = messages.map(msg => {
        // Remove 'timestamp' and 'reasoning_content' as Groq/OpenAI reject it
        const { timestamp, reasoning_content, ...msgCleaned } = msg as any;

        if (msgCleaned.role === 'assistant' && msgCleaned.content === null && msgCleaned.tool_calls) {
            const { content, ...rest } = msgCleaned;
            return rest as Message;
        }
        return msgCleaned as Message;
    });

    const callArgs: any = {
        max_tokens: 4096,
        messages: sanitizedMessages,
        tools: tools.length > 0 ? tools : undefined,
    };

    const parseResponse = (res: any) => {
        if (!res?.choices?.[0]?.message?.content) return res;
        const msg = res.choices[0].message;
        const parsed = parseTextToToolCalls(msg.content);
        msg.content = parsed.content;
        if (parsed.tool_calls && parsed.tool_calls.length > 0) {
            msg.tool_calls = [...(msg.tool_calls || []), ...parsed.tool_calls];
        }
        return res;
    };

    // PRIMARY: Google Gemini (Fast & Free)
    if (config.googleApiKey) {
        try {
            console.log(`🤖 Requesting LLM (Primary Override: Google Gemini [${config.googleLlmModel}])...`);
            const message = await googleChat(sanitizedMessages as any, tools);
            const response = {
                choices: [{
                    message,
                    finish_reason: "stop",
                    index: 0
                }]
            };
            return parseResponse(response);
        } catch (error) {
            console.warn(`⚠️ Google Gemini primary failed: ${error instanceof Error ? error.message : String(error)}. Falling back...`);
        }
    }

    // ── OVERRIDE: LOCAL / CUSTOM CLOUD PRIMARY ─────────────────
    if (config.primaryProvider === "ollama") {

        try {
            console.log(`🤖 Requesting LLM (Primary Override: Ollama [${config.ollamaDefaultModel}] @ ${config.ollamaBaseUrl})...`);
            const ollamaStartTime = Date.now();
            const message = await ollamaChat(sanitizedMessages as any, config.ollamaDefaultModel, tools);
            console.log(`✅ LLM Response received from Ollama in ${Date.now() - ollamaStartTime}ms`);

            // Wrap in OpenAI-compatible structure
            const response = {
                choices: [{
                    message,
                    finish_reason: "stop",
                    index: 0
                }]
            };
            return parseResponse(response);
        } catch (error) {
            console.warn(`⚠️ Ollama primary failed: ${error instanceof Error ? error.message : String(error)}. Falling back to Cloud...`);
        }
    } else if (config.primaryProvider === "opencode" && config.openCodeApiKey) {
        try {
            console.log(`🤖 Requesting LLM (Primary Override: OpenCode [${MODELS.opencode.standard}])...`);
            const ocStartTime = Date.now();
            const response = await withRetry(
                () => openCodeClient.chat.completions.create({
                    model: MODELS.opencode.standard,
                    ...callArgs
                }),
                { maxRetries: 2 }
            );
            console.log(`✅ LLM Response received from OpenCode in ${Date.now() - ocStartTime}ms`);
            return parseResponse(response);
        } catch (error) {
            console.warn(`⚠️ OpenCode primary failed: ${error instanceof Error ? error.message : String(error)}. Falling back to Cloud...`);
        }
    } else if (config.primaryProvider === "antigravity" && config.googleRefreshToken) {
        try {
            console.log(`🤖 Requesting LLM (Primary Override: Antigravity [${config.googleLlmModel}])...`);
            const agStartTime = Date.now();
            const message = await antigravityChat(sanitizedMessages as any, tools);
            console.log(`✅ LLM Response received from Antigravity in ${Date.now() - agStartTime}ms`);

            const response = {
                choices: [{
                    message,
                    finish_reason: "stop",
                    index: 0
                }]
            };
            return parseResponse(response);
        } catch (error) {
            console.warn(`⚠️ Antigravity primary failed: ${error instanceof Error ? error.message : String(error)}. Falling back to Cloud...`);
        }
    }

    // ── PRIMARY: OPENROUTER (DeepSeek V3) ─────────────────────────
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
        return parseResponse(response);
    } catch (error) {
        console.warn(`⚠️ OpenRouter failed: ${error instanceof Error ? error.message : String(error)}. Trying Modal (GLM-5)...`);
    }

    // ── FALLBACK 1: MODAL (GLM-5) ──────────────────────────────────────
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
        return parseResponse(response);
    } catch (error) {
        console.warn(`⚠️ Modal failed: ${error instanceof Error ? error.message : String(error)}. Trying Groq...`);
    }

    // ── FALLBACK 2: GROQ ───────────────────────────────────────
    try {
        console.log(`🤖 Requesting LLM (Fallback 2: Groq [${MODELS.groq.standard}])...`);
        const groqStartTime = Date.now();

        // Limit history for Groq to avoid 12k TPM limit (typically 8-12 messages max)
        let groqMessages = sanitizedMessages;
        if (sanitizedMessages.length > 15) {
            groqMessages = [sanitizedMessages[0], ...sanitizedMessages.slice(-10)];
        }

        const groqCallArgs = { ...callArgs, messages: groqMessages };

        const response = await withRetry(
            () => groqClient.chat.completions.create({
                model: MODELS.groq.standard,
                ...groqCallArgs
            }),
            { maxRetries: 2 }
        );
        console.log(`✅ LLM Response received from Groq in ${Date.now() - groqStartTime}ms`);
        return parseResponse(response);
    } catch (error) {
        console.warn(`⚠️ Groq failed: ${error instanceof Error ? error.message : String(error)}. Trying OpenCode...`);
    }

    // ── FALLBACK 3: OPENCODE ZEN ───────────────────────────────
    if (config.openCodeApiKey) {
        try {
            console.log(`🤖 Requesting LLM (Fallback 3: OpenCode [${MODELS.opencode.standard}])...`);
            const openCodeStartTime = Date.now();
            const response = await withRetry(
                () => openCodeClient.chat.completions.create({
                    model: MODELS.opencode.standard,
                    ...callArgs
                }),
                { maxRetries: 2 }
            );
            console.log(`✅ LLM Response received from OpenCode in ${Date.now() - openCodeStartTime}ms`);
            return parseResponse(response);
        } catch (error) {
            console.warn(`⚠️ OpenCode failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    throw new Error("❌ All cloud LLM providers failed and no local fallback available!");
}

