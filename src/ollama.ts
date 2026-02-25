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
    const normalizedBase = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
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
 * Generate embeddings using Ollama locally.
 */
export async function ollamaEmbeddings(
    input: string,
    model: string = "nomic-embed-text"
): Promise<number[]> {
    const normalizedBase = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
    const isOpenAICompatible = normalizedBase.endsWith('/v1');

    return withRetry(async () => {
        const url = isOpenAICompatible ? `${normalizedBase}/embeddings` : `${normalizedBase}/api/embeddings`;
        const body = isOpenAICompatible ? { model, input } : { model, prompt: input };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(config.ollamaApiKey && { "Authorization": `Bearer ${config.ollamaApiKey}` })
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Ollama Embeddings error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return isOpenAICompatible ? data.data[0].embedding : data.embedding;
    }, { maxRetries: 1 });
}
