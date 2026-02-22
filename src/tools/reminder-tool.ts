import { registerTool } from "./registry.js";
import { createReminder } from "../reminders.js";

export function registerReminderTools(): void {
    registerTool({
        name: "create_reminder",
        description: "Agende um lembrete para um momento específico no futuro. Use para tarefas, compromissos ou lembretes rápidos.",
        parameters: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "O texto do lembrete (ex: 'Beber água')"
                },
                remind_at: {
                    type: "string",
                    description: "Data/Hora em formato ISO ou string amigável (ex: '2026-02-21T18:00:00Z', ou '+5 minutes', '+1 hour', 'amanhã 08:00')"
                }
            },
            required: ["text", "remind_at"]
        },
        execute: async (input: Record<string, unknown>, ctx?: any) => {
            const { text, remind_at } = input as { text: string; remind_at: string };
            try {
                // Parse remind_at
                let targetDate: Date;
                const raw = String(remind_at).toLowerCase();

                if (raw.startsWith("+")) {
                    const match = raw.match(/\d+/);
                    if (!match) throw new Error("Quantidade inválida.");
                    const amount = parseInt(match[0]);
                    const unit = raw.includes("minute") ? 60 * 1000 :
                        raw.includes("hour") ? 60 * 60 * 1000 :
                            raw.includes("second") ? 1000 : 0;
                    targetDate = new Date(Date.now() + amount * unit);
                } else if (raw === "amanhã") {
                    targetDate = new Date();
                    targetDate.setDate(targetDate.getDate() + 1);
                    targetDate.setHours(9, 0, 0, 0);
                } else {
                    targetDate = new Date(String(remind_at));
                }

                if (isNaN(targetDate.getTime())) {
                    throw new Error("Formato de data inválido. Use ISO ou '+N minutes'.");
                }

                if (targetDate <= new Date()) {
                    throw new Error("O lembrete deve ser para o futuro.");
                }

                const chatId = String(ctx?.chat?.id || "unknown");
                const userId = ctx?.from?.id || 0;

                await createReminder(chatId, userId, String(text), targetDate);

                return JSON.stringify({
                    success: true,
                    message: `Lembrete criado: "${text}" para ${targetDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
                });
            } catch (err) {
                console.error("❌ create_reminder tool error:", err);
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
    });

    console.log("🔧 Registered Reminder tool: create_reminder");
}
