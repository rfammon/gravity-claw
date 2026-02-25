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
        description: "Execute a read-only SELECT query on the Supabase database. Tables include: memories, facts, bot_messages, feedback, user_judgments, financial_profile, expenses_one_time, expenses_recurring_fixed, expenses_recurring_variable, subscriptions, financial_projects, project_contributions, financial_alerts.",
        parameters: {
            type: "object",
            properties: {
                table: {
                    type: "string",
                    description: "The table to query (e.g., 'memories', 'facts', 'user_judgments', 'expenses_one_time')"
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
                    // Sanitize the order column. Some LLMs might pass "created_at.desc"
                    // which causes Supabase to generate "created_at.desc.desc"
                    const [orderCol, direction] = String(order).split('.');
                    const isAscending = direction?.toLowerCase() === 'asc';
                    query = query.order(orderCol, { ascending: direction ? isAscending : false });
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
    registerTool({
        name: "supabase_insert",
        description: "Insert one or more rows into a Supabase table. Tables include: memories, facts, bot_messages, feedback, user_judgments, financial_profile, expenses_one_time, expenses_recurring_fixed, expenses_recurring_variable, subscriptions, financial_projects, project_contributions, financial_alerts.",
        parameters: {
            type: "object",
            properties: {
                table: {
                    type: "string",
                    description: "The table to insert into (e.g., 'memories', 'facts', 'user_judgments', 'expenses_one_time')"
                },
                data: {
                    type: "object",
                    description: "The data to insert. Can be a single object or an array of objects for batch insertion."
                }
            },
            required: ["table", "data"]
        },
        execute: async ({ table, data }) => {
            try {
                const tableName = String(table);

                // Execute the insert
                const { data: result, error } = await getClient()
                    .from(tableName)
                    .insert(data)
                    .select(); // Ask for representation to confirm success

                if (error) {
                    throw new Error(`Supabase Insert Error: ${error.message}`);
                }

                return JSON.stringify({
                    success: true,
                    message: `Successfully inserted into table '${tableName}'.`,
                    count: result ? result.length : 0,
                    data: result
                });
            } catch (err) {
                console.error("❌ supabase_insert tool error:", err);
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    });

    console.log("🔧 Registered Supabase tools: supabase_query, supabase_insert");
}
