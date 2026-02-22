import type { Tool, ToolResult } from "../tools/registry.js";
import { registerTool } from "../tools/registry.js";
import { broadcastToCanvas } from "./server.js";
import { renderHtmlToImage } from "./renderer.js";

export const pushToCanvasTool: Tool = {
    name: "push_to_canvas",
    description: "Pushes interactive HTML/JS widgets, charts, tables, or forms directly to the user's Live Canvas web screen. Use this when the user asks for a visual representation, interactive form, or rich UI.",
    parameters: {
        type: "object",
        properties: {
            type: {
                type: "string",
                description: "The type of content being pushed (e.g., 'html', 'chart', 'form', 'table')",
            },
            content: {
                type: "string",
                description: "The raw HTML code or stringified JSON data for the widget.",
            }
        },
        required: ["type", "content"]
    },
    execute: async (input): Promise<ToolResult> => {
        const { type, content } = input;

        console.log(`🎨 Agent is pushing a '${type}' widget to Live Canvas.`);

        // 1. Send to websocket (fast, background)
        const wsSuccess = broadcastToCanvas({ type, content });
        const textNodes = wsSuccess
            ? `✅ Broadcasted to Live Canvas websocket.`
            : `ℹ️ Note: Live Canvas web interface is currently disconnected.`;

        try {
            // 2. Headless screenshot
            console.log(`📸 Taking snapshot of the Canvas HTML...`);
            const imageBuffer = await renderHtmlToImage(String(content), String(type));

            // Return complex result
            return {
                text: `${textNodes}\n✅ Successfully captured screenshot of the UI. Sending to user.`,
                media: [{
                    type: "image",
                    buffer: imageBuffer,
                    caption: `🎨 UI Generated: ${type}`
                }]
            };
        } catch (e: any) {
            console.error("Failed to render UI:", e);
            return { text: `${textNodes}\n❌ Failed to generate screenshot: ${e.message}` };
        }
    }
};

// Register it automatically
registerTool(pushToCanvasTool);
