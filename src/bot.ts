import { Bot, InputFile, GrammyError, HttpError } from "grammy";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { TypingIndicator } from "./utils/typing-indicator.js";
import { transcribeVoice, synthesizeSpeech } from "./voice.js";
import { trackBotMessage, saveFeedback } from "./db-provider.js";
import { extractTextFromImage } from "./vision.js";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import dns from "node:dns/promises";
import { withRetry } from "./utils/network.js";

import { bot } from "./telegram-client.js";
import { sendTelegramPhoto } from "./telegram-utils.js";
import axios from "axios";

// ─── Whitelist Middleware ────────────────────────────────────────────
// Security: silently ignore messages from non-whitelisted users
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.includes(userId)) {
        return; // Silent drop — no response, no error
    }
    await next();
});

// ─── Commands ────────────────────────────────────────────────────────
bot.command("start", async (ctx) => {
    await ctx.reply(
        "🤖 *Gravity Claw online.*\n\n" +
        "I'm your personal AI assistant. Send me any message and I'll respond.\n" +
        "🎤 You can also send *voice messages* — I'll listen and reply with voice!\n\n" +
        "Try asking: _What time is it?_",
        { parse_mode: "Markdown" }
    );
});

bot.command("forget", async (ctx) => {
    const chatId = String(ctx.chat.id);
    import("./memory.js").then(m => m.clearHistory(chatId));
    await ctx.reply("🧹 Conversation history cleared.");
});

bot.command("think", async (ctx) => {
    const text = ctx.message?.text?.split(" ")[1]?.toLowerCase();
    if (text === "off" || text === "low" || text === "medium" || text === "high") {
        import("./llm.js").then(l => l.setThinkingLevel(text as any));
        await ctx.reply(`🧠 Thinking level set to: *${text}*`, { parse_mode: "Markdown" });
    } else {
        await ctx.reply("❌ Please specify a level: `off`, `low`, `medium`, or `high`.\nExample: `/think high`", { parse_mode: "Markdown" });
    }
});

// ─── Callback Query Handler (Inline Buttons) ────────────────────────
bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = String(ctx.chat?.id || ctx.from.id);

    try {
        if (data.startsWith("code_approve:") || data.startsWith("code_reject:")) {
            const proposalId = parseInt(data.split(":")[1], 10);
            if (isNaN(proposalId)) {
                await ctx.answerCallbackQuery({ text: "❌ ID inválido" });
                return;
            }

            const { applyProposal, rejectProposal } = await import("./code-sandbox.js");

            if (data.startsWith("code_approve:")) {
                await ctx.answerCallbackQuery({ text: "✅ Aplicando..." });
                await applyProposal(proposalId, chatId);
            } else {
                await ctx.answerCallbackQuery({ text: "🗑️ Rejeitado" });
                await rejectProposal(proposalId, chatId);
            }
        } else if (data.startsWith("routine_")) {
            // Future: routine manager callbacks
            await ctx.answerCallbackQuery({ text: "🔧 Em breve..." });
        } else {
            await ctx.answerCallbackQuery({ text: "❓ Ação desconhecida" });
        }
    } catch (err) {
        console.error("❌ Callback query error:", err);
        await ctx.answerCallbackQuery({ text: "❌ Erro ao processar" });
    }
});

// ─── Shared Response Sender ─────────────────────────────────────────
/** Sends the agent result (text + media) to the user via Telegram. */
async function sendAgentResult(ctx: any, chatId: string, result: { text: string; media?: any[] }): Promise<void> {
    const chunks = splitMessage(result.text, 4096);
    for (const chunk of chunks) {
        const sent = await withRetry(
            () => ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk)),
            { maxRetries: 2 }
        ).catch(() => null);
        if (sent && (sent as any).message_id) {
            trackBotMessage(chatId, (sent as any).message_id, chunk);
        }
    }
    if (result.media && result.media.length > 0) {
        for (const media of result.media) {
            if (media.type === "image") {
                await sendTelegramPhoto(chatId, media.buffer, media.caption);
            }
        }
    }
}

