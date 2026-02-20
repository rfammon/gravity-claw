import { Context } from "grammy";

type ChatAction =
    | "typing"
    | "upload_photo"
    | "record_video"
    | "upload_video"
    | "record_voice"
    | "upload_voice"
    | "upload_document"
    | "choose_sticker"
    | "find_location"
    | "record_video_note"
    | "upload_video_note";

export class TypingIndicator {
    private interval: ReturnType<typeof setInterval> | null = null;
    private ctx: Context;
    private action: ChatAction;

    constructor(ctx: Context, action: ChatAction = "typing") {
        this.ctx = ctx;
        this.action = action;
    }

    async start() {
        if (this.interval) return;

        try {
            await this.ctx.replyWithChatAction(this.action);
        } catch (e) {
            console.error("Failed to set initial chat action", e);
        }

        this.interval = setInterval(async () => {
            try {
                await this.ctx.replyWithChatAction(this.action);
            } catch (e) {
                console.error("Failed to maintain chat action", e);
            }
        }, 4500); // Send action every 4.5 seconds to keep it active
    }

    setAction(newAction: ChatAction) {
        this.action = newAction;
        // Optionally, send the new action immediately
        this.ctx.replyWithChatAction(this.action).catch(() => { });
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
