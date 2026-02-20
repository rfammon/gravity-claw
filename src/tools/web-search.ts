import axios from "axios";
import { registerTool } from "./registry.js";

/**
 * Web Search Tool
 * Satisfies: 2. Web Search
 */
registerTool({
    name: "web_search",
    description: "Search the web for real-time information using Google/Bing via Tavily or similar API.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "The search query" }
        },
        required: ["query"]
    },
    execute: async ({ query }) => {
        console.log(`🔍 Searching the web for: ${query}`);
        // Assuming TAVILY_API_KEY in env
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            return "❌ Web search error: TAVILY_API_KEY missing.";
        }

        try {
            const response = await axios.post("https://api.tavily.com/search", {
                api_key: apiKey,
                query,
                search_depth: "basic",
                max_results: 5
            });

            const results = response.data.results;
            if (!results || results.length === 0) return "No results found.";

            return results.map((r: any) => `[${r.title}](${r.url})\n${r.content}`).join("\n\n");
        } catch (error: any) {
            return `❌ Search failed: ${error.message}`;
        }
    }
});
