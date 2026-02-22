// ─── Gravity Claw — Entry Point ──────────────────────────────────────
// Platform detection first (validates runtime environment)
import { logPlatformInfo, getPlatformConfig } from "./platform.js";
await logPlatformInfo();

// Load config (validates env vars — will exit if anything is missing)
import { config } from "./config.js";
import { setupDefaultTasks, setupGlobalTasks } from "./scheduler.js";
import { loadSkills } from "./skills.js";

// Get platform-specific configuration
const platformConfig = await getPlatformConfig();
console.log(`🔧 Platform config: DB=${platformConfig.dbBackend}, Browser=${platformConfig.enableBrowserTool ? 'enabled' : 'disabled'}`);

// Register tools
console.log("🔧 Loading tools...");
import "./tools/get-current-time.js";
import "./tools/web-search.js";
import "./tools/trello.js";
import "./tools/registry.js"; // This now registers browser_url
import "./code-agent.js"; // GLM-5 code specialist sub-agent
import "./finance/finance-tools.js"; // 💰 CFO pessoal — 19 finance tools
import "./canvas/tool.js"; // 🎨 Live Canvas Tool
import { registerSessionTools } from "./sessions/tools.js"; // 🤖 Agent-to-Agent Sessions
registerSessionTools();

// 🔔 Smart Recommendations — proactive suggestions based on behavior patterns
import "./tools/recommendations.js";
console.log("🔔 Smart Recommendations enabled");

// 🛡️ Encrypted Secrets — AES-256 encrypted API key storage
import { registerSecretTools } from "./tools/secrets.js";
registerSecretTools();
console.log("🛡️ Encrypted Secrets enabled");

// ☁️ Supabase Tools — Native database access for agents
import { registerSupabaseTools } from "./tools/supabase-tool.js";
registerSupabaseTools();
console.log("☁️ Supabase Tools enabled");

// Start Live Canvas WebSocket Server
import { startCanvasServer } from "./canvas/server.js";
startCanvasServer();

// Load skills and setup proactive tasks
await loadSkills();
config.allowedUserIds.forEach(id => setupDefaultTasks(String(id)));
setupGlobalTasks(); // Background agents that run exactly once

// Start heartbeat (Trello sync, etc.)
import { startHeartbeat } from "./heartbeat.js";
startHeartbeat();

// Start the bot
console.log("🚀 Starting Gravity Claw...");
import { startBot } from "./bot.js";
startBot();
