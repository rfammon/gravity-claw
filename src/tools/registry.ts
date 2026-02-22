import type OpenAI from "openai";
import { browserTool } from "./browser-tool.js";

// ── types ────────────────────────────────────────────────
export interface ToolResult {
    text: string;            // Stringified result for the LLM history
    media?: {               // Optional media to be sent to the user
        type: "image" | "audio" | "document";
        buffer: Buffer;
        caption?: string;
    }[];
}

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    execute: (input: Record<string, unknown>, ctx?: any) => Promise<string | ToolResult>;
}

// ── registry ─────────────────────────────────────────────
const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    if (registry.has(tool.name)) {
        console.warn(`⚠️ Tool "${tool.name}" already registered — skipping`);
        return;
    }
    registry.set(tool.name, tool);
    console.log(`🔧 Registered tool: ${tool.name}`);
}

export function getTool(name: string): Tool | undefined {
    return registry.get(name);
}

// ── Default Tools Registration ───────────────────────────
registerTool({
    name: "browse_url",
    description: "Navigate to a URL and extract text content or take a screenshot.",
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "The URL to visit" },
            action: { type: "string", enum: ["extract", "screenshot"], default: "extract" }
        },
        required: ["url"]
    },
    execute: async ({ url, action }) => {
        const result = await browserTool.browse(url as string, action as any);
        return typeof result === 'string' ? result : "Screenshot saved/returned as buffer (internal)";
    }
});

/** Convert to OpenAI function-calling format */
export function getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return Array.from(registry.values()).map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}
