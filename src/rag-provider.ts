import { getClient } from "./supabase-db.js";
import { withRetry } from "./utils/network.js";
import { ollamaEmbeddings } from "./ollama.js";

/**
 * RAG Provider for semantic factual memory.
 * - LRU in-memory cache for embeddings (100 entries, 10-min TTL)
 * - Text-based ILIKE fallback when Ollama is offline or RPC fails
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

        await withRetry(async () => {
            const { error } = await getClient()
                .from("factual_memories")
                .insert({ chat_id: chatId, content, embedding, metadata });
            if (error) throw error;
        }, { maxRetries: 2 });
    }

    /**
     * Search for relevant facts using cosine similarity.
     * Falls back to ILIKE keyword search when vector search is unavailable.
     */
    async searchFacts(chatId: string, query: string, limit: number = 3): Promise<string[]> {
        // Primary: Vector search
        try {
            const embedding = await this.generateEmbedding(query);
            const { data, error } = await getClient().rpc("match_factual_memories", {
                query_embedding: embedding,
                match_threshold: 0.7,
                match_count: limit,
                p_chat_id: chatId
            });
            if (!error && data) {
                return (data as any[]).map(row => row.content);
            }
            console.warn("⚠️ RAG: Vector RPC failed:", error?.message);
        } catch {
            console.warn("⚠️ RAG: Ollama offline — falling back to keyword search.");
        }

        // Fallback: Keyword search via ILIKE
        try {
            const keywords = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            if (keywords.length === 0) return [];
            const ilike = keywords.map(k => `content.ilike.%${k}%`).join(",");
            const { data: keyData } = await getClient()
                .from("factual_memories")
                .select("content")
                .eq("chat_id", chatId)
                .or(ilike)
                .limit(limit);
            return keyData ? (keyData as any[]).map(r => r.content) : [];
        } catch {
            return [];
        }
    }
}

export const rag = new RAGProvider();
