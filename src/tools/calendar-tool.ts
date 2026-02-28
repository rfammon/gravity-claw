/**
 * Calendar Tools
 * Agent tools for Google Calendar integration.
 * Registered alongside reminder tools.
 */

import { registerTool } from "./registry.js";
import {
    isCalendarConfigured,
    listEvents,
    createCalendarEvent,
    deleteCalendarEvent,
    checkAvailability,
    listCalendars,
} from "../google-calendar.js";

export function registerCalendarTools(): void {
    // ── calendar_events ──────────────────────────────────────────
    registerTool({
        name: "calendar_events",
        description: `Lista eventos do Google Calendar. Use para ver a agenda do dia, semana, ou período.
Ranges: "today", "tomorrow", "this-week", "next-7-days".
Ou use from/to (ISO 8601) para datas específicas.`,
        parameters: {
            type: "object",
            properties: {
                range: {
                    type: "string",
                    enum: ["today", "tomorrow", "this-week", "next-7-days"],
                    description: "Período pré-definido para buscar eventos",
                },
                from: {
                    type: "string",
                    description: "Data início (ISO 8601). Usado se 'range' não for especificado.",
                },
                to: {
                    type: "string",
                    description: "Data fim (ISO 8601). Opcional.",
                },
                limit: {
                    type: "number",
                    description: "Máximo de eventos (default: 15)",
                },
            },
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado. Defina GOOGLE_CALENDAR_TOKEN no .env." });
            }
            try {
                const events = await listEvents({
                    range: input.range as any,
                    from: input.from as string,
                    to: input.to as string,
                    limit: input.limit as number,
                });

                if (events.length === 0) {
                    return JSON.stringify({ success: true, message: "Nenhum evento encontrado no período.", events: [] });
                }

                const formatted = events.map((e) => ({
                    id: e.id,
                    titulo: e.summary,
                    inicio: e.start,
                    fim: e.end,
                    local: e.location || null,
                    meet: e.meetLink || null,
                }));

                return JSON.stringify({ success: true, count: events.length, events: formatted });
            } catch (err) {
                console.error("❌ calendar_events error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    // ── calendar_create ──────────────────────────────────────────
    registerTool({
        name: "calendar_create",
        description: `Cria um evento no Google Calendar. Use para agendar reuniões, compromissos, etc.
O evento aparecerá no calendário do usuário. Suporta Google Meet link.`,
        parameters: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Título do evento (ex: 'Reunião de equipe')",
                },
                start: {
                    type: "string",
                    description: "Horário de início (ISO 8601 com fuso): '2026-03-01T14:00:00-03:00'",
                },
                duration_minutes: {
                    type: "number",
                    description: "Duração em minutos (default: 60)",
                },
                end: {
                    type: "string",
                    description: "Horário de fim (ISO 8601). Alternativa a duration_minutes.",
                },
                description: {
                    type: "string",
                    description: "Descrição do evento",
                },
                location: {
                    type: "string",
                    description: "Local do evento",
                },
                attendees: {
                    type: "string",
                    description: "Emails dos participantes separados por vírgula",
                },
                meet: {
                    type: "boolean",
                    description: "Adicionar link do Google Meet (default: false)",
                },
            },
            required: ["title", "start"],
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado." });
            }
            try {
                const attendees = input.attendees
                    ? String(input.attendees).split(",").map((e) => e.trim()).filter(Boolean)
                    : undefined;

                const event = await createCalendarEvent({
                    summary: String(input.title),
                    start: String(input.start),
                    end: input.end ? String(input.end) : undefined,
                    durationMinutes: (input.duration_minutes as number) || 60,
                    description: input.description ? String(input.description) : undefined,
                    location: input.location ? String(input.location) : undefined,
                    attendees,
                    addMeetLink: !!input.meet,
                });

                return JSON.stringify({
                    success: true,
                    message: `Evento "${event.summary}" criado com sucesso!`,
                    event_id: event.id,
                    link: event.htmlLink,
                    meet_link: event.meetLink || null,
                });
            } catch (err) {
                console.error("❌ calendar_create error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    // ── calendar_delete ──────────────────────────────────────────
    registerTool({
        name: "calendar_delete",
        description: "Deleta um evento do Google Calendar pelo seu ID. Use calendar_events para listar os IDs.",
        parameters: {
            type: "object",
            properties: {
                event_id: {
                    type: "string",
                    description: "ID do evento a ser deletado",
                },
            },
            required: ["event_id"],
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado." });
            }
            try {
                const success = await deleteCalendarEvent(String(input.event_id));
                return JSON.stringify({
                    success,
                    message: success ? "Evento deletado com sucesso." : "Falha ao deletar evento.",
                });
            } catch (err) {
                console.error("❌ calendar_delete error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    // ── calendar_busy ────────────────────────────────────────────
    registerTool({
        name: "calendar_busy",
        description: `Verifica disponibilidade/agenda para um dia. Retorna eventos do dia e horários livres.
Útil antes de agendar algo, para checar conflitos.`,
        parameters: {
            type: "object",
            properties: {
                date: {
                    type: "string",
                    description: "Data para verificar (ISO 8601 ou 'today', 'tomorrow'). Default: hoje.",
                },
            },
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado." });
            }
            try {
                let dateStr = input.date ? String(input.date) : undefined;
                // Handle natural language
                if (dateStr === "today" || dateStr === "hoje") dateStr = undefined; // today is default
                if (dateStr === "tomorrow" || dateStr === "amanhã") {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    dateStr = tomorrow.toISOString();
                }

                const availability = await checkAvailability(dateStr);

                return JSON.stringify({
                    success: true,
                    date: availability.date,
                    total_events: availability.eventCount,
                    events: availability.events,
                    free_slots: availability.freeSlots,
                });
            } catch (err) {
                console.error("❌ calendar_busy error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    // ── calendar_sync_reminder ───────────────────────────────────
    registerTool({
        name: "calendar_sync_reminder",
        description: `Cria um evento no Google Calendar a partir de um lembrete existente. 
Use após criar um lembrete com create_reminder para sincronizar com o calendário.
Ou use diretamente para criar um lembrete que já aparece no Google Calendar.`,
        parameters: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "Texto do lembrete/evento",
                },
                remind_at: {
                    type: "string",
                    description: "Data/hora do lembrete (ISO 8601 com fuso: '2026-03-01T14:00:00-03:00')",
                },
                duration_minutes: {
                    type: "number",
                    description: "Duração do evento no calendário (default: 30)",
                },
            },
            required: ["text", "remind_at"],
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado." });
            }
            try {
                const event = await createCalendarEvent({
                    summary: `🔔 ${input.text}`,
                    description: "Lembrete criado pelo Megamind",
                    start: String(input.remind_at),
                    durationMinutes: (input.duration_minutes as number) || 30,
                });

                return JSON.stringify({
                    success: true,
                    message: `Lembrete sincronizado com Google Calendar!`,
                    event_id: event.id,
                    link: event.htmlLink,
                });
            } catch (err) {
                console.error("❌ calendar_sync_reminder error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    console.log("📅 Registered Calendar tools: calendar_events, calendar_create, calendar_delete, calendar_busy, calendar_sync_reminder");
}
