# 🤖 Gravity Claw

A lean, powerful personal AI agent running on Telegram — built with TypeScript, grammY, and OpenRouter.

## Features

- 🧠 **Intelligent Agent** — Orchestrated by Gemini Flash via OpenRouter with agentic tool loop
- 🎤 **Voice Messages** — STT (Groq Whisper) + TTS (Edge-TTS) for full voice conversations
- 👁️ **Computer Vision** — OCR from photos via OCR Space API + Tesseract.js fallback
- 🔧 **Tool System** — Extensible tool registry with web search, Trello, browser automation, and more
- 🎯 **Reinforcement Learning** — Learns from emoji reactions (👍❤️😡) to improve over time
- 🤖 **Multi-Agent** — Delegates complex coding tasks to a specialized GLM-5 code sub-agent
- 📋 **Trello Integration** — Full CRUD on boards, lists, and cards with anti-hallucination cache
- 🛡️ **Security** — User whitelisting, encrypted secrets, air-gapped mode
- ⏰ **Proactive Behavior** — Morning briefings, evening recaps, scheduled tasks
- 💾 **Persistent Memory** — SQLite-backed chat history, facts, and feedback

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript (tsx) |
| Bot Framework | grammY |
| LLM | Gemini Flash (OpenRouter) |
| Code Agent | GLM-5-FP8 (Modal) |
| STT | Groq Whisper |
| TTS | Edge-TTS (Microsoft) |
| OCR | OCR Space API + Tesseract.js |
| Database | SQLite (better-sqlite3) |
| Process Manager | PM2 |

## Setup

```bash
# Install dependencies
npm install

# Copy and fill environment variables
cp .env.example .env

# Run in development
npm run dev

# Run with PM2 (production)
pm2 start ecosystem.config.cjs
```

## Environment Variables

See `.env.example` for all required and optional keys.

## License

Private — All rights reserved.
