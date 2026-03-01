<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Telegram-Bot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase-Cloud_DB-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Android%20%7C%20Win%20%7C%20Mac-black?style=for-the-badge" />
</p>

# 🦾 Gravity Claw — Megamind AI Agent

> *"APRESENTAÇÃO É TUDO!"* — Megamind

**Gravity Claw** is a lean, secure, fully autonomous personal AI agent that runs as a Telegram bot. Built with TypeScript, it features a multi-provider LLM backend, 40+ integrated tools, proactive intelligence, self-modification capabilities, financial management, Google Calendar integration, and persistent cloud memory via Supabase.

The bot's persona is **Megamind** — the dramatic, theatrical super-villain turned hero — acting as a powerful personal assistant for its owner.

---

## 📑 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Environment Variables](#-environment-variables)
- [Tool Reference](#-tool-reference)
- [LLM Providers & Fallback Chain](#-llm-providers--fallback-chain)
- [Proactive Intelligence](#-proactive-intelligence)
- [Database Schema (Supabase)](#-database-schema-supabase)
- [Self-Modification (Code Sandbox)](#-self-modification-code-sandbox)
- [Google Calendar Integration](#-google-calendar-integration)
- [Deployment](#-deployment)
- [Scripts & Utilities](#-scripts--utilities)
- [Skills System](#-skills-system)

---

## ✨ Features

### 🧠 Core Intelligence
- **Agentic Tool Loop** — Up to 10-iteration autonomous tool-calling loop per message
- **Multi-Provider LLM** — OpenRouter (Gemini 2.5 Flash) → Groq → Ollama fallback chain
- **Persistent Memory** — Supabase (cloud) or SQLite (local) with facts, chat history, and core memories
- **Megamind Persona** — Dramatic, theatrical AI personality maintained across all interactions

### 💬 Communication
- **Text Messages** — Full natural language processing with tool orchestration
- **Voice Messages** — Speech-to-text (Groq Whisper) + text-to-speech (Edge TTS) pipeline
- **Photo/Vision** — OCR (Tesseract.js + OCR.space) + image analysis with GPT-4o
- **Emoji Reactions** — Reinforcement learning via emoji feedback (👍 positive, 👎 negative, etc.)

### 🔧 Tool Ecosystem (40+ tools)
- **Trello Integration** — Full CRUD for boards, lists, cards, labels, checklists
- **Google Calendar** — Create/list/delete events, check availability, sync with reminders
- **Reminders** — Smart scheduling with relative time parsing (+5 min, amanhã)
- **Finance (CFO)** — 19 financial tools: income/expenses, budgets, goals, reports, charts
- **Web Search** — Tavily API integration for real-time web search
- **Browser** — URL navigation with text extraction and screenshots (Playwright)
- **Supabase Query** — Direct database queries from natural language
- **Encrypted Secrets** — AES-256 encrypted API key storage
- **Core Memory** — Long-term semantic memory (save/search)
- **Live Canvas** — Real-time HTML/CSS/JS rendering via WebSocket

### 🤖 Multi-Agent System
- **Code Agent** — Programming specialist with Puter → Modal → OpenRouter fallback
- **Finance Agent** — CFO specialist for complex financial planning
- **Project Agent** — Detects blockers and proactively searches for solutions
- **Agent-to-Agent Sessions** — Inter-agent communication framework

### ⚙️ Automation & Proactive Behavior
- **Morning Briefing** — Daily AI-generated dashboard at 8 AM (Trello, finance, weather)
- **Daily Digest** — Evening summary at 9 PM
- **Curiosity Research** — Autonomous topic research and learning at 2 PM
- **Smart Suggestions** — Pattern-based proactive recommendations
- **Dynamic Routines** — User-defined cron-based automated tasks via natural language
- **Dynamic Triggers** — AI-evolved context-aware triggers (topic_silence, time_based, custom_llm)
- **Judgment System** — Daily/weekly AI-generated internal opinions about user behavior

### 🔒 Security
- **User Whitelist** — Only allowed Telegram user IDs can interact
- **Code Sandbox** — Git-based self-modification with approve/reject buttons
- **Encrypted Secrets** — AES-256-GCM for sensitive data
- **File Blacklist** — config.ts, security.ts, secrets.ts, .env are non-modifiable

---

## 🏗 Architecture

```
┌──────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Telegram   │────▶│     Bot Handler       │────▶│   Agent Loop    │
│   (grammY)   │◀────│  (text/voice/photo)   │◀────│  (max 10 iter)  │
└──────────────┘     └──────────────────────┘     └────────┬────────┘
                                                           │
                     ┌─────────────────────────────────────┤
                     │                                     │
              ┌──────▼──────┐                    ┌────────▼────────┐
              │  LLM Layer  │                    │  Tool Registry  │
              │ OpenRouter   │                    │   (40+ tools)   │
              │ Groq/Ollama │                    │ Trello,Calendar │
              └─────────────┘                    │ Finance,Search  │
                                                 │ Memory,Code... │
                                                 └────────┬────────┘
                     ┌─────────────────────────────────────┤
                     │                                     │
              ┌──────▼──────┐                    ┌────────▼────────┐
              │   Supabase  │                    │  Sub-Agents     │
              │  (Cloud DB) │                    │ Code,Finance    │
              │  or SQLite  │                    │ Project         │
              └─────────────┘                    └─────────────────┘
                     │
              ┌──────▼────────────────────────────────────────┐
              │          Proactive Engine + Scheduler          │
              │  Morning Briefing │ Digest │ Triggers │ Cron  │
              └───────────────────────────────────────────────┘
```

### Request Flow

1. **Message arrives** → `bot.ts` (text/voice/photo handler)
2. **Voice?** → Groq Whisper STT → transcript → text flow
3. **Photo?** → Tesseract.js OCR → extracted text → text flow
4. **Agent Loop** → `agent.ts` → system prompt with facts/skills/feedback/judgments
5. **LLM Call** → `llm.ts` → OpenRouter (primary) → Groq/Ollama (fallback)
6. **Tool Calls?** → Execute tools → return results → loop (up to 10 times)
7. **Final Response** → Save to memory → Send to Telegram (text + optional media)

---

## 📁 Project Structure

```
gravity-claw/
├── src/
│   ├── index.ts              # Entry point — registers all tools, starts bot
│   ├── bot.ts                # Telegram bot handlers (text, voice, photo, reactions)
│   ├── agent.ts              # Core agent loop (10-iteration tool-calling)
│   ├── llm.ts                # Multi-provider LLM (OpenRouter, Groq, Ollama)
│   ├── config.ts             # Environment variable loading & validation
│   │
│   ├── # ── Memory & Database ──
│   ├── db-provider.ts        # Database abstraction layer (auto-selects backend)
│   ├── db-adapter.ts         # Adapter interface for memory providers
│   ├── supabase-db.ts        # Supabase cloud memory provider
│   ├── memory.ts             # SQLite local memory provider
│   ├── memory-advanced.ts    # Advanced memory features
│   │
│   ├── # ── Agents ──
│   ├── code-agent.ts         # Code specialist sub-agent (Puter → Modal → OpenRouter)
│   ├── finance-agent.ts      # Finance specialist sub-agent (CFO)
│   ├── project-agent.ts      # Blocker detection + solution research agent
│   ├── porter-agent.ts       # Porteiro agent (security/routing)
│   │
│   ├── # ── Proactive Intelligence ──
│   ├── proactive-engine.ts   # Morning briefing, curiosity, digest, suggestions
│   ├── proactive-triggers.ts # Trigger evaluation engine
│   ├── trigger-manager.ts    # Dynamic AI-evolved triggers (DB-backed)
│   ├── scheduler.ts          # Cron job scheduler for all proactive tasks
│   ├── routine-manager.ts    # User-defined automated routines
│   ├── recommendations.ts    # Smart behavior-based recommendations
│   ├── judgment.ts           # Daily/weekly AI judgment generation
│   │
│   ├── # ── Integrations ──
│   ├── google-calendar.ts    # Google Calendar API v3 (zero-dependency)
│   ├── trello-sync.ts        # Trello board sync and caching
│   ├── vision.ts             # OCR/Vision (Tesseract.js + OCR.space + GPT-4o)
│   ├── voice.ts              # TTS (Edge TTS + ElevenLabs fallback)
│   ├── code-sandbox.ts       # Git-based self-modification layer
│   ├── ollama.ts             # Ollama local LLM fallback
│   │
│   ├── # ── Utils ──
│   ├── platform.ts           # Platform detection (Linux, Android, Win, Mac)
│   ├── security.ts           # User whitelist validation
│   ├── secrets.ts            # AES-256-GCM encrypted secret storage
│   ├── skills.ts             # Skill loading from markdown files
│   ├── llm-utils.ts          # Puter AI bridge utilities
│   ├── telegram-utils.ts     # Telegram message sending helpers
│   ├── satc.ts               # Self-Awareness & Theory of Cognition module
│   ├── rag-provider.ts       # RAG (Retrieval-Augmented Generation) provider
│   │
│   ├── tools/                # Tool implementations (12 files)
│   │   ├── registry.ts       # Central tool registry with fuzzy matching
│   │   ├── calendar-tool.ts  # Google Calendar tools (5 tools)
│   │   ├── reminder-tool.ts  # Reminder tools (3 tools)
│   │   ├── trello.ts         # Trello tools (12+ tools)
│   │   ├── core-memory.ts    # Core memory tools (save/search)
│   │   ├── supabase-tool.ts  # Direct Supabase query tool
│   │   ├── web-search.ts     # Web search (Tavily)
│   │   ├── browser-tool.ts   # URL browsing (Playwright)
│   │   ├── secrets.ts        # Encrypted secrets management tools
│   │   ├── recommendations.ts# Smart recommendation tools
│   │   ├── get-current-time.ts# Current time/date tool
│   │   └── mcp-bridge.ts     # MCP protocol bridge
│   │
│   ├── finance/              # Finance module (CFO)
│   │   ├── finance-tools.ts  # 19 financial tools
│   │   ├── finance-db.ts     # Finance database operations
│   │   ├── finance-calculator.ts # Financial calculations
│   │   ├── finance-formatter.ts # Report/chart formatting
│   │   └── finance-charts.ts # Chart generation
│   │
│   ├── canvas/               # Live Canvas (real-time HTML rendering)
│   │   ├── server.ts         # WebSocket server
│   │   ├── renderer.ts       # HTML/CSS/JS renderer
│   │   └── tool.ts           # push_to_canvas tool
│   │
│   ├── sessions/             # Agent-to-Agent sessions
│   │   ├── manager.ts        # Session lifecycle management
│   │   └── tools.ts          # Session management tools
│   │
│   ├── skills/               # Internal skills
│   │   └── llm-tracker/      # LLM usage tracking skill
│   │
│   ├── utils/                # Utility modules
│   │   ├── network.ts        # Retry logic for network requests
│   │   ├── typing-indicator.ts # Telegram typing indicator manager
│   │   └── validation.ts     # Input validation utilities
│   │
│   └── types/                # TypeScript type definitions
│
├── skills/                   # Skill definitions (markdown)
│   ├── answeroverflow.md     # AnswerOverflow skill
│   ├── moltguard.md          # MoltGuard security skill
│   ├── self-improvement.md   # Self-improvement skill
│   ├── skill-vetter.md       # Skill quality evaluation
│   └── trello.md             # Trello management skill
│
├── scripts/                  # Utility scripts
│   ├── install-linux.sh      # Linux/Android installation script
│   ├── startup.ps1           # Windows startup script
│   ├── migrate-to-supabase.ts# SQLite → Supabase migration
│   ├── check-supabase.ts     # Supabase connection diagnostic
│   ├── check-db.ts           # Database health check
│   ├── fix-reminders.ts      # Reminder data repair
│   ├── migrate-reminders.ts  # Reminder migration utility
│   ├── puter-auth.ts         # Puter authentication setup
│   └── postinstall.js        # Post-installation setup
│
├── migrations/               # SQL migrations (Supabase)
│   ├── 20260221_create_reminders.sql
│   ├── 20260224_add_updated_at_to_reminders.sql
│   ├── 20260224_create_rag_and_mental_states.sql
│   ├── 20260224_fix_reminders_status_constraint.sql
│   └── 20260225_create_automation_status.sql
│
├── live-canvas.html          # Live Canvas web UI
├── package.json
├── tsconfig.json
├── .env.example              # Environment variable template
├── ANDROID.md                # Android/Termux setup guide
└── README.md                 # This file
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18.0.0
- **npm** (comes with Node.js)
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- An **OpenRouter API Key** from [openrouter.ai](https://openrouter.ai)
- A **Groq API Key** from [console.groq.com](https://console.groq.com)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/rfammon/gravity-claw.git
cd gravity-claw

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys (see Environment Variables section)

# 4. Start the bot
npm run dev          # Development mode (hot reload with tsx)
npm run start        # Production mode
npm run start:android # Low-resource mode (Android/Termux)
```

### Linux/Android Quick Install

```bash
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh
```

---

## 🔐 Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `OPENROUTER_API_KEY` | Primary LLM API key ([openrouter.ai](https://openrouter.ai)) |
| `GROQ_API_KEY` | Voice STT API key ([console.groq.com](https://console.groq.com)) |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs allowed to interact |

### Cloud Database (Supabase)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (admin access) |

### Google Calendar

| Variable | Description |
|----------|-------------|
| `GOOGLE_CALENDAR_TOKEN` | OAuth2 access token |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Refresh token for auto-renewal |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_CALENDAR_ID` | Calendar ID (default: `primary`) |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `TRELLO_API_KEY` | Trello API key |
| `TRELLO_API_SECRET` | Trello API secret |
| `TRELLO_TOKEN` | Trello auth token |
| `TRELLO_BOARD_ID` | Default Trello board ID |
| `TAVILY_API_KEY` | Web search (Tavily) API key |
| `OCR_SPACE_API_KEY` | OCR.space API for image text extraction |
| `MODAL_BASE_URL` | Modal API endpoint (code agent) |
| `MODAL_API_KEY` | Modal API key |
| `PUTER_DEFAULT_MODEL` | Puter AI model (default: `moonshotai/kimi-k2.5`) |
| `PUTER_TOKEN` | Puter auth token |
| `OLLAMA_BASE_URL` | Ollama local LLM URL (default: `http://localhost:11434`) |
| `OLLAMA_API_KEY` | Ollama API key |
| `MASTER_KEY` | AES-256 encryption master key (auto-generated if empty) |

### Performance

| Variable | Description |
|----------|-------------|
| `LOW_RESOURCE_MODE` | Enable for devices with < 2GB RAM (`true`/`false`) |
| `MAX_CONCURRENT_TOOLS` | Maximum parallel tool executions (default: `4`) |

---

## 🔧 Tool Reference

### Communication Tools
| Tool | Description |
|------|-------------|
| `send_voice_message` | Send TTS audio message to the user |
| `push_to_canvas` | Push HTML/CSS/JS to Live Canvas WebSocket |

### Trello Tools
| Tool | Description |
|------|-------------|
| `trello_list_tasks` | List all tasks/cards from Trello |
| `trello_create_card` | Create a new card |
| `trello_move_card` | Move card between lists |
| `trello_update_card` | Update card details |
| `trello_delete_card` | Delete a card |
| `trello_search_cards` | Search across cards |
| `trello_add_label` | Add label to card |
| `trello_add_checklist` | Add checklist to card |
| `trello_add_comment` | Add comment to card |
| `trello_list_boards` | List all boards |
| `trello_list_labels` | List available labels |
| `trello_card_details` | Get full card details |

### Google Calendar Tools
| Tool | Description |
|------|-------------|
| `calendar_events` | List events (today, tomorrow, this-week, custom range) |
| `calendar_create` | Create event (supports +5min, amanhã, ISO 8601) |
| `calendar_delete` | Delete event by ID |
| `calendar_busy` | Check availability / free slots |
| `calendar_sync_reminder` | Sync a reminder to Google Calendar |

### Reminder Tools
| Tool | Description |
|------|-------------|
| `create_reminder` | Schedule a reminder (+N min/hours/days or ISO date) |
| `list_reminders` | List pending reminders |
| `cancel_reminder` | Cancel a reminder by ID |

### Finance Tools (19 tools)
| Tool | Description |
|------|-------------|
| `finance_add_income` | Record income |
| `finance_add_expense` | Record expense |
| `finance_list_transactions` | List transactions with filters |
| `finance_balance` | Get current balance |
| `finance_summary` | Monthly/weekly financial summary |
| `finance_create_budget` | Create a budget category |
| `finance_check_budgets` | Check budget status |
| `finance_create_goal` | Create a financial goal |
| `finance_check_goals` | Check goal progress |
| `finance_report` | Generate detailed financial report |
| `finance_chart` | Generate visual financial charts |
| `delegate_to_finance_agent` | Delegate complex finance tasks |
| ... | *and more* |

### Memory & Intelligence Tools
| Tool | Description |
|------|-------------|
| `save_core_memory` | Save important information to long-term memory |
| `search_core_memory` | Search long-term memories |
| `supabase_query` | Execute direct database queries |
| `get_current_time` | Get current date/time with timezone |

### Search & Browse Tools
| Tool | Description |
|------|-------------|
| `web_search` | Search the web (Tavily) |
| `browse_url` | Navigate URL and extract text or screenshot |

### Code & Automation Tools
| Tool | Description |
|------|-------------|
| `delegate_to_code_agent` | Delegate programming tasks to code specialist |
| `read_project_file` | Read a project source file |
| `propose_code_change` | Propose code modification (git branch + approval) |
| `list_code_proposals` | List pending code proposals |
| `create_routine` | Create automated routine (cron + AI action) |
| `list_routines` | List all routines |
| `pause_routine` / `resume_routine` / `delete_routine` | Manage routines |

### Security Tools
| Tool | Description |
|------|-------------|
| `store_secret` | Encrypt and store an API key |
| `get_secret` | Retrieve a decrypted secret |
| `list_secrets` | List stored secret names |
| `delete_secret` | Delete a stored secret |

### Recommendation Tools
| Tool | Description |
|------|-------------|
| `get_recommendations` | Get AI-generated behavior-based suggestions |

---

## 🧠 LLM Providers & Fallback Chain

### Primary Chat (Agent Loop)

```
OpenRouter (google/gemini-2.5-flash)
  └─▶ Ollama (llama3.2:3b) [if OpenRouter fails]
```

### Code Agent

```
Puter AI (moonshotai/kimi-k2.5)
  └─▶ Modal (GLM-5-FP8) [if Puter fails]
       └─▶ OpenRouter (qwen-2.5-72b-instruct) [if Modal fails]
```

### Lightweight Tasks (Digests, Routines)

```
Groq (llama-3.3-70b-versatile)
  └─▶ OpenRouter (gemini-2.5-flash) [fallback]
```

### Voice (STT)

```
Groq Whisper (whisper-large-v3-turbo)
```

### Voice (TTS)

```
Edge TTS (pt-BR-AntonioNeural)
  └─▶ ElevenLabs [if configured]
```

---

## 🤖 Proactive Intelligence

The bot has a complete proactive intelligence system that runs autonomously:

| Routine | Schedule | Description |
|---------|----------|-------------|
| **Morning Briefing** | 8:00 AM BRT | Trello tasks, finance snapshot, weather, motivational message |
| **Curiosity Research** | 2:00 PM BRT | Autonomous topic research based on recent conversations |
| **Daily Digest** | 9:00 PM BRT | Day summary, pending tasks, recommendations |
| **Smart Suggestions** | Every 4h | Pattern-based proactive suggestions |
| **Due Routines** | Every 15min | Execute user-defined automated routines |
| **Dynamic Triggers** | Every 1h | AI-evolved contextual triggers (e.g., "haven't studied in 24h") |
| **Trigger Evolution** | Weekly | AI re-evaluates and evolves trigger rules |
| **Reminder Check** | Every 1min | Check and fire due reminders |

### Dynamic Triggers

Triggers are AI-managed and evolve over time:

- **topic_silence** — Fires when a topic hasn't been discussed for N hours
- **time_based** — Fires at specific times/conditions
- **custom_llm** — LLM evaluates custom conditions each cycle

The AI periodically reviews trigger effectiveness and can create, modify, or archive triggers autonomously.

---

## 💾 Database Schema (Supabase)

### Core Tables

| Table | Purpose |
|-------|---------|
| `chat_messages` | Full chat history (role, content, metadata) |
| `user_facts` | Key-value facts per user (persistent knowledge) |
| `core_memories` | Long-term semantic memories |
| `reminders` | Scheduled reminders with status tracking |
| `interaction_log` | Analytics: topics, tools used, emotional state |
| `bot_messages` | Bot message tracking (for reaction feedback) |
| `user_feedback` | Emoji reaction feedback signals |
| `user_judgments` | AI-generated daily/weekly opinions about user |

### Finance Tables

| Table | Purpose |
|-------|---------|
| `finance_transactions` | Income and expense records |
| `finance_budgets` | Budget categories and limits |
| `finance_goals` | Savings goals and progress |
| `finance_recurring` | Recurring transactions |

### Automation Tables

| Table | Purpose |
|-------|---------|
| `automation_status` | Status tracking for automated tasks |
| `rag_documents` | RAG document store |
| `mental_states` | Bot mental state snapshots |

### Local SQLite Databases

| File | Purpose |
|------|---------|
| `~/.gravity_claw/proactive_engine.sqlite` | Proactive routine cooldowns |
| `~/.gravity_claw/routines.sqlite` | User-defined automated routines |
| `~/.gravity_claw/triggers.sqlite` | Dynamic trigger definitions |
| `~/.gravity_claw/proposals.sqlite` | Code change proposals |
| `~/.gravity_claw/secrets.db` | Encrypted secret storage |

---

## 🔒 Self-Modification (Code Sandbox)

The bot can modify its own code safely through a git-based workflow:

1. **Code Agent** writes the modification
2. **Code Sandbox** creates a new git branch
3. **Diff is sent** to the user via Telegram with Approve ✅ / Reject ❌ buttons
4. **If approved:** branch is merged, bot restarts automatically
5. **If rejected:** branch is deleted

**Safety rails:**
- Only files in `src/` can be modified
- `config.ts`, `security.ts`, `secrets.ts`, `.env` are blacklisted
- Max 5 files per proposal, 50KB per file
- Full git history preserved for rollback

---

## 📅 Google Calendar Integration

### Setup

1. Create credentials in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the Google Calendar API
3. Create OAuth2 credentials (Desktop App)
4. Use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) to get tokens:
   - Scope: `https://www.googleapis.com/auth/calendar`
   - Use your own OAuth credentials (⚙️ settings)
   - Exchange authorization code for refresh + access tokens
5. Add tokens to `.env` (see Environment Variables section)

### Features

- **Auto-refresh:** Access tokens are automatically renewed using the refresh token
- **Flexible dates:** Supports ISO 8601, relative time (+5 minutes), and natural language (amanhã)
- **Reminder sync:** Reminders automatically create Google Calendar events
- **Availability check:** Free/busy slots analysis for scheduling

---

## 🚢 Deployment

### Linux Server (Recommended)

```bash
# Install (first time)
git clone https://github.com/rfammon/gravity-claw.git
cd gravity-claw
npm install
cp .env.example .env
# Edit .env with your keys

# Run with PM2 (persistent)
npm install -g pm2
pm2 start "npm run start" --name megamind
pm2 save
pm2 startup
```

### Android (Termux)

See [ANDROID.md](ANDROID.md) for detailed Termux setup instructions.

```bash
npm run start:android  # Enables LOW_RESOURCE_MODE
```

### Windows

```powershell
# Development
npm run dev

# Production
npm run start
```

### Update Workflow

```bash
git pull origin android-linux
npm run build  # or just restart if using tsx
pm2 restart megamind
```

---

## 🛠 Scripts & Utilities

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Development with hot reload (tsx watch) |
| `start` | `npm run start` | Production start (tsx) |
| `start:android` | `npm run start:android` | Low-resource mode |
| `check` | `npm run check` | TypeScript type checking |
| `install:linux` | `npm run install:linux` | Linux/Android setup script |

### Diagnostic Scripts

```bash
npx tsx scripts/check-supabase.ts  # Test Supabase connection
npx tsx scripts/check-db.ts        # Database health check
npx tsx scripts/puter-auth.ts      # Generate Puter auth token
```

### Migration Scripts

```bash
npx tsx scripts/migrate-to-supabase.ts  # SQLite → Supabase
npx tsx scripts/migrate-reminders.ts     # Reminder data migration
npx tsx scripts/fix-reminders.ts         # Repair reminder data
```

---

## 📚 Skills System

Skills are markdown-defined behavioral modules loaded at startup from `skills/`:

| Skill | Description |
|-------|-------------|
| **AnswerOverflow** | Smart question answering patterns |
| **MoltGuard** | Security and moderation |
| **Self-Improvement** | Autonomous capability enhancement |
| **Skill Vetter** | Quality evaluation for new skills |
| **Trello** | Enhanced Trello management patterns |

Skills are injected into the system prompt and guide the agent's behavior for specialized tasks.

---

## 📄 License

Private project. All rights reserved.

---

<p align="center">
  <i>Built with 🧠 by Rafael, powered by Megamind's genius</i>
</p>
