import { registerTool } from "./registry.js";
import { rag } from "../rag-provider.js";
import { storeFact, getFacts, getChatHistory } from "../db-provider.js";

/**
 * Core Memory tools — Two layers:
 * 
 * Layer 1 (Structured): store_fact / get_facts — Key/value pairs in SQLite/Supabase.
 *   → Works WITHOUT Ollama. Always reliable. For persistent preferences, names, etc.
 * 
 * Layer 2 (Semantic RAG): save_core_memory / search_core_memory — Vector search in LanceDB.
 *   → Requires Ollama for embeddings. For rich contextual memories.
 */
export function registerCoreMemoryTools(): void {
    // ── Layer 1: Structured Facts (DB-backed, no Ollama needed) ──────

    registerTool({
        name: "store_fact",
        description: "Store a persistent key-value fact about the user. This is the MOST RELIABLE memory tool — works even when Ollama is offline. Use for: user name, preferences, birthdays, recurring info. Examples: key='nome', value='Rafael'; key='cidade', value='São Paulo'.",
        parameters: {
            type: "object",
            properties: {
                key: {
                    type: "string",
                    description: "The fact key/identifier (e.g. 'nome', 'aniversario', 'cidade', 'profissao')."
                },
                value: {
                    type: "string",
                    description: "The fact value (e.g. 'Rafael', '15 de março', 'São Paulo')."
                }
            },
            required: ["key", "value"]
        },
        execute: async ({ key, value }, ctx) => {
            const chatId = ctx?.chatId;
            if (!chatId) return JSON.stringify({ success: false, error: "Missing chatId." });
            try {
                await storeFact(chatId, String(key), String(value));
                return JSON.stringify({
                    success: true,
                    message: `✅ Fact saved: ${key} = ${value}`
                });
            } catch (err) {
                console.error("❌ store_fact error:", err);
                return JSON.stringify({ success: false, error: String(err) });
            }
        }
    });

    registerTool({
        name: "get_facts",
        description: "Retrieve ALL stored facts about the user (persistent key-value memory). Returns all known facts like name, preferences, etc. Use this to check what you remember about the user.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        },
        execute: async (_args, ctx) => {
            const chatId = ctx?.chatId;
            if (!chatId) return JSON.stringify({ success: false, error: "Missing chatId." });
            try {
                const facts = await getFacts(chatId);
                const entries = Object.entries(facts);
                if (entries.length === 0) {
                    return JSON.stringify({ success: true, facts: {}, message: "No facts stored yet." });
                }
                return JSON.stringify({ success: true, facts, count: entries.length });
            } catch (err) {
                console.error("❌ get_facts error:", err);
                return JSON.stringify({ success: false, error: String(err) });
            }
        }
    });

    registerTool({
        name: "get_chat_history",
        description: "Retrieve recent conversation history from the database. Use this to recall what was discussed in previous sessions.",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Number of recent messages to retrieve (default: 20, max: 50)."
                }
            },
            required: []
        },
        execute: async ({ limit }, ctx) => {
            const chatId = ctx?.chatId;
            if (!chatId) return JSON.stringify({ success: false, error: "Missing chatId." });
            try {
                const lim = Math.min(Number(limit) || 20, 50);
                const history = await getChatHistory(chatId, lim);
                if (!history || history.length === 0) {
                    return JSON.stringify({ success: true, messages: [], message: "No history found." });
                }
                // Return condensed version to save tokens
                const condensed = history.map(m => ({
                    role: m.role,
                    content: m.content.substring(0, 300),
                    timestamp: m.timestamp
                }));
                return JSON.stringify({ success: true, messages: condensed, count: condensed.length });
            } catch (err) {
                console.error("❌ get_chat_history error:", err);
                return JSON.stringify({ success: false, error: String(err) });
            }
        }
    });

    // ── Layer 2: Semantic RAG (LanceDB, requires Ollama embeddings) ──

    registerTool({
        name: "save_core_memory",
        description: "Save a rich contextual memory into the semantic vault (LanceDB). Requires Ollama for embeddings. For complex memories that benefit from semantic search. Use store_fact for simple key-value facts instead.",
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
                    message: `✅ Memory saved to category [${category}].`
                });
            } catch (err) {
                console.error("❌ save_core_memory error:", err);
                // If Ollama is down, suggest using store_fact instead
                const errMsg = err instanceof Error ? err.message : String(err);
                const isOllamaDown = errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed");
                return JSON.stringify({
                    success: false,
                    error: errMsg,
                    hint: isOllamaDown ? "Ollama is offline. Use store_fact tool instead for key-value facts." : undefined
                });
            }
        }
    });

    registerTool({
        name: "search_core_memory",
        description: "Search the semantic memory vault using vector search (requires Ollama). For simple fact lookup, use get_facts instead.",
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
                    return JSON.stringify({ success: true, results: [], message: "No semantic memories found. Try get_facts for structured facts." });
                }
                return JSON.stringify({ success: true, results });
            } catch (err) {
                console.error("❌ search_core_memory error:", err);
                const errMsg = err instanceof Error ? err.message : String(err);
                const isOllamaDown = errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed");
                return JSON.stringify({
                    success: false,
                    error: errMsg,
                    hint: isOllamaDown ? "Ollama is offline. Use get_facts tool for structured fact lookup." : undefined
                });
            }
        }
    });

    console.log("🔧 Registered Core Memory tools: store_fact, get_facts, get_chat_history, save_core_memory, search_core_memory");
}
