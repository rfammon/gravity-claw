/**
 * LLM Router — Multi-Provider Intelligent Routing
 *
 * Routes LLM requests across free-tier providers with:
 *   1. Priority-based fallback chain (Google AI Studio → Groq → Cerebras → OpenRouter → Modal → Mistral)
 *   2. Automatic 429 detection and provider demotion
 *   3. SQLite response cache (hash-based dedup)
 *   4. Per-provider health tracking and stats
 *   5. Local Qwen 3.5 0.8B via Ollama for light tasks (zero API cost)
 *
 * Free-tier providers:
 *   - Google AI Studio: Gemini 2.5 Flash — 30 RPM, 1M context
 *   - Groq: Llama 3.3 70B — 14,400 req/day, 300+ tok/s
 *   - Cerebras: Llama 3.3 70B — 1M tok/day, 30 RPM
 *   - OpenRouter: 24+ free models — 20 RPM
 *   - Mistral: Experiment plan — 1B tok/month
 * Local:
 *   - Qwen 3.5 0.8B via Ollama — ~500MB RAM, 262K context, zero cost
 */

import OpenAI from "openai";
import Groq from "groq-sdk";
import Database from "better-sqlite3";
import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { config } from "./config.js";
import { withRetry } from "./utils/network.js";

// ── Types ────────────────────────────────────────────────────────────
export interface ProviderConfig {
    name: string;
    model: string;
    client: OpenAI | Groq;
    isGroq?: boolean;
    isOllamaLocal?: boolean; // Uses local Ollama (may not be running)
    maxContextMessages?: number; // Trim history for providers with small context
    enabled: boolean;
}

interface ProviderHealth {
    failures: number;
    lastFailure: number;
    lastSuccess: number;
    totalCalls: number;
    totalLatencyMs: number;
}

interface CacheEntry {
    response: string;
    provider: string;
    created_at: string;
}

// ── Constants ────────────────────────────────────────────────────────
const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after 3+ failures
const MAX_FAILURES_BEFORE_SKIP = 3;
const CACHE_TTL_HOURS = 24;
const OLLAMA_TIMEOUT_MS = 15_000; // 15s timeout for local Ollama (fail fast → cloud)

// ── Cache Database ───────────────────────────────────────────────────
let cacheDb: Database.Database | null = null;

function getCacheDb(): Database.Database {
    if (!cacheDb) {
        cacheDb = new Database(path.join(GRAVITY_DIR, "llm_cache.sqlite"));
        cacheDb.exec(`
            CREATE TABLE IF NOT EXISTS llm_cache (
                hash TEXT PRIMARY KEY,
                response TEXT NOT NULL,
                provider TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_cache_created ON llm_cache(created_at);
        `);
        // Cleanup old entries on init
        cacheDb.exec(`DELETE FROM llm_cache WHERE created_at < datetime('now', '-${CACHE_TTL_HOURS} hours')`);
        console.log("💾 LLM Cache database ready");
    }
    return cacheDb;
}

// ── Provider Clients ─────────────────────────────────────────────────