// ─── Text Message Handler ────────────────────────────────────────────
bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;
    console.log(`📩 [${chatId}] ${text.substring(0, 80)}`);

    const typing = new TypingIndicator(ctx, "typing");
    await typing.start();
    try {
        const result = await runAgent(chatId, text, ctx.from?.id);
        typing.stop();
        await sendAgentResult(ctx, chatId, result);
        console.log(`✅ [${chatId}] Responded (${result.text.length} chars, ${result.media?.length || 0} media)`);
    } catch (error) {
        typing.stop();
        console.error(`❌ [${chatId}] Error:`, error);
        await ctx.reply("Algo deu errado. Por favor, tente novamente.");
    }
});

// ─── Voice Message Handler ───────────────────────────────────────────
bot.on("message:voice", async (ctx) => {
    const chatId = String(ctx.chat.id);
    console.log(`🎤 [${chatId}] Voice message received (${ctx.message.voice.duration}s)`);

    const indicator = new TypingIndicator(ctx, "record_voice");
    await indicator.start();
    try {
        // 1. Download + Transcribe
        const file = await withRetry(() => ctx.getFile(), { maxRetries: 2 });
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
        const response = await withRetry(
            () => axios.get(fileUrl, { responseType: "arraybuffer", timeout: 30000 }),
            { maxRetries: 3, initialDelay: 2000 }
        );
        const audioBuffer = Buffer.from(response.data);
        indicator.setAction("typing");
        const transcription = await transcribeVoice(audioBuffer);

        if (!transcription.trim()) {
            indicator.stop();
            await ctx.reply("🤔 Não consegui entender a mensagem de voz. Pode tentar novamente?");
            return;
        }

        // 2. Run agent
        const agentResult = await runAgent(chatId, `[🎙️ Mensagem de Voz] ${transcription}`, ctx.from?.id);

        // 3. Send TTS voice response (non-blocking failure)
        indicator.setAction("record_voice");
        try {
            const speechBuffer = await synthesizeSpeech(agentResult.text);
            indicator.stop();
            await withRetry(() => ctx.replyWithVoice(new InputFile(speechBuffer, "response.mp3")), { maxRetries: 2 });
        } catch (ttsError) {
            indicator.stop();
            console.warn("⚠️ TTS failed:", ttsError);
        }

        // 4. Send text + media
        await sendAgentResult(ctx, chatId, agentResult);
        console.log(`✅ [${chatId}] Voice + text response sent`);
    } catch (error: any) {
        indicator.stop();
        console.error("❌ Voice process error:", error);
        await ctx.reply("❌ Ocorreu um erro ao processar sua mensagem de voz. Por favor, tente novamente mais tarde.");
    }
});

// ─── Photo Message Handler (OCR / Vision) ────────────────────────────
bot.on("message:photo", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const caption = ctx.message.caption || "";
    console.log(`📷 [${chatId}] Photo received`);

    const indicator = new TypingIndicator(ctx, "typing");
    await indicator.start();
    try {
        // 1. Download highest resolution photo
        const photos = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1];
        const file = await withRetry(() => ctx.api.getFile(bestPhoto.file_id), { maxRetries: 2 });
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
        const imgResponse = await withRetry(() => fetch(fileUrl), { maxRetries: 2 });
        const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

        // 2. Run OCR + Build agent message
        const ocr = await extractTextFromImage(imageBuffer);
        let agentMessage: string;
        if (ocr.text) {
            agentMessage = caption
                ? `[📷 Foto com legenda: "${caption}". OCR (${ocr.engine}): "${ocr.text}"]\n\nAnalise o texto e responda considerando a legenda.`
                : `[📷 Foto recebida. OCR (${ocr.engine}): "${ocr.text}"]\n\nAnalise o texto e responda de forma útil.`;
        } else {
            agentMessage = caption
                ? `[📷 Foto com legenda: "${caption}". OCR não detectou texto.]\n\nResponda com base na legenda.`
                : `[📷 Foto sem texto detectável pelo OCR. Pergunte ao usuário o que ele precisa.]`;
        }

        // 3. Process + Send
        const result = await runAgent(chatId, agentMessage, ctx.from?.id);
        indicator.stop();
        await sendAgentResult(ctx, chatId, result);
        console.log(`✅ [${chatId}] Photo processed: OCR="${ocr.engine}", response=${result.text.length} chars`);
    } catch (error) {
        indicator.stop();
        console.error(`❌ [${chatId}] Photo error:`, error);
        await ctx.reply("❌ Erro ao processar a imagem. Tente novamente.");
    }
});

