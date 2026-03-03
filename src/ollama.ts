import fetch from "node-fetch";
import { config } from "./config.js";
import { withRetry } from "./utils/network.js";

/**
 * Very thin client for Ollama running locally.
 */
export async function ollamaChat(
    messages: { role: string; content: string }[],
    model: string = "qwen2.5:0.5b",
    tools?: any[]
): Promise<any> {
    const rawBase = config.ollamaBaseUrl || "http://localhost:11434";
    const normalizedBase = rawBase.replace(/\/+$/, "");

    // Check if we are using the remote Cloud API directly
    const isCloudDirect = normalizedBase.includes("ollama.com/api");
    const isOpenAICompatible = normalizedBase.endsWith('/v1');

    return withRetry(async () => {
        let url: string;
        if (isOpenAICompatible) {
            url = `${normalizedBase}/chat/completions`;
        } else if (isCloudDirect) {
            // If it already ends in /api, don't append /api/chat, just /chat? 
            // Actually ollama.com/api is the base, so /generate or /chat are appended.
            url = `${normalizedBase}/chat`;
        } else {
            url = `${normalizedBase}/api/chat`;
        }

        const body = isOpenAICompatible ? {
            model,
            messages,
            stream: false,
            tools: tools && tools.length > 0 ? tools : undefined,
            temperature: 0.3,
        } : {
            model,
            messages,
            stream: false,
            tools: tools && tools.length > 0 ? tools : undefined,
            options: {
                temperature: 0.3,
                num_ctx: 16384,
                num_predict: 4096,
            }
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(config.ollamaApiKey && { "Authorization": `Bearer ${config.ollamaApiKey}` })
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Ollama API error details:", {
                status: response.status,
                url,
                body: JSON.stringify(body).substring(0, 500),
                errorText
            });
            throw new Error(`Ollama API error (${response.status} at ${url}): ${errorText}`);
        }

        const data = await response.json() as any;
        console.log("📦 Ollama response:", JSON.stringify(data).substring(0, 500));
        const message = isOpenAICompatible ? data.choices[0].message : data.message;
        
        // Log message content for debugging
        console.log("📝 Ollama message content:", message?.content?.substring(0, 200));
        console.log("🔧 Ollama message tool_calls:", message?.tool_calls ? "YES" : "NO");
        
        return message;
    }, { maxRetries: 1 });
}

/**
 * Generate embeddings using Ollama.
 * Always uses local Ollama for embeddings (unless OLLAMA_EMBED_URL is set)
 */
export async function ollamaEmbeddings(
    input: string,
    model: string = "nomic-embed-text"
): Promise<number[]> {
    const rawBase = config.ollamaEmbedUrl || "http://localhost:11434";
    const normalizedBase = rawBase.replace(/\/+$/, "");

    const isCloudDirect = normalizedBase.includes("ollama.com/api");
    const isOpenAICompatible = normalizedBase.endsWith('/v1');

    console.log("📡 Ollama Embed URL:", normalizedBase);

    return withRetry(async () => {
        let url: string;
        if (isOpenAICompatible) {
            url = `${normalizedBase}/embeddings`;
        } else if (isCloudDirect) {
            url = `${normalizedBase}/embed`;
        } else {
            url = `${normalizedBase}/api/embed`;
        }

        const body = { model, input };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(config.ollamaApiKey && { "Authorization": `Bearer ${config.ollamaApiKey}` })
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            // Fallback for older models/versions that want 'prompt' instead of 'input'
            if (response.status === 400 && !isOpenAICompatible) {
                const retryBody = { model, prompt: input };
                const retryResponse = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(config.ollamaApiKey && { "Authorization": `Bearer ${config.ollamaApiKey}` })
                    },
                    body: JSON.stringify(retryBody)
                });
                if (retryResponse.ok) {
                    const data = await retryResponse.json() as any;
                    return data.embedding || (data.embeddings && data.embeddings[0]);
                }
            }
            throw new Error(`Ollama Embeddings error (${response.status} at ${url}): ${errorText || response.statusText}`);
        }

        const data = await response.json() as any;
        if (isOpenAICompatible) return data.data[0].embedding;
        return data.embedding || (data.embeddings && data.embeddings[0]);
    }, { maxRetries: 1 });
}

