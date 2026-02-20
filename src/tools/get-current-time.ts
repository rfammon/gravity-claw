import { registerTool } from "./registry.js";

registerTool({
    name: "get_current_time",
    description:
        "Returns the current date and time. Optionally accepts a timezone (IANA format, e.g. 'America/New_York').",
    parameters: {
        type: "object",
        properties: {
            timezone: {
                type: "string",
                description:
                    "IANA timezone identifier (e.g. 'America/Sao_Paulo'). Defaults to UTC.",
            },
        },
        required: [],
    },

    async execute(input) {
        const tz = (input.timezone as string) || "UTC";

        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat("en-US", {
                timeZone: tz,
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZoneName: "short",
            });

            return JSON.stringify({
                formatted: formatter.format(now),
                iso: now.toISOString(),
                timezone: tz,
                unix: Math.floor(now.getTime() / 1000),
            });
        } catch {
            return JSON.stringify({
                error: `Invalid timezone: "${tz}". Use IANA format like "America/New_York".`,
            });
        }
    },
});
