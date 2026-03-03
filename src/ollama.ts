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
    const isOpenAICompatible = normalizedBase.endsWith('/v1');

    return withRetry(async () => {
        const url = isOpenAICompatible ? `${normalizedBase}/chat/completions` : `${normalizedBase}/api/chat`;
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
            throw new Error(`Ollama API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        return isOpenAICompatible ? data.choices[0].message : data.message;
    }, { maxRetries: 1 });
}

/**
 * Generate embeddings using Ollama.
 */
export async function ollamaEmbeddings(
    input: string,
    model: string = "nomic-embed-text"
): Promise<number[]> {
    const rawBase = config.ollamaBaseUrl || "http://localhost:11434";
    const normalizedBase = rawBase.replace(/\/+$/, "");
    const isOpenAICompatible = normalizedBase.endsWith('/v1');

    return withRetry(async () => {
        // Native Ollama uses /api/embed, OpenAI-compatible uses /embeddings (or /v1/embeddings)
        const url = isOpenAICompatible ? `${normalizedBase}/embeddings` : `${normalizedBase}/api/embed`;
        const body = isOpenAICompatible ? { model, input } : { model, input }; // Native also uses 'input' now in newer versions or 'prompt' in older

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
            // Handle specific error for older Ollama versions that might still expect 'prompt'
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
                    return data.embedding || data.embeddings[0]; // Handle array vs single
                }
            }
            throw new Error(`Ollama Embeddings error (${response.status}): ${errorText || response.statusText}`);
        }

        const data = await response.json() as any;
        // Native /api/embed returns { embedding: [...] }
        // OpenAI /v1/embeddings returns { data: [{ embedding: [...] }] }
        if (isOpenAICompatible) return data.data[0].embedding;
        return data.embedding || (data.embeddings && data.embeddings[0]);
    }, { maxRetries: 1 });
}

