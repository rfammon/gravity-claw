import { exec } from "child_process";
import { promisify } from "util";
import { registerTool, Tool } from "./registry.js";

const execAsync = promisify(exec);

export const webmcpTool: Tool = {
    name: "scan_website",
    description: "Scans a given website URL using WebMCP Core and dynamically loads the available interaction tools for this agent. Use this if you need to browse a site or interact with its elements.",
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "The URL of the website to scan (e.g., https://amazon.com)" }
        },
        required: ["url"]
    },
    execute: async ({ url }) => {
        const targetUrl = url as string;
        try {
            console.log(`🔍 [WebMCP] Scanning website: ${targetUrl}...`);
            // Run the WebMCP core via npx to get JSON format tools
            const { stdout, stderr } = await execAsync(`npx -y webmcp-core scan ${targetUrl} --format json`, { timeout: 60000 });

            if (stderr && stderr.includes('npm error')) {
                console.warn(`[WebMCP] STDERR: ${stderr}`);
                // Proceed since npx sometimes prints to stderr even on success
            }

            // Try to parse the output as JSON. WebMCP might output extra logs before the JSON array.
            const jsonStartIdx = stdout.indexOf('[');
            const jsonEndIdx = stdout.lastIndexOf(']');
            if (jsonStartIdx === -1 || jsonEndIdx === -1) {
                return `Failed to parse WebMCP output. Output was: ${stdout}`;
            }

            const rawJson = stdout.substring(jsonStartIdx, jsonEndIdx + 1);
            let generatedTools: any[];
            try {
                generatedTools = JSON.parse(rawJson);
            } catch (e: any) {
                return `Failed to parse JSON extracted from WebMCP. Error: ${e.message}`;
            }

            // Register all dynamic generated tools
            const registeredNames: string[] = [];
            for (const toolDef of generatedTools) {
                const toolName = toolDef.name || toolDef.function?.name;
                const toolDesc = toolDef.description || toolDef.function?.description || `Action for ${toolName}`;
                const toolParams = toolDef.parameters || toolDef.function?.parameters || { type: "object", properties: {} };

                if (!toolName) continue;

                const dynamicTool: Tool = {
                    name: toolName,
                    description: toolDesc,
                    parameters: toolParams,
                    execute: async (input) => {
                        // The naive implementation just informs the agent tracking 
                        // In the future this could be mapped to Playwright or WebMCP execute
                        return `[Dynamic Tool - ${toolName}] Simulated execution with parameters: ${JSON.stringify(input)}. Action recorded via WebMCP integration.`;
                    }
                };

                registerTool(dynamicTool);
                registeredNames.push(toolName);
            }

            return `Successfully scanned ${targetUrl} and dynamically added these tools to your current registry: ${registeredNames.join(', ')}. You can now call them immediately.`;

        } catch (error: any) {
            console.error(`[WebMCP] Error scanning: ${error.message}`);
            return `Failed to scan ${targetUrl}. Error: ${error.message}`;
        }
    }
};

// Auto-register the scan tool itself.
export function registerWebMCPTool() {
    registerTool(webmcpTool);
}