// ─── Emoji Reaction Feedback ─────────────────────────────────────────
const EMOJI_MAP: Record<string, string> = {
    "👍": "positive",
    "❤": "loved",
    "❤️": "loved",
    "😡": "negative",
    "👎": "negative",
    "🔥": "loved",
    "💯": "loved",
    "😢": "negative",
};

bot.on("message_reaction", async (ctx) => {
    try {
        const reaction = ctx.messageReaction;
        const chatId = String(reaction.chat.id);

        const messageId = reaction.message_id;
        const newReactions = reaction.new_reaction;

        for (const r of newReactions) {
            if (r.type === "emoji" && r.emoji) {
                const signal = EMOJI_MAP[r.emoji];
                if (signal) {
                    saveFeedback(chatId, messageId, signal, r.emoji);
                    console.log(`🎯 [${chatId}] Reaction ${r.emoji} (${signal}) on msg ${messageId}`);
                }
            }
        }
    } catch (err) {
        console.error("❌ Reaction handler error:", err);
    }
});

// ─── Helpers ─────────────────────────────────────────────────────────
function splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline
        let splitAt = remaining.lastIndexOf("\n", maxLength);
        if (splitAt === -1 || splitAt < maxLength / 2) {
            // Fall back to splitting at a space
            splitAt = remaining.lastIndexOf(" ", maxLength);
        }
        if (splitAt === -1 || splitAt < maxLength / 2) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
}

// sendTelegramMessage and sendTelegramPhoto are now in telegram-utils.ts

import { registerTool } from "./tools/registry.js";
registerTool({
    name: "send_voice_message",
    description: "Generates an audio message using Text-to-Speech and sends it directly to the user's Telegram chat. Use this ONLY when the user explicitly asks you to speak, say something, send an audio, or test the voice system.",
    parameters: {
        type: "object",
        properties: {
            text_to_speak: {
                type: "string",
                description: "The exact text you want to be synthesized into speech and sent as audio."
            },
            chatId: {
                type: "string",
                description: "The chat ID of the user (must pass the chatId from the current context)."
            }
        },
        required: ["text_to_speak", "chatId"]
    },
    execute: async ({ text_to_speak, chatId }) => {
        try {
            const buffer = await synthesizeSpeech(String(text_to_speak));
            const inputFile = new InputFile(buffer, "voice.mp3");
            await bot.api.sendVoice(String(chatId), inputFile, {
                caption: "🎤 Áudio gravado!",
                parse_mode: "Markdown"
            });
            return `Voice message successfully sent. Do not output the audio content again in your text response to avoid redundancy.`;
        } catch (e: any) {
            return `Failed to send voice message: ${e.message}`;
        }
    }
});

bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[Bot Error] Update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
        console.error("Error in request:", e.description);
        if (e.error_code === 409) {
            console.error("⚠️ Sensor: Conflito 409 - Outra instância (provavelmente em outra máquina) está conectada ao Telegram. O Telegram derrubou a nossa.");
        }
    } else if (e instanceof HttpError) {
        console.error("Could not contact Telegram:", e.message);
    } else {
        console.error("Unknown error:", e);
    }
});