function buildProviders(): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    // 1. Google AI Studio (Gemini 2.5 Flash) — best free option, huge context
    if (config.googleAiStudioKey) {
        providers.push({
            name: "Google AI Studio",
            model: "gemini-2.5-flash",
            client: new OpenAI({
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
                apiKey: config.googleAiStudioKey,
            }),
            enabled: true,
        });
    }

    // 2. Groq — ultra-low latency (300+ tok/s)
    if (config.groqApiKey) {
        providers.push({
            name: "Groq",
            model: "llama-3.3-70b-versatile",
            client: new Groq({ apiKey: config.groqApiKey }) as any,
            isGroq: true,
            maxContextMessages: 20, // Groq has lower TPM limits
            enabled: true,
        });
    }

    // 3. Cerebras — 1M tokens/day, 30 RPM
    if (config.cerebrasApiKey) {
        providers.push({
            name: "Cerebras",
            model: "llama-3.3-70b",
            client: new OpenAI({
                baseURL: "https://api.cerebras.ai/v1",
                apiKey: config.cerebrasApiKey,
            }),
            enabled: true,
        });
    }

    // 4. OpenRouter — 24+ free models
    if (config.openRouterKey) {
        providers.push({
            name: "OpenRouter",
            model: "deepseek/deepseek-chat:free",
            client: new OpenAI({
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: config.openRouterKey,
                defaultHeaders: {
                    "HTTP-Referer": "https://github.com/gravity-claw",
                    "X-Title": "Gravity Claw",
                },
            }),
            enabled: true,
        });
    }

    // 5. Modal (paid fallback — before last resort)
    if (config.modalApiKey && config.modalBaseUrl) {
        providers.push({
            name: "Modal",
            model: "zai-org/GLM-5-FP8",
            client: new OpenAI({
                baseURL: config.modalBaseUrl,
                apiKey: config.modalApiKey,
            }),
            enabled: true,
        });
    }

    // 6. Mistral — 1B tokens/month (Experiment plan)
    if (config.mistralApiKey) {
        providers.push({
            name: "Mistral",
            model: "mistral-small-latest",
            client: new OpenAI({
                baseURL: "https://api.mistral.ai/v1",
                apiKey: config.mistralApiKey,
            }),
            enabled: true,
        });
    }

    // 7. Qwen 3.5 2B via local Ollama — ULTIMATE fallback (zero cost, tool calling capable)
    // If all cloud providers fail, the bot can still respond locally (degraded but functional).
    {
        const ollamaBase = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
        const baseURL = ollamaBase.endsWith('/v1') ? ollamaBase : `${ollamaBase}/v1`;
        providers.push({
            name: "Ollama Qwen3.5-2B (Local)",
            model: "qwen3.5:2b",
            client: new OpenAI({
                baseURL,
                apiKey: config.ollamaApiKey || "ollama",
                timeout: OLLAMA_TIMEOUT_MS,
            }),
            isOllamaLocal: true,
            maxContextMessages: 30,
            enabled: true,
        });
    }

    return providers;
}

// Light providers — smaller/faster models for background tasks
function buildLightProviders(): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    // 0. Qwen 3.5 0.8B via local Ollama — FIRST priority (zero cost, no rate limits)
    // Uses Ollama's OpenAI-compatible endpoint. Skipped gracefully if Ollama isn't running.
    {
        const ollamaBase = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
        // Build the OpenAI-compatible URL for local Ollama
        const baseURL = ollamaBase.endsWith('/v1') ? ollamaBase : `${ollamaBase}/v1`;
        providers.push({
            name: "Ollama Qwen3.5 (Local)",
            model: "qwen3.5:0.8b",
            client: new OpenAI({
                baseURL,
                apiKey: config.ollamaApiKey || "ollama", // Ollama local doesn't need auth
            }),
            isOllamaLocal: true,
            maxContextMessages: 30, // 262K context but keep lean for speed
            enabled: true,
        });
    }

    if (config.groqApiKey) {
        providers.push({
            name: "Groq (Light)",
            model: "llama-3.1-8b-instant",
            client: new Groq({ apiKey: config.groqApiKey }) as any,
            isGroq: true,
            maxContextMessages: 10,
            enabled: true,
        });
    }

    if (config.cerebrasApiKey) {
        providers.push({
            name: "Cerebras (Light)",
            model: "llama-3.1-8b",
            client: new OpenAI({
                baseURL: "https://api.cerebras.ai/v1",
                apiKey: config.cerebrasApiKey,
            }),
            enabled: true,
        });
    }

    if (config.googleAiStudioKey) {
        providers.push({
            name: "Google AI Studio (Light)",
            model: "gemini-2.0-flash-lite",
            client: new OpenAI({
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
                apiKey: config.googleAiStudioKey,
            }),
            enabled: true,
        });
    }

    if (config.openRouterKey) {
        providers.push({
            name: "OpenRouter (Light)",
            model: "meta-llama/llama-3.1-8b-instruct:free",
            client: new OpenAI({
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: config.openRouterKey,
                defaultHeaders: {
                    "HTTP-Referer": "https://github.com/gravity-claw",
                    "X-Title": "Gravity Claw",
                },
            }),
            enabled: true,
        });
    }

    return providers;
}

