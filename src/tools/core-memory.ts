import { registerTool } from "./registry.js";
import { rag } from "../rag-provider.js";

/**
 * Registers Core Memory tools in the tool registry.
 * This provides the AI with structured "Obsidian-like" memory Vault access.
 */
export function registerCoreMemoryTools(): void {
    registerTool({
        name: "save_core_memory",
        description: "Save a new factual memory or preference into the core memory vault. ALWAYS use this instead of supabase_insert for long-term facts. You must provide a specific category like 'Trabalho', 'Pessoal', 'Projetos', 'Familia', etc.",
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "The memory or fact to save."
                },
                category: {
                    type: "string",
                    description: "The folder/category name for this memory. Example: 'Personal', 'Work', 'Projects'."
                }
            },
            required: ["content", "category"]
        },
        execute: async ({ content, category }, ctx) => {
            const userId = ctx?.userId || ctx?.chatId;
            if (!userId) {
                return JSON.stringify({ success: false, error: "Missing user authentication." });
            }
            try {
                await rag.addFact(userId, String(content), { category: String(category) });
                return JSON.stringify({
                    success: true,
                    message: `✅ Memory saved successfully to category [${category}].`
                });
            } catch (err) {
                console.error("❌ save_core_memory tool error:", err);
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    });

    registerTool({
        name: "search_core_memory",
        description: "Search the core memory vault for facts, preferences, or previous thoughts using semantic search.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The semantic search query."
                }
            },
            required: ["query"]
        },
        execute: async ({ query }, ctx) => {
            const userId = ctx?.userId || ctx?.chatId;
            if (!userId) {
                return JSON.stringify({ success: false, error: "Missing user authentication." });
            }
            try {
                const results = await rag.searchFacts(userId, String(query), 5);
                if (results.length === 0) {
                    return JSON.stringify({ success: true, results: [], message: "No memories found." });
                }
                return JSON.stringify({ success: true, results });
            } catch (err) {
                console.error("❌ search_core_memory tool error:", err);
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    });

    console.log("🔧 Registered Core Memory tools: save_core_memory, search_core_memory");
}
