import { chatLight, type Message } from "./llm.js";
import { getDb } from "./db-provider.js";

/**
 * Context Optimizer
 * Handles token reduction, summarization, and semantic compression.
 */

export class ContextOptimizer {
    /**
     * Summarizes old messages to reduce token count while preserving context.
     * Keeps the last N messages intact and compresses the rest.
     */
    async compressHistory(chatId: string, history: Message[], keepLast: number = 8): Promise<Message[]> {
        if (history.length <= keepLast + 2) return history;

        const toCompress = history.slice(0, -keepLast);
        const toKeep = history.slice(-keepLast);

        console.log(`✂️ Optimizing context: Compressing ${toCompress.length} messages...`);

        try {
            const prompt = `Summarize the following conversation history concisely, preserving all key facts, user preferences, and ongoing tasks. 
            Format it as a "Mnemonic State" for an AI. 
            History:
            ${toCompress.map(m => `${m.role}: ${m.content}`).join("\n")}`;

            const response = await chatLight([
                { role: "system", content: "You are a professional context summarizer. Be concise and factual." },
                { role: "user", content: prompt }
            ]);

            const summary = response?.choices?.[0]?.message?.content || "Previous context summarized.";

            return [
                { 
                    role: "system", 
                    content: `[CONTEXT SUMMARY OF OLDER MESSAGES]: ${summary}` 
                },
                ...toKeep
            ];
        } catch (error) {
            console.warn("⚠️ Context compression failed, using raw history:", error);
            return history;
        }
    }

    /**
     * Extracts structured facts from a message to avoid saving raw redundant text.
     */
    async extractFacts(text: string): Promise<{ key: string, value: string }[]> {
        // This could use an LLM call to find "I like X" or "My birthday is Y"
        // For now, it returns empty but the hook is ready.
        return [];
    }

    /**
     * Dynamically adjusts RAG search limits based on query complexity.
     */
    calculateSearchLimit(query: string): number {
        const length = query.length;
        if (length < 10) return 0; // Don't search for tiny greetings
        if (length < 30) return 2;
        return 5;
    }
}

export const contextOptimizer = new ContextOptimizer();
