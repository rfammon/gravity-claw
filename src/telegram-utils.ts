import { InputFile } from "grammy";
import { bot } from "./telegram-client.js";
import { config } from "./config.js";

export async function sendTelegramMessage(chatId: string, text: string) {
    if (!config.allowedUserIds.includes(Number(chatId))) return;
    try {
        await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
        console.error(`❌ Failed to send message to ${chatId}:`, err);
    }
}

export async function sendTelegramPhoto(chatId: string, photo: string | Buffer, caption?: string) {
    if (!config.allowedUserIds.includes(Number(chatId))) return;
    try {
        const inputFile = typeof photo === "string" ? photo : new InputFile(photo, "chart.png");
        await bot.api.sendPhoto(chatId, inputFile, {
            caption,
            parse_mode: "Markdown"
        });
    } catch (err) {
        console.error(`❌ Failed to send photo to ${chatId}:`, err);
    }
}
