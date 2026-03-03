import { chat } from "../../llm.js";
import { config } from "../../config.js";
import { getUnreportedNews, markNewsAsReported } from "./db.js";
import { sendTelegramMessage } from "../../telegram-utils.js";

export async function generateDailyReport() {
    console.log("📝 Generating LLM Tracker Daily Report...");

    const allUnreadNews = getUnreportedNews();
    if (allUnreadNews.length === 0) {
        console.log("ℹ️ No new LLM news to report today.");
        return;
    }

    // Limit to avoid TPM issues on Cloud providers (Groq/OpenCode/Ollama)
    // Llama 3.3 70b on Groq has a 12k TPM limit. 15 items + prompt usually fits.
    const MAX_REPORT_ITEMS = 15;
    const unreadNews = allUnreadNews.slice(0, MAX_REPORT_ITEMS);

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
        // Use the centralized chat() function which handles Ollama Cloud / Groq / OpenRouter fallbacks
        // This also ensures we use the correct OLLAMA_BASE_URL if configured
        const response = await chat([{ role: "user", content: prompt }]);
        report = response.content?.trim() || "";
    } catch (err: any) {
        console.error("❌ Failed to generate daily report via centralized LLM:", err);
        return;
    }

    if (report) {
        // Send to all allowed users
        for (const userId of config.allowedUserIds) {
            await sendTelegramMessage(String(userId), `📰 *LLM & AI API Daily Briefing*\n\n${report}`);
        }

        // Mark as reported
        const idsToMark = unreadNews.map(n => n.id).filter((id): id is number => id !== undefined);
        markNewsAsReported(idsToMark);

        console.log(`✅ Daily Report sent for ${unreadNews.length} items (of ${allUnreadNews.length} total).`);
    } else {
        console.warn("⚠️ Generated report was empty. Skipping notification.");
    }
}
