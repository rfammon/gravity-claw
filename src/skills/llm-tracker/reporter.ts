import Groq from "groq-sdk";
import OpenAI from "openai";
import { config } from "../../config.js";
import { getUnreportedNews, markNewsAsReported } from "./db.js";
import { sendTelegramMessage } from "../../telegram-utils.js";

function getGroqClient() {
    if (config.groqApiKey) {
        return new Groq({ apiKey: config.groqApiKey });
    }
    return null;
}

function getOllamaClient() {
    if (config.ollamaBaseUrl) {
        return new OpenAI({
            baseURL: config.ollamaBaseUrl,
            apiKey: config.ollamaApiKey || "ollama"
        });
    }
    return null;
}

export async function generateDailyReport() {
    console.log("📝 Generating LLM Tracker Daily Report...");

    const unreadNews = getUnreportedNews();
    if (unreadNews.length === 0) {
        console.log("ℹ️ No new LLM news to report today.");
        return;
    }

    const groqClient = getGroqClient();
    const ollamaClient = getOllamaClient();

    if (!groqClient && !ollamaClient) {
        console.warn("⚠️ Both Groq and Ollama are missing. Skipping Daily Report.");
        return;
    }

    // ... (rest of the prompt logic) ...
    const itemsText = unreadNews.map((n, i) => `[${i + 1}] Source: ${n.source}\nTitle: ${n.title}\nURL: ${n.url}\nSummary: ${n.curated_summary}`).join("\n\n");

    const prompt = `Você é um curador de notícias de Inteligência Artificial para desenvolvedores brasileiros.
Aqui estão as notícias filtradas das últimas 24 horas sobre novos modelos de LLM e APIs gratuitas:

${itemsText}

Sua tarefa:
Escreva um relatório diário (Daily Briefing) em Português formatado em Markdown pronto para o Telegram.
- Agrupe por temas (ex: Novos Modelos, Novas APIs, etc) se fizer sentido.
- Use emojis para ficar legível.
- Resuma as principais informações de forma direta e profissional.
- SÓ inclua as notícias fornecidas acima e mantenha os links originais para que o usuário possa clicar.
- Não introduza ou conclua com falas inúteis do tipo "Aqui está o seu relatório". Apenas retorne o relatório.`;

    let report = "";

    try {
        if (!groqClient) throw new Error("Groq API not configured");
        const response = await groqClient.chat.completions.create({
            model: "llama-3.3-70b-versatile", // Use larger model for synthesis
            messages: [{ role: "user" as const, content: prompt }],
            temperature: 0.3,
            max_tokens: 2000,
        });
        report = response.choices[0]?.message?.content?.trim() || "";
    } catch (err: any) {
        console.warn(`⚠️ Groq Reporter failed (${err.message}). Falling back to Ollama...`);
        if (!ollamaClient) {
            console.error("❌ Both Groq and Ollama Fallback are unavailable for reporting.");
            return;
        }
        try {
            const response = await ollamaClient.chat.completions.create({
                model: "deepseek-v3.2", // Smart model for synthesis
                messages: [{ role: "user" as const, content: prompt }],
                temperature: 0.3,
                max_tokens: 2000,
            });
            report = String(response.choices[0]?.message?.content?.trim() || "");
        } catch (ollamaErr) {
            console.error("❌ Both Groq and Ollama Fallback failed to generate daily report:", ollamaErr);
            return;
        }
    }

    if (report) {
        // Send to all allowed users
        for (const userId of config.allowedUserIds) {
            await sendTelegramMessage(String(userId), `📰 *LLM & AI API Daily Briefing*\n\n${report}`);
        }

        // Mark as reported
        const idsToMark = unreadNews.map(n => n.id).filter((id): id is number => id !== undefined);
        markNewsAsReported(idsToMark);

        console.log(`✅ Daily Report sent for ${unreadNews.length} items.`);
    }
}
