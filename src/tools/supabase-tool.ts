import { registerTool } from "./registry.js";
import { getClient } from "../supabase-db.js";

/**
 * Registers Supabase-related tools in the tool registry.
 * This allows agents (including sub-agents if they support tool calling) 
 * to query the database directly.
 */
export function registerSupabaseTools(): void {
    registerTool({
        name: "supabase_query",
        description: "Execute a read-only SELECT query on the Supabase database. Use this to retrieve memories, facts, or judgments. Tables: memories, facts, bot_messages, feedback, user_judgments.",
        parameters: {
            type: "object",
            properties: {
                table: {
                    type: "string",
                    description: "The table to query (e.g., 'memories', 'facts', 'user_judgments')"
                },
                select: {
                    type: "string",
                    description: "Comma-separated columns to select (default: '*')",
                    default: "*"
                },
                filter: {
                    type: "object",
                    description: "Optional filter (key-value pairs for equality). Example: { 'chat_id': '123' }"
                },
                order: {
                    type: "string",
                    description: "Column to order by"
                },
                limit: {
                    type: "number",
                    description: "Maximum rows to return (default: 10)",
                    default: 10
                }
            },
            required: ["table"]
        },
        execute: async ({ table, select, filter, order, limit }) => {
            try {
                // Ensure table is a string
                const tableName = String(table);

                // Start the query
                let query = getClient().from(tableName).select(String(select || "*"));

                // Apply filters if provided
                if (filter && typeof filter === 'object') {
                    for (const [key, value] of Object.entries(filter)) {
                        query = query.eq(key, value);
                    }
                }

                // Apply ordering if provided
                if (order) {
                    query = query.order(String(order), { ascending: false });
                }

                // Execute the query
                const { data, error } = await query.limit(Number(limit || 10));

                if (error) {
                    throw new Error(`Supabase Query Error: ${error.message}`);
                }

                if (!data || data.length === 0) {
                    return JSON.stringify({
                        success: true,
                        data: [],
                        message: `No results found in table '${tableName}'.`
                    });
                }

                return JSON.stringify({
                    success: true,
                    count: data.length,
                    data
                });
            } catch (err) {
                console.error("❌ supabase_query tool error:", err);
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    });

    console.log("🔧 Registered Supabase tool: supabase_query");
}
