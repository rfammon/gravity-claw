/**
 * Database Provider — Abstraction Layer
 *
 * Selects Supabase (cloud) or SQLite (local) based on env vars.
 * All consumers import from here instead of memory.ts directly.
 *
 * If SUPABASE_URL is set → uses Supabase (cloud, device-independent)
 * Otherwise → uses local SQLite (current behavior, zero config)
 */

import { config } from "./config.js";

// ── Shared Types ─────────────────────────────────────────────────────
export type { InteractionLogEntry } from "./memory.js";
import type { InteractionLogEntry } from "./memory.js";
export interface MemoryEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp?: string;
}

export interface IMemoryProvider {
    readonly backend: "sqlite" | "supabase";

    saveMessage(chatId: string, role: string, content: string, metadata?: any): void | Promise<void>;
    getChatHistory(chatId: string, limit?: number): MemoryEntry[] | Promise<MemoryEntry[]>;
    storeFact(chatId: string, key: string, value: string): void | Promise<void>;
    getFacts(chatId: string): Record<string, string> | Promise<Record<string, string>>;
    clearHistory(chatId: string): void | Promise<void>;

    trackBotMessage(chatId: string, messageId: number, responseText: string): void | Promise<void>;
    saveFeedback(chatId: string, messageId: number, signal: string, emoji: string): void | Promise<void>;
    getFeedbackSummary(chatId: string): string | Promise<string>;

    saveJudgment(chatId: string, type: "daily" | "weekly", opinion: string, periodStart: string, periodEnd: string): void | Promise<void>;
    getLatestJudgments(chatId: string): string | Promise<string>;
    getMemoriesSince(chatId: string, sinceDateISO: string): MemoryEntry[] | Promise<MemoryEntry[]>;
    getJudgmentsSince(chatId: string, type: "daily", sinceDateISO: string): { opinion: string; timestamp: string }[] | Promise<{ opinion: string; timestamp: string }[]>;

    saveInteractionLog(chatId: string, entry: InteractionLogEntry): void | Promise<void>;
    getInteractionLogs(chatId: string, limit?: number): (InteractionLogEntry & { timestamp: string })[] | Promise<(InteractionLogEntry & { timestamp: string })[]>;
}

// ── Provider Selection ───────────────────────────────────────────────
let _db: IMemoryProvider;

if (config.supabaseUrl && config.supabaseServiceKey) {
    console.log("☁️  Database: Supabase (cloud mode)");
    const { SupabaseMemory } = await import("./supabase-db.js");
    _db = new SupabaseMemory();
} else {
    console.log("💾 Database: SQLite (local mode)");
    const mem = await import("./memory.js");

    // Wrap sync memory.ts functions into IMemoryProvider
    _db = {
        backend: "sqlite" as const,
        saveMessage: mem.saveMessage,
        getChatHistory: mem.getChatHistory,
        storeFact: mem.storeFact,
        getFacts: mem.getFacts,
        clearHistory: mem.clearHistory,
        trackBotMessage: mem.trackBotMessage,
        saveFeedback: mem.saveFeedback,
        getFeedbackSummary: mem.getFeedbackSummary,

        saveJudgment: mem.saveJudgment,
        getLatestJudgments: mem.getLatestJudgments,
        getMemoriesSince: mem.getMemoriesSince,
        getJudgmentsSince: mem.getJudgmentsSince,

        saveInteractionLog: mem.saveInteractionLog,
        getInteractionLogs: mem.getInteractionLogs,
    };
}

export const db = _db;

// ── Convenience re-exports (same API as before) ──────────────────────
export const saveMessage = db.saveMessage.bind(db);
export const getChatHistory = db.getChatHistory.bind(db);
export const storeFact = db.storeFact.bind(db);
export const getFacts = db.getFacts.bind(db);
export const clearHistory = db.clearHistory.bind(db);
export const trackBotMessage = db.trackBotMessage.bind(db);
export const saveFeedback = db.saveFeedback.bind(db);
export const getFeedbackSummary = db.getFeedbackSummary.bind(db);

export const saveJudgment = db.saveJudgment.bind(db);
export const getLatestJudgments = db.getLatestJudgments.bind(db);
export const getMemoriesSince = db.getMemoriesSince.bind(db);
export const getJudgmentsSince = db.getJudgmentsSince.bind(db);
export const saveInteractionLog = db.saveInteractionLog.bind(db);
export const getInteractionLogs = db.getInteractionLogs.bind(db);
