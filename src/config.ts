import dotenv from "dotenv";
dotenv.config({ override: true });

// Debug: Show what env vars are loaded
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🔧 Config Loading");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// ── helpers ──────────────────────────────────────────────
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value === "") {
        console.error(`❌ Missing required environment variable: ${name}`);
        return "";
    }
    // Sanitize: remove leading/trailing whitespace, quotes, and common terminal artifacts like '>'
    const cleanValue = value.replace(/['">\r\n]/g, '').trim();
    console.log(`   ${name}: ✅ Loaded`);
    return cleanValue;
}

function optionalEnv(name: string, defaultValue: string = ""): string {
    const value = process.env[name];
    if (!value || value === "") {
        console.log(`   ${name}: ⚪ Not set (using default)`);
        return defaultValue;
    }
    // Sanitize
    const cleanValue = value.replace(/['">\r\n]/g, '').trim();
    // Mask sensitive values
    const masked = cleanValue.length > 20
        ? cleanValue.substring(0, 10) + "..." + cleanValue.substring(cleanValue.length - 6)
        : "***";
    console.log(`   ${name}: ✅ Loaded (${masked})`);
    return cleanValue;
}


function parseUserIds(raw: string): number[] {
    if (!raw || raw === "") {
        console.error("❌ ALLOWED_USER_IDS is empty!");
        return [];
    }

    return raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => {
            const num = Number(id);
            if (Number.isNaN(num)) {
                console.error(`❌ Invalid user ID: "${id}" — must be a number`);
                return 0;
            }
            return num;
        })
        .filter(id => id > 0);
}

// ── Load and validate ──────────────────────────────────────
console.log("\n📋 Required variables:");
const telegramToken = requireEnv("TELEGRAM_BOT_TOKEN");
const openRouterKey = requireEnv("OPENROUTER_API_KEY");
const groqApiKey = requireEnv("GROQ_API_KEY");
const allowedUserIdsRaw = requireEnv("ALLOWED_USER_IDS");

console.log("\n📋 Optional variables:");
const supabaseUrl = optionalEnv("SUPABASE_URL");
const supabaseServiceKey = optionalEnv("SUPABASE_SERVICE_KEY");
const modalBaseUrl = optionalEnv("MODAL_BASE_URL");
const modalApiKey = optionalEnv("MODAL_API_KEY");
const ocrSpaceApiKey = optionalEnv("OCR_SPACE_API_KEY");
const masterKey = optionalEnv("MASTER_KEY");

console.log("\n📋 Ollama Cloud / Local:");
const ollamaApiKey = optionalEnv("OLLAMA_API_KEY");
let ollamaBaseUrl = optionalEnv("OLLAMA_BASE_URL");

// Para chat: se tem API key e URL explícita, usa cloud; caso contrário, local
if (!ollamaBaseUrl) {
    ollamaBaseUrl = ollamaApiKey ? "https://ollama.com/api" : "http://localhost:11434";
}

// Para embeddings: sempre usa local (a menos que explicitamente configurado)
const ollamaEmbedUrl = process.env.OLLAMA_EMBED_URL || "http://localhost:11434";

console.log(`   Ollama: URL=${ollamaBaseUrl}, EmbedURL=${ollamaEmbedUrl}, HasAPIKey=${!!ollamaApiKey}`);

console.log("\n📋 OpenCode Zen:");
const openCodeApiKey = optionalEnv("OPENCODE_API_KEY");
const openCodeBaseUrl = optionalEnv("OPENCODE_BASE_URL", "https://opencode.ai/zen/v1");
const openCodeDefaultModel = optionalEnv("OPENCODE_DEFAULT_MODEL", "big-pickle");

console.log("\n📋 Local AI:");
const primaryProviderRaw = optionalEnv("PRIMARY_PROVIDER", "openrouter");
const primaryProvider = (primaryProviderRaw || "openrouter").replace(/['">\r\n]/g, '').toLowerCase();

const ollamaDefaultModelRaw = optionalEnv("OLLAMA_DEFAULT_MODEL");
const ollamaDefaultModel = (ollamaDefaultModelRaw || (ollamaApiKey ? "glm-5:cloud" : "llama3.2:3b")).replace(/['"\r\n]/g, '').trim();
console.log("\n📋 Google Calendar:");
const googleCalendarToken = optionalEnv("GOOGLE_CALENDAR_TOKEN");
const googleCalendarRefreshToken = optionalEnv("GOOGLE_CALENDAR_REFRESH_TOKEN");
const googleClientId = optionalEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = optionalEnv("GOOGLE_CLIENT_SECRET");
const googleCalendarId = optionalEnv("GOOGLE_CALENDAR_ID", "primary");

console.log("\n📋 Parsed values:");
const allowedUserIds = parseUserIds(allowedUserIdsRaw);
console.log(`   ALLOWED_USER_IDS: [${allowedUserIds.join(", ")}]`);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ── exported config ──────────────────────────────────────
export const config = {
    // Required
    telegramToken,
    openRouterKey,
    groqApiKey,
    allowedUserIds,

    // Feature flags
    airGappedMode: process.env.AIR_GAPPED_MODE === "true",

    // Optional - External services
    modalBaseUrl,
    modalApiKey,
    ocrSpaceApiKey,
    masterKey,
    openCodeApiKey,
    openCodeBaseUrl,
    openCodeDefaultModel,
    primaryProvider,
    ollamaDefaultModel,

    // ── Supabase (optional — enables cloud DB) ───────────
    supabaseUrl,
    supabaseServiceKey,

    // ── Ollama Cloud / Local ─────────────────────────────
    ollamaBaseUrl,
    ollamaApiKey,
    ollamaEmbedUrl,

    // ── Performance ────────────────────────────────────────
    lowResourceMode: process.env.LOW_RESOURCE_MODE === "true",
    maxConcurrentTools: parseInt(process.env.MAX_CONCURRENT_TOOLS || "4"),

    // ── OpenCode Zen models resolved at top ──

    // ── Google Calendar ─────────────────────────────────────
    googleCalendarToken,
    googleCalendarRefreshToken,
    googleClientId,
    googleClientSecret,
    googleCalendarId,
} as const;

// Validation
if (!telegramToken || !openRouterKey || !groqApiKey || allowedUserIds.length === 0) {
    console.error("\n❌ Missing required configuration. Please check your .env file.");
    console.error("   Required: TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, GROQ_API_KEY, ALLOWED_USER_IDS");
    process.exit(1);
}

// Summary
console.log("✅ Configuration loaded successfully");
if (config.supabaseUrl && config.supabaseServiceKey) {
    console.log("☁️  Supabase: ENABLED");
} else {
    console.log("💾 Supabase: DISABLED (using local SQLite)");
}
if (config.googleCalendarToken) {
    console.log("📅 Google Calendar: ENABLED");
} else {
    console.log("📅 Google Calendar: DISABLED (set GOOGLE_CALENDAR_TOKEN)");
}
if (config.ollamaApiKey) {
    console.log(`🤖 Ollama Cloud: ENABLED (Model: ${config.ollamaDefaultModel})`);
} else {
    console.log("🤖 Ollama: LOCAL (No API Key detected)");
}
