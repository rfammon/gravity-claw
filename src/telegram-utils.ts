import { InputFile } from "grammy";
import { bot } from "./telegram-client.js";
import { config } from "./config.js";
import { withRetry } from "./utils/network.js";

export async function sendTelegramMessage(chatId: string, text: string) {
    if (!config.allowedUserIds.includes(Number(chatId))) return;
    try {
        await withRetry(
            () => bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" }),
            { maxRetries: 2 }
        );
    } catch (err) {
        console.error(`❌ Failed to send message to ${chatId}:`, err);
        throw err;
    }
}

export async function sendTelegramPhoto(chatId: string, photo: string | Buffer, caption?: string) {
    if (!config.allowedUserIds.includes(Number(chatId))) return;
    try {
        const photoInput = typeof photo === "string" ? photo : new InputFile(photo);
        await withRetry(
            () => bot.api.sendPhoto(chatId, photoInput, {
                caption,
                parse_mode: "Markdown"
            }),
            { maxRetries: 2 }
        );
    } catch (err) {
        console.error(`❌ Failed to send photo to ${chatId}:`, err);
        throw err;
    }
}
