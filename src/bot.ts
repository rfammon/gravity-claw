import { Bot, InputFile } from "grammy";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { transcribeVoice, synthesizeSpeech } from "./voice.js";
import { trackBotMessage, saveFeedback } from "./memory.js";
import { extractTextFromImage } from "./vision.js";

const bot = new Bot(config.telegramToken);

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

// ─── Text Message Handler ────────────────────────────────────────────
bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    console.log(`📩 [${chatId}] ${text}`);

    try {
        await ctx.replyWithChatAction("typing");
        const response = await runAgent(String(chatId), text);

        if (response.length <= 4096) {
            const sent = await ctx.reply(response, { parse_mode: "Markdown" }).catch(() => {
                return ctx.reply(response);
            });
            if (sent) trackBotMessage(String(chatId), sent.message_id, response);
        } else {
            const chunks = splitMessage(response, 4096);
            for (const chunk of chunks) {
                const sent = await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => {
                    return ctx.reply(chunk);
                });
                if (sent) trackBotMessage(String(chatId), sent.message_id, chunk);
            }
        }

        console.log(`✅ [${chatId}] Responded (${response.length} chars)`);
    } catch (error) {
        console.error(`❌ [${chatId}] Error:`, error);
        await ctx.reply("Something went wrong. Please try again.");
    }
});

// ─── Voice Message Handler ───────────────────────────────────────────
bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;

    console.log(`🎤 [${chatId}] Voice message received (${ctx.message.voice.duration}s)`);

    try {
        // Show recording indicator
        await ctx.replyWithChatAction("record_voice");

        // 1. Download voice file from Telegram
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const audioBuffer = Buffer.from(await response.arrayBuffer());

        console.log(`📥 [${chatId}] Downloaded ${audioBuffer.length} bytes`);

        // 2. Transcribe voice → text
        await ctx.replyWithChatAction("typing");
        const transcription = await transcribeVoice(audioBuffer);

        if (!transcription.trim()) {
            await ctx.reply("🤔 I couldn't understand the voice message. Could you try again?");
            return;
        }

        // 3. Process through agent
        await ctx.replyWithChatAction("typing");
        const agentResponse = await runAgent(String(chatId), transcription);

        // 4. Generate voice response
        await ctx.replyWithChatAction("record_voice");
        try {
            const speechBuffer = await synthesizeSpeech(agentResponse);

            // 5. Send voice + text caption
            await ctx.replyWithVoice(new InputFile(speechBuffer, "response.mp3"), {
                caption: agentResponse.length <= 1024 ? agentResponse : agentResponse.substring(0, 1021) + "...",
            });
        } catch (ttsError) {
            console.warn("⚠️ TTS failed, falling back to text only:", ttsError);
            // Fallback: send text directly if voice fails
            if (agentResponse.length <= 4096) {
                await ctx.reply(agentResponse);
            } else {
                const chunks = splitMessage(agentResponse, 4096);
                for (const chunk of chunks) {
                    await ctx.reply(chunk);
                }
            }
        }

        console.log(`✅ [${chatId}] Response sent (fallback to text if voice failed)`);
    } catch (error: any) {
        console.error("❌ Voice process error:", error);
        if (error.message?.includes("invalid_api_key") || error.message?.includes("API key")) {
            await ctx.reply("❌ Erro nas chaves de API. Por favor, verifique se a `GROQ_API_KEY` no arquivo `.env` é válida.");
        } else {
            await ctx.reply("❌ Ocorreu um erro ao processar sua mensagem de voz. Por favor, tente novamente mais tarde.");
        }
    }
});

// ─── Photo Message Handler (OCR / Vision) ────────────────────────────
bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    const caption = ctx.message.caption || "";

    console.log(`📷 [${chatId}] Photo received${caption ? ` (caption: "${caption.substring(0, 50)}...")` : ""}`);

    try {
        await ctx.replyWithChatAction("typing");

        // 1. Download highest resolution photo
        const photos = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1]; // Last = highest res
        const file = await ctx.api.getFile(bestPhoto.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
        const imgResponse = await fetch(fileUrl);
        const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

        console.log(`📥 [${chatId}] Downloaded ${(imageBuffer.length / 1024).toFixed(0)}KB image`);

        // 2. Run OCR
        const ocr = await extractTextFromImage(imageBuffer);

        // 3. Build agent message
        let agentMessage: string;
        if (ocr.text) {
            agentMessage = caption
                ? `[📷 O usuário enviou uma foto com legenda: "${caption}". Texto extraído via OCR (${ocr.engine}): "${ocr.text}"]\n\nAnalise o texto extraído e responda considerando a legenda.`
                : `[📷 O usuário enviou uma foto. Texto extraído via OCR (${ocr.engine}): "${ocr.text}"]\n\nAnalise o texto extraído e responda de forma útil.`;
        } else {
            agentMessage = caption
                ? `[📷 O usuário enviou uma foto com legenda: "${caption}". Nenhum texto foi detectado na imagem pelo OCR.]\n\nResponda com base na legenda do usuário.`
                : `[📷 O usuário enviou uma foto, mas nenhum texto foi detectado pelo OCR. Informe que não foi possível extrair texto e pergunte o que ele precisa.]`;
        }

        // 4. Process through agent
        await ctx.replyWithChatAction("typing");
        const response = await runAgent(String(chatId), agentMessage);

        // 5. Send response
        if (response.length <= 4096) {
            const sent = await ctx.reply(response, { parse_mode: "Markdown" }).catch(() => ctx.reply(response));
            if (sent) trackBotMessage(String(chatId), sent.message_id, response);
        } else {
            const chunks = splitMessage(response, 4096);
            for (const chunk of chunks) {
                const sent = await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
                if (sent) trackBotMessage(String(chatId), sent.message_id, chunk);
            }
        }

        console.log(`✅ [${chatId}] Photo processed: ${ocr.text.length} chars extracted (${ocr.engine}), response ${response.length} chars`);
    } catch (error) {
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

// ─── Lifecycle ───────────────────────────────────────────────────────
export function startBot(): void {
    bot.start({
        allowed_updates: ["message", "message_reaction", "callback_query"],
        onStart: async (botInfo) => {
            console.log(`⚡ Gravity Claw is online as @${botInfo.username}`);
            console.log(`🔒 Whitelisted users: ${config.allowedUserIds.join(", ")}`);

            // Notify Rafael/Admins that the daemon is active
            for (const userId of config.allowedUserIds) {
                try {
                    await bot.api.sendMessage(userId, "🚀 *Gravity Claw reativado.*\nO sistema está em funcionamento em segundo plano.", { parse_mode: "Markdown" });
                } catch (err) {
                    console.warn(`⚠️ Could not notify user ${userId} on startup (maybe bot hasn't chatted with them yet?)`);
                }
            }
        },
    });
}

// Graceful shutdown
function shutdown(signal: string): void {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    bot.stop();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
