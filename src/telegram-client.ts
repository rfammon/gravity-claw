import { Bot } from "grammy";
import { config } from "./config.js";

// Export single instance of the bot
export const bot = new Bot(config.telegramToken);
