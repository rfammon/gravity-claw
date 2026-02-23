import { config } from "./config.js";

let puterModule: any = null;

/**
 * Encapsulates Puter.js logic for use across the app.
 * This is based on the logic currently in code-agent.ts but generalized.
 */
export async function getPuterClient(): Promise<any> {
    if (!puterModule) {
        // Use dynamic import for the CJS module
        puterModule = await import("@heyputer/puter.js/src/init.cjs");
    }

    const { init } = puterModule;

    // Token logic: param > env > .puter-token file
    let token = config.puterToken;

    if (!token) {
        try {
            const fs = await import("fs");
            const tokenPath = "./.puter-token";
            if (fs.existsSync(tokenPath)) {
                token = fs.readFileSync(tokenPath, "utf-8").trim();
            }
        } catch {
            // Ignore if file doesn't exist
        }
    }

    return init(token || undefined);
}

/**
 * Standardized Puter Chat Completion wrapper
 */
export async function puterChat(messages: any[], model?: string) {
    const puter = await getPuterClient();
    const targetModel = model || config.puterDefaultModel || "moonshotai/kimi-k2.5";

    const response = await puter.ai.chat(messages, { model: targetModel });

    // Extraction logic similar to code-agent.ts
    if (typeof response === "string") return response;
    if (response?.message?.content) return response.message.content;
    if (response?.content) return response.content;
    if (response?.text) return response.text;

    // Auth error check
    const raw = JSON.stringify(response);
    if (raw.includes("token") || raw.includes("auth")) {
        throw new Error("Puter authentication failed: " + (response?.message || raw));
    }

    return raw;
}
