import dotenv from "dotenv";
dotenv.config({ override: true });

// ── helpers ──────────────────────────────────────────────
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`❌ Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

function parseUserIds(raw: string): number[] {
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => {
            const num = Number(id);
            if (Number.isNaN(num)) {
                console.error(`❌ Invalid user ID: "${id}" — must be a number`);
                process.exit(1);
            }
            return num;
        });
}

// ── exported config ──────────────────────────────────────
export const config = {
    telegramToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    openRouterKey: requireEnv("OPENROUTER_API_KEY"),
    groqApiKey: requireEnv("GROQ_API_KEY"),
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
    airGappedMode: process.env.AIR_GAPPED_MODE === "true",
    modalBaseUrl: process.env.MODAL_BASE_URL || "",
    modalApiKey: process.env.MODAL_API_KEY || "",
    ocrSpaceApiKey: process.env.OCR_SPACE_API_KEY || "",
} as const;
