import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { withRetry } from "./utils/network.js";

// Inline types to avoid circular import with db-provider
interface MemoryEntry {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp?: string;
}

// ── Supabase Client ──────────────────────────────────────────────────
let supabase: SupabaseClient;

export function getClient(): SupabaseClient {
    if (!supabase) {
        if (!config.supabaseUrl || !config.supabaseServiceKey) {
            throw new Error("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
        }
        supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        console.log("☁️  Supabase client initialized");
    }
    return supabase;
}

// ── Supabase Memory Provider ─────────────────────────────────────────
export class SupabaseMemory {
    readonly backend = "supabase" as const;

    async saveMessage(chatId: string, role: string, content: string, metadata?: any): Promise<void> {
        await withRetry(async () => {
            const { error } = await getClient()
                .from("memories")
                .insert({
                    chat_id: chatId,
                    role,
                    content,
                    metadata: metadata ?? null,
                });
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error("❌ Supabase saveMessage:", err.message));
    }

    async getChatHistory(chatId: string, limit: number = 50): Promise<MemoryEntry[]> {
        try {
            const { data, error } = await withRetry(async () => {
                const res = await getClient()
                    .from("memories")
                    .select("role, content, created_at")
                    .eq("chat_id", chatId)
                    .order("created_at", { ascending: false })
                    .limit(limit);
                if (res.error) throw res.error;
                return res;
            }, { maxRetries: 2 });

            return (data ?? []).reverse().map((row) => ({
                role: row.role as MemoryEntry["role"],
                content: row.content,
                timestamp: row.created_at,
            }));
        } catch (error: any) {
            console.error("❌ Supabase getChatHistory:", error.message);
            return [];
        }
    }

    async storeFact(chatId: string, key: string, value: string): Promise<void> {
        await withRetry(async () => {
            const { error } = await getClient()
                .from("facts")
                .upsert(
                    { chat_id: chatId, key, value, updated_at: new Date().toISOString() },
                    { onConflict: "chat_id,key" }
                );
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error("❌ Supabase storeFact:", err.message));
    }

    async getFacts(chatId: string): Promise<Record<string, string>> {
        try {
            const { data, error } = await withRetry(async () => {
                const res = await getClient()
                    .from("facts")
                    .select("key, value")
                    .eq("chat_id", chatId);
                if (res.error) throw res.error;
                return res;
            }, { maxRetries: 2 });

            const facts: Record<string, string> = {};
            (data ?? []).forEach((row) => {
                facts[row.key] = row.value;
            });
            return facts;
        } catch (error: any) {
            console.error("❌ Supabase getFacts:", error.message);
            return {};
        }
    }

    async clearHistory(chatId: string): Promise<void> {
        const { error } = await getClient()
            .from("memories")
            .delete()
            .eq("chat_id", chatId);
        if (error) console.error("❌ Supabase clearHistory:", error.message);
    }

    // ── Feedback System ──────────────────────────────────────────────

    async trackBotMessage(chatId: string, messageId: number, responseText: string): Promise<void> {
        const { error } = await getClient()
            .from("bot_messages")
            .upsert(
                {
                    chat_id: chatId,
                    message_id: messageId,
                    response_text: responseText.substring(0, 500),
                },
                { onConflict: "chat_id,message_id" }
            );
        if (error) console.error("❌ Supabase trackBotMessage:", error.message);
    }

    async saveFeedback(chatId: string, messageId: number, signal: string, emoji: string): Promise<void> {
        // Look up what the bot said
        const { data: row } = await getClient()
            .from("bot_messages")
            .select("response_text")
            .eq("chat_id", chatId)
            .eq("message_id", messageId)
            .single();

        const botResponse = row?.response_text ?? "(unknown message)";

        const { error } = await getClient()
            .from("feedback")
            .insert({
                chat_id: chatId,
                message_id: messageId,
                bot_response: botResponse,
                signal,
                emoji,
            });

        if (error) console.error("❌ Supabase saveFeedback:", error.message);
        else console.log(`📊 Feedback saved (Supabase): ${emoji} (${signal}) on message ${messageId}`);
    }

    async getFeedbackSummary(chatId: string): Promise<string> {
        const { data, error } = await getClient()
            .from("feedback")
            .select("bot_response, signal, emoji, created_at")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (error || !data || data.length === 0) return "";

        const loved = data.filter((r) => r.signal === "loved");
        const positive = data.filter((r) => r.signal === "positive");
        const negative = data.filter((r) => r.signal === "negative");

        let summary = "";
        if (loved.length > 0) {
            summary += "\n❤️ RESPONSES THE USER LOVED:\n";
            loved.forEach((r) => (summary += `- "${r.bot_response?.substring(0, 120)}..."\n`));
        }
        if (positive.length > 0) {
            summary += "\n👍 RESPONSES THE USER LIKED:\n";
            positive.forEach((r) => (summary += `- "${r.bot_response?.substring(0, 120)}..."\n`));
        }
        if (negative.length > 0) {
            summary += "\n😡 RESPONSES THE USER DISLIKED:\n";
            negative.forEach((r) => (summary += `- "${r.bot_response?.substring(0, 120)}..."\n`));
        }

        return summary;
    }

    // ── Judgment Memory (Bot's Diary) ────────────────────────

    async saveJudgment(chatId: string, type: "daily" | "weekly", opinion: string, periodStart: string, periodEnd: string): Promise<void> {
        const { error } = await getClient()
            .from("user_judgments")
            .insert({
                chat_id: chatId,
                type,
                opinion,
                period_start: periodStart,
                period_end: periodEnd,
            });

        if (error) console.error("❌ Supabase saveJudgment:", error.message);
        else console.log(`🧠 Judgment saved (Supabase/ ${type}) for ${chatId}`);
    }

    async getLatestJudgments(chatId: string): Promise<string> {
        const { data: weeklyData } = await getClient()
            .from("user_judgments")
            .select("opinion, created_at")
            .eq("chat_id", chatId)
            .eq("type", "weekly")
            .order("created_at", { ascending: false })
            .limit(1);

        const { data: dailyData } = await getClient()
            .from("user_judgments")
            .select("opinion, created_at")
            .eq("chat_id", chatId)
            .eq("type", "daily")
            .order("created_at", { ascending: false })
            .limit(3);

        const latestWeekly = weeklyData?.[0];
        const recentDailies = dailyData ?? [];

        let summary = "";
        if (latestWeekly) {
            summary += `📌 Avaliação Semanal Profunda (${latestWeekly.created_at}):\n${latestWeekly.opinion}\n\n`;
        }

        if (recentDailies.length > 0) {
            summary += `📝 Diários Recentes:\n`;
            recentDailies.forEach(d => summary += `- [${d.created_at}] ${d.opinion}\n`);
        }

        return summary;
    }

    async getMemoriesSince(chatId: string, sinceDateISO: string): Promise<MemoryEntry[]> {
        const { data, error } = await getClient()
            .from("memories")
            .select("role, content, created_at")
            .eq("chat_id", chatId)
            .gte("created_at", sinceDateISO)
            .order("created_at", { ascending: true });

        if (error) {
            console.error("❌ Supabase getMemoriesSince:", error.message);
            return [];
        }

        return (data ?? []).map((row) => ({
            role: row.role as MemoryEntry["role"],
            content: row.content,
            timestamp: row.created_at,
        }));
    }

    async getJudgmentsSince(chatId: string, type: "daily", sinceDateISO: string): Promise<{ opinion: string; timestamp: string }[]> {
        const { data, error } = await getClient()
            .from("user_judgments")
            .select("opinion, created_at")
            .eq("chat_id", chatId)
            .eq("type", type)
            .gte("created_at", sinceDateISO)
            .order("created_at", { ascending: true });

        if (error) {
            console.error("❌ Supabase getJudgmentsSince:", error.message);
            return [];
        }

        return (data ?? []).map((row) => ({
            opinion: row.opinion,
            timestamp: row.created_at,
        }));
    }

    // ── Reminders ──────────────────────────────────────────────

    async addReminder(chatId: string, userId: number, text: string, remindAt: Date, metadata?: any): Promise<void> {
        await withRetry(async () => {
            const { error } = await getClient()
                .from("reminders")
                .insert({
                    chat_id: chatId,
                    user_id: userId,
                    reminder_text: text,
                    remind_at: remindAt.toISOString(),
                    status: "pending",
                    metadata: metadata ?? null,
                });
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error("❌ Supabase addReminder:", err.message));
    }

    async getPendingReminders(): Promise<any[]> {
        return await withRetry(async () => {
            const { data, error } = await getClient()
                .from("reminders")
                .select("*")
                .eq("status", "pending")
                .lte("remind_at", new Date().toISOString());
            if (error) throw error;
            return data ?? [];
        }, { maxRetries: 2 }).catch(err => {
            console.error("❌ Supabase getPendingReminders:", err.message);
            return [];
        });
    }

    async updateReminderStatus(id: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
        await withRetry(async () => {
            const { error } = await getClient()
                .from("reminders")
                .update({ status, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error("❌ Supabase updateReminderStatus:", err.message));
    }

    async listReminders(chatId: string): Promise<any[]> {
        return await withRetry(async () => {
            const { data, error } = await getClient()
                .from("reminders")
                .select("*")
                .eq("chat_id", chatId)
                .eq("status", "pending")
                .order("remind_at", { ascending: true });
            if (error) throw error;
            return data ?? [];
        }, { maxRetries: 2 }).catch(err => {
            console.error("❌ Supabase listReminders:", err.message);
            return [];
        });
    }

    async cancelReminder(chatId: string, reminderId: number): Promise<boolean> {
        return await withRetry(async () => {
            const { error } = await getClient()
                .from("reminders")
                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                .eq("id", reminderId)
                .eq("chat_id", chatId);
            if (error) throw error;
            return true;
        }, { maxRetries: 2 }).catch(err => {
            console.error("❌ Supabase cancelReminder:", err.message);
            return false;
        });
    }

    // ── MENTAL STATE VERSIONING ──────────────────────────────

    async snapshotState(chatId: string, stateData: any, reason?: string): Promise<void> {
        await withRetry(async () => {
            const { data: latest } = await getClient()
                .from("mental_states")
                .select("version")
                .eq("chat_id", chatId)
                .order("version", { ascending: false })
                .limit(1);

            const nextVersion = (latest?.[0]?.version || 0) + 1;

            const { error } = await getClient()
                .from("mental_states")
                .insert({
                    chat_id: chatId,
                    version: nextVersion,
                    state_data: stateData,
                    snapshot_reason: reason
                });
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error("❌ Supabase snapshotState:", err.message));
    }

    async getLatestState(chatId: string): Promise<any | null> {
        return await withRetry(async () => {
            const { data, error } = await getClient()
                .from("mental_states")
                .select("state_data")
                .eq("chat_id", chatId)
                .order("version", { ascending: false })
                .limit(1);

            if (error) throw error;
            return data?.[0]?.state_data || null;
        }, { maxRetries: 1 }).catch(err => {
            console.error("❌ Supabase getLatestState:", err.message);
            return null;
        });
    }

    // ── AUTOMATION STATUS ───────────────────────────────────────────

    async updateAutomationStatus(taskId: string, status: 'success' | 'failure' | 'running', summary?: string, metadata?: any): Promise<void> {
        await withRetry(async () => {
            const { error } = await getClient()
                .from("automation_status")
                .upsert({
                    id: taskId,
                    status,
                    summary,
                    metadata: metadata ?? {},
                    last_run_at: new Date().toISOString(),
                }, { onConflict: "id" });
            if (error) throw error;
        }, { maxRetries: 2 }).catch(err => console.error(`❌ Supabase updateAutomationStatus (${taskId}):`, err.message));
    }

    async getAutomationStatus(): Promise<any[]> {
        return await withRetry(async () => {
            const { data, error } = await getClient()
                .from("automation_status")
                .select("*")
                .order("last_run_at", { ascending: false });
            if (error) throw error;
            return data ?? [];
        }, { maxRetries: 1 }).catch(err => {
            console.error("❌ Supabase getAutomationStatus:", err.message);
            return [];
        });
    }
}
