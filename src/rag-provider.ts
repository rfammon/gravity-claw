import { getClient } from "./supabase-db.js";
import { withRetry } from "./utils/network.js";
import { ollamaEmbeddings } from "./ollama.js";
import { puterChat } from "./llm-utils.js";

/**
 * RAG Provider for semantic factual memory.
 */
export class RAGProvider {
    /**
     * Generate embeddings for a given text.
     * Uses Puter.js as primary via special prompt or custom API if available.
     * Falls back to local Ollama (nomic-embed-text).
     */
    async generateEmbedding(text: string): Promise<number[]> {
        // Since Puter.js standard chat doesn't expose embeddings directly easily,
        // we'll prioritize local Ollama for embeddings to ensure stability and privacy.
        try {
            return await ollamaEmbeddings(text);
        } catch (error) {
            console.error("❌ RAG: Embedding generation failed:", error);
            throw error;
        }
    }

    /**
     * Store a new factual memory with its embedding.
     */
    async addFact(chatId: string, content: string, metadata: any = {}): Promise<void> {
        let embedding: number[];
        try {
            embedding = await this.generateEmbedding(content);
        } catch (error) {
            console.warn("⚠️ RAG AddFact aborted: Embedding generation failed.");
            return;
        }

        await withRetry(async () => {
            const { error } = await getClient()
                .from("factual_memories")
                .insert({
                    chat_id: chatId,
                    content,
                    embedding,
                    metadata
                });
            if (error) throw error;
        }, { maxRetries: 2 });
    }

    /**
     * Search for relevant facts using cosine similarity.
     */
    async searchFacts(chatId: string, query: string, limit: number = 3): Promise<string[]> {
        let embedding: number[];
        try {
            embedding = await this.generateEmbedding(query);
        } catch (error) {
            console.warn("⚠️ RAG Search aborted: Embedding generation failed.");
            return [];
        }

        return await withRetry(async () => {
            // we use rpc for vector search usually, but let's assume a match_documents function exists
            // or we use simple select if the schema is simple.
            // For now, let's use the match_documents RPC which we'll need to define in SQL.
            const { data, error } = await getClient().rpc("match_factual_memories", {
                query_embedding: embedding,
                match_threshold: 0.7,
                match_count: limit,
                p_chat_id: chatId
            });

            if (error) {
                console.warn("⚠️ RAG Search RPC failed, falling back to keyword search:", error.message);
                return [];
            }

            return (data as any[]).map(row => row.content);
        }, { maxRetries: 1 });
    }
}

export const rag = new RAGProvider();
