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
} from "../supabase-calendar.js";
import { broadcastToCanvas } from "../canvas/server.js";
import { renderHtmlToImage } from "../canvas/renderer.js";

/**
 * Parse flexible date/time inputs:
 * - Relative: "+5 minutes", "+2 hours", "+1 day"
 * - Natural: "amanhã", "tomorrow"
 * - ISO 8601: "2026-03-01T14:00:00-03:00"
 * - ISO without timezone: appends -03:00 (BRT)
 */
function parseFlexibleDate(input: string): Date {
    const raw = String(input).trim();
    const lower = raw.toLowerCase();

    // Relative time: +N minutes/hours/days
    if (lower.startsWith("+")) {
        const match = lower.match(/\d+/);
        if (!match) throw new Error("Quantidade inválida no tempo relativo.");
        const amount = parseInt(match[0]);
        const unit = lower.match(/min/i) ? 60 * 1000 :
            lower.match(/hour|hora/i) ? 60 * 60 * 1000 :
                lower.match(/day|dia/i) ? 24 * 60 * 60 * 1000 :
                    lower.match(/sec|seg/i) ? 1000 : 0;
        if (unit === 0) throw new Error("Unidade de tempo não reconhecida. Use minutes, hours, ou days.");
        return new Date(Date.now() + amount * unit);
    }

    // Natural language
    if (lower === "amanhã" || lower === "tomorrow") {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
    }
    if (lower === "hoje" || lower === "today" || lower === "now" || lower === "agora") {
        return new Date();
    }

    // ISO 8601 – ensure timezone offset
    let dateStr = raw;
    const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(dateStr);
    if (!hasTimezone && dateStr.includes("T")) {
        dateStr += "-03:00";
    }

    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
        throw new Error(`Formato de data inválido: "${input}". Use ISO 8601 (ex: 2026-03-01T14:00:00-03:00) ou tempo relativo (ex: +30 minutes).`);
    }
    return parsed;
}

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
        execute: async (input: Record<string, unknown>): Promise<string | import('./registry.js').ToolResult> => {
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
O evento aparecerá no calendário do usuário. Suporta Google Meet link.
Formatos aceitos para 'start': ISO 8601 ('2026-03-01T14:00:00-03:00'), relativo ('+30 minutes', '+2 hours'), ou natural ('amanhã').`,
        parameters: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Título do evento (ex: 'Reunião de equipe')",
                },
                start: {
                    type: "string",
                    description: "Horário de início. Aceita: ISO 8601 ('2026-03-01T14:00:00-03:00'), relativo ('+5 minutes', '+2 hours', '+1 day'), ou natural ('amanhã', 'tomorrow').",
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
            },
            required: ["title", "start"],
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Google Calendar não configurado." });
            }
            try {

                // Parse flexible date formats
                const startDate = parseFlexibleDate(String(input.start));
                const endDate = input.end ? parseFlexibleDate(String(input.end)) : undefined;

                console.log(`[calendar_create] Parsed start: ${startDate.toISOString()}, raw: "${input.start}"`);

                const event = await createCalendarEvent({
                    summary: String(input.title),
                    start: startDate,
                    end: endDate,
                    durationMinutes: (input.duration_minutes as number) || 60,
                    description: input.description ? String(input.description) : undefined,
                    location: input.location ? String(input.location) : undefined,
                });

                return JSON.stringify({
                    success: true,
                    message: `Evento "${event.summary}" criado com sucesso!`,
                    event_id: event.id,
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
                    description: "Data/hora do lembrete. Aceita: ISO 8601 ('2026-03-01T14:00:00-03:00'), relativo ('+5 minutes'), ou natural ('amanhã').",
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
                const parsedDate = parseFlexibleDate(String(input.remind_at));
                console.log(`[calendar_sync_reminder] Parsed remind_at: ${parsedDate.toISOString()}, raw: "${input.remind_at}"`);

                const event = await createCalendarEvent({
                    summary: `🔔 ${input.text}`,
                    description: "Lembrete criado pelo Megamind",
                    start: parsedDate,
                    durationMinutes: (input.duration_minutes as number) || 30,
                });

                return JSON.stringify({
                    success: true,
                    message: `Lembrete sincronizado com Google Calendar!`,
                    event_id: event.id,
                });
            } catch (err) {
                console.error("❌ calendar_sync_reminder error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    // ── calendar_visualize ───────────────────────────────────────
    registerTool({
        name: "calendar_visualize",
        description: `Gera uma visualização rica e interativa do calendário e envia para o Live Canvas do usuário. Use quando o usuário pedir para 'ver a agenda' de forma visual.`,
        parameters: {
            type: "object",
            properties: {
                days_ahead: {
                    type: "number",
                    description: "Quantos dias à frente mostrar (default: 7)",
                },
            },
        },
        execute: async (input: Record<string, unknown>) => {
            if (!isCalendarConfigured()) {
                return JSON.stringify({ success: false, error: "Calendário não configurado." });
            }
            try {
                const daysAhead = (input.days_ahead as number) || 7;
                const now = new Date();
                const endTimestamp = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

                const events = await listEvents({
                    from: now.toISOString(),
                    to: endTimestamp.toISOString(),
                    limit: 50
                });

                // Group events by day
                const grouped: Record<string, any[]> = {};
                for (const ev of events) {
                    const d = new Date(ev.start);
                    // YYYY-MM-DD
                    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (!grouped[dateKey]) grouped[dateKey] = [];
                    grouped[dateKey].push(ev);
                }

                // Generate HTML
                let html = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                    body {
                        font-family: 'Inter', sans-serif;
                        background: transparent;
                        color: #f3f4f6;
                        margin: 0;
                        padding: 20px;
                    }
                    .agenda-container {
                        display: flex;
                        flex-direction: column;
                        gap: 20px;
                        max-width: 600px;
                        margin: 0 auto;
                    }
                    .header {
                        font-size: 1.5rem;
                        font-weight: 700;
                        text-align: center;
                        margin-bottom: 10px;
                        background: linear-gradient(90deg, #a855f7, #3b82f6);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                    .day-group {
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 16px;
                        padding: 20px;
                        backdrop-filter: blur(10px);
                    }
                    .day-header {
                        font-size: 1.2rem;
                        font-weight: 600;
                        margin-bottom: 15px;
                        color: #c084fc;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                        padding-bottom: 10px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .event-card {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                        padding: 14px;
                        margin-bottom: 12px;
                        background: rgba(0, 0, 0, 0.25);
                        border-radius: 10px;
                        border-left: 4px solid #34d399;
                        transition: transform 0.2s;
                    }
                    .event-card:last-child { margin-bottom: 0; }
                    .event-card:hover { transform: translateX(5px); background: rgba(0, 0, 0, 0.35); }
                    .event-title { font-weight: 600; font-size: 1.1rem; color: #ffffff; }
                    .event-time { font-size: 0.9rem; color: #9ca3af; }
                    .event-location { font-size: 0.85rem; color: #6b7280; margin-top: 4px; }
                    .empty-state {
                        text-align: center;
                        color: #9ca3af;
                        padding: 40px;
                        font-size: 1.1rem;
                        background: rgba(255, 255, 255, 0.02);
                        border-radius: 16px;
                        border: 1px dashed rgba(255, 255, 255, 0.1);
                    }
                </style>
                <div class="agenda-container">
                    <div class="header">Agenda (Próximos ${daysAhead} dias)</div>
                `;

                const sortedDates = Object.keys(grouped).sort();

                if (sortedDates.length === 0) {
                    html += `<div class="empty-state">Nenhum evento agendado para este período. 🌴</div>`;
                } else {
                    for (const dateKey of sortedDates) {
                        const dateObj = new Date(dateKey + "T12:00:00Z"); // Fix TZ shifting
                        const dayName = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(dateObj);
                        const dayNum = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(dateObj);
                        const dayTitle = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${dayNum}`;

                        html += `<div class="day-group"><div class="day-header">📅 ${dayTitle}</div>`;

                        const dayEvents = grouped[dateKey].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

                        for (const ev of dayEvents) {
                            const startTime = new Date(ev.start).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', timeZone: "America/Sao_Paulo" });
                            const endTime = ev.end ? new Date(ev.end).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit', timeZone: "America/Sao_Paulo" }) : '';
                            const timeStr = endTime ? `${startTime} - ${endTime}` : startTime;

                            html += `
                                <div class="event-card">
                                    <div class="event-title">${ev.summary}</div>
                                    <div class="event-time">🕒 ${timeStr}</div>
                                    ${ev.location ? '<div class="event-location">📍 ' + ev.location + '</div>' : ''}
                                </div>
                            `;
                        }
                        html += `</div>`;
                    }
                }

                html += `</div>`;

                // 1. Broadcast to websocket
                const wsSuccess = broadcastToCanvas({ type: 'html', content: html });

                // 2. Headless screenshot
                const imageBuffer = await renderHtmlToImage(html, 'html');

                return {
                    text: `✅ Calendário enviado para a tela do Live Canvas.`,
                    media: [{
                        type: "image",
                        buffer: imageBuffer,
                        caption: `📅 Agenda visual gerada`
                    }]
                };

            } catch (err) {
                console.error("❌ calendar_visualize error:", err);
                return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
        },
    });

    console.log("📅 Registered Calendar tools: calendar_events, calendar_create, calendar_delete, calendar_busy, calendar_sync_reminder, calendar_visualize");
}
