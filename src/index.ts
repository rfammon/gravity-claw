// ─── Gravity Claw — Entry Point ──────────────────────────────────────
// Load config first (validates env vars — will exit if anything is missing)
import { config } from "./config.js";
import { setupDefaultTasks, setupGlobalTasks } from "./scheduler.js";
import { loadSkills } from "./skills.js";

// Register tools
console.log("🔧 Loading tools...");
import "./tools/get-current-time.js";
import "./tools/web-search.js";
import "./tools/trello.js";
import "./tools/registry.js"; // This now registers browser_url
import "./code-agent.js"; // GLM-5 code specialist sub-agent
import "./finance-agent.js"; // GLM-5 finance specialist sub-agent
import "./finance/finance-tools.js"; // 💰 CFO pessoal — 19 finance tools
import "./canvas/tool.js"; // 🎨 Live Canvas Tool

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