// ── Health Tracking ──────────────────────────────────────────────────
const healthMap = new Map<string, ProviderHealth>();

function getHealth(name: string): ProviderHealth {
    if (!healthMap.has(name)) {
        healthMap.set(name, {
            failures: 0,
            lastFailure: 0,
            lastSuccess: 0,
            totalCalls: 0,
            totalLatencyMs: 0,
        });
    }
    return healthMap.get(name)!;
}

function recordSuccess(name: string, latencyMs: number): void {
    const h = getHealth(name);
    h.failures = 0;
    h.lastSuccess = Date.now();
    h.totalCalls++;
    h.totalLatencyMs += latencyMs;
}

function recordFailure(name: string): void {
    const h = getHealth(name);
    h.failures++;
    h.lastFailure = Date.now();
    h.totalCalls++;
}

function isProviderHealthy(name: string): boolean {
    const h = getHealth(name);
    if (h.failures < MAX_FAILURES_BEFORE_SKIP) return true;
    // Allow retry after cooldown
    return Date.now() - h.lastFailure > FAILURE_COOLDOWN_MS;
}

// ── Cache ────────────────────────────────────────────────────────────
function hashMessages(messages: any[]): string {
    // Hash only user/system messages (skip assistant/tool for cacheability)
    const relevant = messages
        .filter((m: any) => m.role === "user" || m.role === "system")
        .map((m: any) => `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
    return crypto.createHash("sha256").update(relevant.join("|")).digest("hex").substring(0, 32);
}

function getCached(hash: string): CacheEntry | null {
    if (!config.llmCacheEnabled) return null;
    try {
        const db = getCacheDb();
        const row = db.prepare(
            `SELECT response, provider, created_at FROM llm_cache WHERE hash = ? AND created_at > datetime('now', '-${CACHE_TTL_HOURS} hours')`
        ).get(hash) as CacheEntry | undefined;
        return row || null;
    } catch {
        return null;
    }
}

function setCache(hash: string, response: string, provider: string): void {
    if (!config.llmCacheEnabled) return;
    try {
        const db = getCacheDb();
        db.prepare(
            "INSERT OR REPLACE INTO llm_cache (hash, response, provider, created_at) VALUES (?, ?, ?, datetime('now'))"
        ).run(hash, response, provider);
    } catch (err) {
        console.warn("⚠️ Cache write failed:", err);
    }
}

// ── Core Router ──────────────────────────────────────────────────────

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

let mainProviders: ProviderConfig[] | null = null;
let lightProviders: ProviderConfig[] | null = null;

function getMainProviders(): ProviderConfig[] {
    if (!mainProviders) mainProviders = buildProviders();
    return mainProviders;
}

function getLightProviders(): ProviderConfig[] {
    if (!lightProviders) lightProviders = buildLightProviders();
    return lightProviders;
}

/**
 * Route a chat completion request through the provider chain.
 * Falls back automatically on 429/5xx errors.
 */
export async function routeChat(
    messages: Message[],
    options: {
        tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
        maxTokens?: number;
        light?: boolean; // Use light providers for background tasks
        skipCache?: boolean; // Some requests (tool calls) shouldn't be cached
    } = {}
): Promise<OpenAI.Chat.Completions.ChatCompletion | any> {
    const { tools, maxTokens = 4096, light = false, skipCache = false } = options;
    const providers = light ? getLightProviders() : getMainProviders();

    if (providers.length === 0) {
        throw new Error("❌ No LLM providers configured. Set at least one API key in .env");
    }

    // Check cache (only for non-tool, non-light requests without tool responses)
    const hasToolMessages = messages.some((m: any) => m.role === "tool");
    if (!skipCache && !hasToolMessages && !tools) {
        const hash = hashMessages(messages);
        const cached = getCached(hash);
        if (cached) {
            console.log(`💾 [Cache HIT] Provider: ${cached.provider} (saved API call)`);
            // Reconstruct a minimal ChatCompletion-like response
            return {
                choices: [{
                    message: {
                        role: "assistant" as const,
                        content: cached.response,
                    },
                    finish_reason: "stop",
                    index: 0,
                }],
                model: "cache",
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
        }
    }

    // Try each provider in order
    const errors: string[] = [];

    for (const provider of providers) {
        if (!provider.enabled) continue;
        if (!isProviderHealthy(provider.name)) {
            console.log(`⏳ [Router] Skipping ${provider.name} (cooldown after failures)`);
            continue;
        }

        try {
            // Prepare messages (trim for providers with context limits)
            let msgs = messages;
            if (provider.maxContextMessages && messages.length > provider.maxContextMessages) {
                // Keep system message + last N messages
                const systemMsgs = messages.filter((m: any) => m.role === "system");
                const nonSystem = messages.filter((m: any) => m.role !== "system");
                msgs = [...systemMsgs, ...nonSystem.slice(-provider.maxContextMessages)];
            }

            const startTime = Date.now();
            console.log(`🤖 [Router] Trying ${provider.name} [${provider.model}]...`);

            const callArgs: any = {
                model: provider.model,
                max_tokens: maxTokens,
                messages: msgs,
            };

            // Only pass tools if the provider supports them and tools are provided
            if (tools && tools.length > 0) {
                callArgs.tools = tools;
            }

            let response: any;
            if (provider.isOllamaLocal) {
                // Race against timeout for local providers (fail fast → cloud)
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Ollama timeout (${OLLAMA_TIMEOUT_MS}ms)`)), OLLAMA_TIMEOUT_MS)
                );
                const apiCall = (provider.client as OpenAI).chat.completions.create(callArgs);
                response = await Promise.race([apiCall, timeoutPromise]);
            } else if (provider.isGroq) {
                response = await (provider.client as Groq).chat.completions.create(callArgs);
            } else {
                response = await (provider.client as OpenAI).chat.completions.create(callArgs);
            }

            const latency = Date.now() - startTime;
            recordSuccess(provider.name, latency);
            console.log(`✅ [Router] ${provider.name} responded in ${latency}ms`);

            // Cache the response (if text-only, no tool calls)
            const content = response.choices?.[0]?.message?.content;
            const hasToolCalls = response.choices?.[0]?.message?.tool_calls?.length > 0;
            if (content && !hasToolCalls && !skipCache && !hasToolMessages) {
                const hash = hashMessages(messages);
                setCache(hash, content, provider.name);
            }

            return response;
        } catch (error: any) {
            const status = error?.status || error?.response?.status || 0;
            const isRateLimit = status === 429;
            const isServerError = status >= 500;

            recordFailure(provider.name);

            if (isRateLimit) {
                console.warn(`⚠️ [Router] ${provider.name}: Rate limited (429). Trying next provider...`);
            } else if (isServerError) {
                console.warn(`⚠️ [Router] ${provider.name}: Server error (${status}). Trying next provider...`);
            } else {
                console.warn(`⚠️ [Router] ${provider.name} failed: ${error.message || error}`);
            }

            errors.push(`${provider.name}: ${error.message || status}`);
        }
    }

    throw new Error(`❌ All LLM providers failed.\nErrors:\n${errors.map(e => `  - ${e}`).join("\n")}`);
}

// ── Stats ────────────────────────────────────────────────────────────

export function getRouterStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, health] of healthMap.entries()) {
        stats[name] = {
            totalCalls: health.totalCalls,
            failures: health.failures,
            avgLatencyMs: health.totalCalls > 0 ? Math.round(health.totalLatencyMs / health.totalCalls) : 0,
            healthy: isProviderHealthy(name),
        };
    }
    return stats;
}

export function getAvailableProviders(): string[] {
    return getMainProviders()
        .filter(p => p.enabled && isProviderHealthy(p.name))
        .map(p => `${p.name} [${p.model}]`);
}

// ── Init ─────────────────────────────────────────────────────────────
const mainCount = buildProviders().length;
const lightCount = buildLightProviders().length;
console.log(`🔀 LLM Router ready: ${mainCount} main providers, ${lightCount} light providers`);