// ─── Lifecycle & Sensors ─────────────────────────────────────────────

const LOCK_FILE = join(tmpdir(), "gravity_claw.lock");

export async function startBot(): Promise<void> {
    // 🛡️ Sensor 1: Instância Única (Singleton)
    // Garantir que apenas UMA instância do bot rode na mesma máquina
    if (existsSync(LOCK_FILE)) {
        try {
            const oldPid = parseInt(readFileSync(LOCK_FILE, "utf-8"), 10);
            if (oldPid !== process.pid) {
                console.log(`⚠️ Sensor de Instância: Processo antigo detectado (PID ${oldPid}).`);
                try {
                    process.kill(oldPid, 0); // Testa se o processo ainda existe
                    console.log(`🔪 Finalizando processo antigo para manter APENAS ESTA instância ativa...`);
                    process.kill(oldPid);
                } catch (e) {
                    // Processo já morreu, o lock é fantasma
                    console.log(`🧹 Limpando lock fantasma antigo...`);
                }
            }
        } catch (e) {
            console.error("Erro ao verificar lock da instância:", e);
        }
    }
    // Grava o próprio PID como o ativo
    writeFileSync(LOCK_FILE, String(process.pid), "utf-8");

    // 🌐 Sensor 2: Monitor de Rede e Auto-Reconexão
    let isConnected = true;

    async function checkNetwork() {
        try {
            // Tenta resolver o DNS do Telegram. Se passar, tem internet
            await dns.lookup("api.telegram.org");
            return true;
        } catch {
            return false;
        }
    }

    async function pollingLoop() {
        while (true) {
            const hasNetwork = await checkNetwork();

            if (!hasNetwork) {
                if (isConnected) {
                    console.log("\n🌐 Sensor de Rede: 🔴 Conexão com a internet foi perdida. Aguardando rede voltar...");
                    isConnected = false;
                }
                await new Promise(res => setTimeout(res, 5000));
                continue;
            }

            if (!isConnected) {
                console.log("\n🌐 Sensor de Rede: 🟢 Conexão restabelecida! Reiniciando bot...");
                isConnected = true;
            }

            try {
                // Ao usar drop_pending_updates, ignoramos mensagens encavaladas e evitamos crashs 409 no start
                await bot.start({
                    allowed_updates: ["message", "message_reaction", "callback_query"],
                    drop_pending_updates: true,
                    onStart: async (botInfo) => {
                        console.log(`⚡ Gravity Claw is online as @${botInfo.username}`);
                        console.log(`🔒 Whitelisted users: ${config.allowedUserIds.join(", ")}`);
                        // Notificar que inicializou
                        for (const userId of config.allowedUserIds) {
                            try {
                                await withRetry(
                                    () => bot.api.sendMessage(userId, "🚀 *Gravity Claw reativado.*\nO sistema superou a reinicialização/rede e está em funcionamento no plano de fundo.", { parse_mode: "Markdown" }),
                                    { maxRetries: 2 }
                                );
                            } catch (err) {
                                // Ignore
                            }
                        }
                    }
                });
                break; // bot.start() bloqueia infinito se der tudo certo. Só sai daqui em erro crítico irrecuperável que a grammY decida cuspir.
            } catch (err: any) {
                console.error(`🛑 GrammyY Polling desarmou: ${err.message}. Sensor reiniciando em 5s...`);
                await bot.stop();
                await new Promise(res => setTimeout(res, 5000));
            }
        }
    }

    // Inicia o loop infinito à prova de balas
    pollingLoop();
}

// Graceful shutdown
function shutdown(signal: string): void {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    if (existsSync(LOCK_FILE)) {
        try { unlinkSync(LOCK_FILE); } catch (e) { }
    }
    bot.stop();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

