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
    const baseUrl = config.ollamaBaseUrl || "http://localhost:11434";

    return withRetry(async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                tools: tools && tools.length > 0 ? tools : undefined,
                options: {
                    temperature: 0.3,
                    num_ctx: 16384,
                    num_predict: 4096,
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        return data.message;
    }, { maxRetries: 1 });
}

/**
 * Generate embeddings using Ollama locally.
 */
export async function ollamaEmbeddings(
    input: string,
    model: string = "nomic-embed-text"
): Promise<number[]> {
    const baseUrl = config.ollamaBaseUrl || "http://localhost:11434";

    return withRetry(async () => {
        const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: input })
        });

        if (!response.ok) {
            throw new Error(`Ollama Embeddings error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.embedding;
    }, { maxRetries: 1 });
}
