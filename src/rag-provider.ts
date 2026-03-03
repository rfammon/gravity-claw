import { lanceProvider } from "./lance-provider.js";
import { ollamaEmbeddings } from "./ollama.js";

/**
 * RAG Provider for semantic factual memory.
 * - LRU in-memory cache for embeddings (100 entries, 10-min TTL)
 * - Local storage via LanceDB
 */

// ── Embedding cache ──────────────────────────────────────────────────
const CACHE_MAX = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const embeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();

function getCachedEmbedding(text: string): number[] | null {
    const key = text.substring(0, 200);
    const entry = embeddingCache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
        embeddingCache.delete(key);
        return null;
    }
    return entry.embedding;
}

function setCachedEmbedding(text: string, embedding: number[]): void {
    if (embeddingCache.size >= CACHE_MAX) {
        const [firstKey] = embeddingCache.keys();
        embeddingCache.delete(firstKey);
    }
    embeddingCache.set(text.substring(0, 200), { embedding, expiresAt: Date.now() + CACHE_TTL_MS });
}

export class RAGProvider {
    /**
     * Generate embeddings — checks cache first, then calls Ollama.
     */
    async generateEmbedding(text: string): Promise<number[]> {
        const cached = getCachedEmbedding(text);
        if (cached) return cached;

        try {
            const embedding = await ollamaEmbeddings(text);
            setCachedEmbedding(text, embedding);
            return embedding;
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
            console.warn("⚠️ RAG AddFact aborted: Embedding generation failed.", error);
            throw new Error(`Failed to generate embeddings: ${error}`);
        }

        try {
            await lanceProvider.addData("factual_memories", [{
                chat_id: String(chatId),
                content: content,
                vector: embedding,
                metadata: JSON.stringify(metadata),
                created_at: new Date().toISOString()
            }]);
        } catch (error) {
            console.error("❌ RAG AddFact failed to store in LanceDB:", error);
        }
    }

    /**
     * Search for relevant facts using cosine similarity.
     * Filters out system noise and technical logs.
     */
    async searchFacts(chatId: string, query: string, limit: number = 3): Promise<string[]> {
        try {
            const embedding = await this.generateEmbedding(query);

            // Build filter to exclude system contamination
            // We only want real facts or important user/assistant interactions
            const results = await lanceProvider.search("factual_memories", {
                vector: embedding,
                filter: `chat_id = '${chatId}' AND content NOT LIKE '%LLM Tracker%' AND content NOT LIKE '%system:%'`,
                limit: limit
            });

            if (results && results.length > 0) {
                return results.map((row: any) => row.content);
            }
        } catch (error) {
            console.warn("⚠️ RAG: Vector search failed:", error);
        }

        return [];
    }

}

export const rag = new RAGProvider();

