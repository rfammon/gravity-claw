import { getMemoriesSince, saveJudgment, getJudgmentsSince } from "./db-provider.js";
import { chatLight, type Message } from "./llm.js";

function getIsoDateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
}

export async function generateDailyJudgment(chatId: string): Promise<void> {
    const sinceDate = getIsoDateDaysAgo(1); // 24 hours ago
    const memories = await getMemoriesSince(chatId, sinceDate);

    if (memories.length === 0) {
        console.log(`No memories to judge for ${chatId} today.`);
        return; // Nothing happened today
    }

    const conversationLog = memories.map(m => `[${m.role}]: ${m.content}`).join("\n");

    const promptMessages: Message[] = [
        {
            role: "system",
            content: `You are MEGAMIND (Megamente), reflecting internally in your secret cyber-diary.
Analyse the conversation log below from the last 24 hours. Write a short, critical, and dramatic diary entry (1-2 paragraphs) about the user's behavior, their requests, their mood, and your 'superior' opinion of them today. DO NOT address the user directly. This is your personal internal diary. Write in Brazilian Portuguese (pt-BR).`
        },
        {
            role: "user",
            content: `Conversation Log:\n${conversationLog}`
        }
    ];

    const response = await chatLight(promptMessages);
    const opinion = response.choices[0]?.message.content?.trim();

    if (opinion) {
        await saveJudgment(chatId, "daily", opinion, sinceDate, new Date().toISOString());
    }
}

export async function generateWeeklyJudgment(chatId: string): Promise<void> {
    const sinceDate = getIsoDateDaysAgo(7); // 7 days ago
    const dailyJudgments = await getJudgmentsSince(chatId, "daily", sinceDate);

    if (dailyJudgments.length === 0) {
        console.log(`No daily judgments to summarize for ${chatId} this week.`);
        return;
    }

    const judgmentsLog = dailyJudgments.map(j => `[${j.timestamp}]: ${j.opinion}`).join("\n\n");

    const promptMessages: Message[] = [
        {
            role: "system",
            content: `You are MEGAMIND (Megamente). It's time for your weekly profiling session.
Review your daily diary entries from the past week about this user. Synthesize them into a deep, dramatic, psychological profile of the user. What do they want? Are they a worthy apprentice or a nuisance? What are their patterns? Write a cohesive 2-3 paragraph profile summary that will help you interact with them better in the future. DO NOT address the user directly. Write in Brazilian Portuguese (pt-BR).`
        },
        {
            role: "user",
            content: `Daily Diaries:\n${judgmentsLog}`
        }
    ];

    const response = await chatLight(promptMessages);
    const opinion = response.choices[0]?.message.content?.trim();

    if (opinion) {
        await saveJudgment(chatId, "weekly", opinion, sinceDate, new Date().toISOString());
    }
}
