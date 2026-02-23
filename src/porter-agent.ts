import { ollamaChat } from "./ollama.js";

/**
 * Porter Agent - Local Executor
 * Manages the "O Porteiro" agent for local tasks.
 */
export class PorterAgent {
    private model = "porteiro-gravity";

    /**
     * Executes a command via the Porter agent.
     */
    async query(prompt: string): Promise<string> {
        try {
            const response = await ollamaChat([{ role: "user", content: prompt }], this.model);
            return response;
        } catch (error) {
            console.error("❌ PorterAgent Error:", error);
            return `[PORTEIRO] ⚠️ Erro ao processar comando: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Helper to format a notification for the system.
     */
    async notify(message: string, id?: string): Promise<string> {
        const prompt = `Execute notificação: ${message}${id ? ` - ID ${id}` : ""}`;
        return this.query(prompt);
    }
}

export const porter = new PorterAgent();
