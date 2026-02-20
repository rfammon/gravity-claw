import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";

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
        const { error } = await getClient()
            .from("memories")
            .insert({
                chat_id: chatId,
                role,
                content,
                metadata: metadata ?? null,
            });
        if (error) console.error("❌ Supabase saveMessage:", error.message);
    }

    async getChatHistory(chatId: string, limit: number = 50): Promise<MemoryEntry[]> {
        const { data, error } = await getClient()
            .from("memories")
            .select("role, content, created_at")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) {
            console.error("❌ Supabase getChatHistory:", error.message);
            return [];
        }

        return (data ?? []).reverse().map((row) => ({
            role: row.role as MemoryEntry["role"],
            content: row.content,
            timestamp: row.created_at,
        }));
    }

    async storeFact(chatId: string, key: string, value: string): Promise<void> {
        const { error } = await getClient()
            .from("facts")
            .upsert(
                { chat_id: chatId, key, value, updated_at: new Date().toISOString() },
                { onConflict: "chat_id,key" }
            );
        if (error) console.error("❌ Supabase storeFact:", error.message);
    }

    async getFacts(chatId: string): Promise<Record<string, string>> {
        const { data, error } = await getClient()
            .from("facts")
            .select("key, value")
            .eq("chat_id", chatId);

        if (error) {
            console.error("❌ Supabase getFacts:", error.message);
            return {};
        }

        const facts: Record<string, string> = {};
        (data ?? []).forEach((row) => {
            facts[row.key] = row.value;
        });
        return facts;
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
}
