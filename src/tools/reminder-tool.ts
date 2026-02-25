import { registerTool } from "./registry.js";
import { createReminder } from "../reminders.js";
import { listReminders, cancelReminder } from "../db-provider.js";

export function registerReminderTools(): void {
    registerTool({
        name: "create_reminder",
        description: "Agende um lembrete para um momento específico no futuro. Use para tarefas, compromissos ou lembretes.",
        parameters: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "O texto/mensagem do lembrete (ex: 'Beber água')"
                },
                remind_at: {
                    type: "string",
                    description: "AÇÃO OBRIGATÓRIA: Para tempos relativos (daqui a X min/horas/dias), VOCÊ DEVE usar OBRIGATORIAMENTE o formato relativo: '+5 minutes', '+2 hours', '+1 day'. Para tempos fixos, use ISO COM FUSO HORÁRIO BRT: '2026-12-31T15:30:00-03:00'. NUNCA use 'Z' no final se estiver usando horário de Brasília!"
                }
            },
            required: ["text", "remind_at"]
        },
        execute: async (input: Record<string, unknown>, ctx?: any) => {
            const { text, remind_at } = input as { text: string; remind_at: string };
            try {
                console.log(`[reminder-tool] Raw remind_at received: "${remind_at}"`);

                // Parse remind_at
                let targetDate: Date;
                const raw = String(remind_at).trim().toLowerCase();

                if (raw.startsWith("+")) {
                    const match = raw.match(/\d+/);
                    if (!match) throw new Error("Quantidade inválida.");
                    const amount = parseInt(match[0]);
                    const unit = raw.match(/min/i) ? 60 * 1000 :
                        raw.match(/hour|hora/i) ? 60 * 60 * 1000 :
                            raw.match(/day|dia/i) ? 24 * 60 * 60 * 1000 :
                                raw.match(/sec|seg/i) ? 1000 : 0;
                    targetDate = new Date(Date.now() + amount * unit);
                } else if (raw === "amanhã") {
                    targetDate = new Date();
                    targetDate.setDate(targetDate.getDate() + 1);
                    targetDate.setHours(9, 0, 0, 0);
                } else {
                    // Ensure dates without timezone offset are treated as BRT (-03:00)
                    const hasTimezoneRegex = /(Z|[+-]\d{2}:?\d{2})$/i;
                    let dateStr = String(remind_at).trim();

                    if (!hasTimezoneRegex.test(dateStr)) {
                        dateStr += "-03:00";
                    }
                    targetDate = new Date(dateStr);
                }

                if (isNaN(targetDate.getTime())) {
                    throw new Error("Formato de data inválido. Use ISO ou '+N minutes'.");
                }

                if (targetDate <= new Date()) {
                    throw new Error(`O lembrete deve ser para o futuro. Data alvo interpretada: ${targetDate.toISOString()}`);
                }

                const chatId = String(ctx?.chatId || "unknown");
                const userId = ctx?.userId || 0;

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

    registerTool({
        name: "list_reminders",
        description: "Lista todos os seus lembretes pendentes agendados para o futuro. O retorno inclui o ID numérico necessário para cancelar o lembrete.",
        parameters: { type: "object", properties: {} },
        execute: async (_input: Record<string, unknown>, ctx?: any) => {
            const chatId = String(ctx?.chatId || "unknown");
            try {
                const reminders = await listReminders(chatId);
                if (reminders.length === 0) {
                    return JSON.stringify({ success: true, message: "Você não tem nenhum lembrete pendente no momento." });
                }

                const formatted = reminders.map(r =>
                    `[ID: ${r.id}] ${new Date(r.remind_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - "${r.reminder_text}"`
                ).join("\\n");

                return JSON.stringify({
                    success: true,
                    reminders: formatted
                });
            } catch (err) {
                console.error("❌ list_reminders tool error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        }
    });

    registerTool({
        name: "cancel_reminder",
        description: "Cancela (deleta) um lembrete existente. Use a ferramenta list_reminders para descobrir o ID do lembrete, se não souber.",
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "number",
                    description: "O ID numérico do lembrete a ser cancelado"
                }
            },
            required: ["id"]
        },
        execute: async (input: Record<string, unknown>, ctx?: any) => {
            const id = Number(input.id);
            const chatId = String(ctx?.chatId || "unknown");

            if (isNaN(id)) return JSON.stringify({ success: false, error: "ID inválido introduzido." });

            try {
                const success = await cancelReminder(chatId, id);
                if (success) {
                    return JSON.stringify({ success: true, message: `Lembrete (ID: ${id}) foi cancelado com sucesso.` });
                } else {
                    return JSON.stringify({ success: false, error: `Lembrete não encontrado (ID: ${id}) ou já concluído.` });
                }
            } catch (err) {
                console.error("❌ cancel_reminder tool error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        }
    });

    console.log("🔧 Registered Reminder tools: create_reminder, list_reminders, cancel_reminder");
}
