import Groq from "groq-sdk";
import OpenAI from "openai";
import { config } from "../../config.js";
import { fetchAllSources } from "./fetchers.js";
import { isUrlProcessed, insertNews } from "./db.js";
import { rag } from "../../rag-provider.js";

// Lazy initialize clients
let groq: Groq | null = null;
let ollama: OpenAI | null = null;

function getGroqClient() {
    if (!groq && config.groqApiKey) {
        groq = new Groq({ apiKey: config.groqApiKey });
    }
    return groq;
}

function getOllamaClient() {
    if (!ollama && config.ollamaBaseUrl) {
        ollama = new OpenAI({
            baseURL: config.ollamaBaseUrl,
            apiKey: config.ollamaApiKey || "ollama" // Ollama doesn't strictly need a real key usually
        });
    }
    return ollama;
}

const SYSTEM_PROMPT = `You are an AI news curator. Your job is to strictly filter news items.
You will be given a news title and content snippet.
Determine if the news is about:
1. A NEW or significantly updated Open Source / Local Large Language Model (LLM).
2. A NEW free API or free tier for an AI model.

If it matches the criteria, reply EXACTLY with "YES", followed by a newline, and then a 1-sentence summary of why it's relevant in Portuguese.
If it does NOT match the criteria (e.g. general AI news, paid API, prompt engineering tutorial, question, etc), reply EXACTLY with "NO".`;

export async function curateNewsItem(title: string, snippet: string): Promise<{ isRelevant: boolean, summary?: string }> {
    const groqClient = getGroqClient();
    const ollamaClient = getOllamaClient();

    if (!groqClient && !ollamaClient) {
        console.warn("⚠️ Both Groq and Ollama missing. Skipping LLM Tracker curation.");
        return { isRelevant: false };
    }

    const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: `Title: ${title}\n\nContent: ${snippet}` }
    ];

    let reply = "";

    try {
        if (!groqClient) throw new Error("Groq client not initialized");
        const response = await groqClient.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages,
            temperature: 0.1,
            max_tokens: 100,
        });
        reply = response.choices[0]?.message?.content?.trim() || "NO";
    } catch (err: any) {
        console.warn(`⚠️ Groq Curation failed (${err.message}). Falling back to Ollama...`);
        if (!ollamaClient) {
            return { isRelevant: false };
        }
        try {
            const response = await ollamaClient.chat.completions.create({
                model: "gemma3:12b", // Small fast model for curation
                messages,
                temperature: 0.1,
                max_tokens: 100,
            });
            reply = String(response.choices[0]?.message?.content?.trim() || "NO");
        } catch (ollamaErr) {
            console.error("❌ Both Groq and Ollama Fallback Curation failed:", ollamaErr);
            return { isRelevant: false };
        }
    }

    if (reply.startsWith("YES")) {
        const summaryParts = reply.split("\n");
        // Get the sentence after YES
        const summary = summaryParts.length > 1 ? summaryParts.slice(1).join(" ").trim() : title;
        return { isRelevant: true, summary };
    }

    return { isRelevant: false };
}

export async function runCurationCycle() {
    console.log("⏰ Starting LLM Tracker Curation Cycle...");

    // 1. Fetch raw posts from Hacker News and Reddit
    const rawPosts = await fetchAllSources();
    console.log(`📥 Fetched ${rawPosts.length} posts from all sources.`);

    let processed = 0;
    let relevantCount = 0;

    // 2. Process each post
    for (const post of rawPosts) {
        // Skip if already processed in the database
        if (isUrlProcessed(post.url)) {
            continue;
        }

        processed++;
        // 3. Ask Groq (Llama 3 8B) if it's relevant
        const curationInfo = await curateNewsItem(post.title, post.content_snippet);

        if (curationInfo.isRelevant) {
            console.log(`⭐ Found relevant news: ${post.title}`);
            relevantCount++;

            // 4. Save to database
            insertNews({
                source: post.source,
                title: post.title,
                url: post.url,
                content_snippet: post.content_snippet,
                curated_summary: curationInfo.summary
            });

            // 5. Add to RAG (Factual Memory) - so the agent knows about it instantly
            try {
                const factContent = `[LLM Tracker] Nova descoberta: ${post.title}. Sumário: ${curationInfo.summary}. Fonte: ${post.url}`;
                // Add to first allowed user (usually the primary)
                const primaryChatId = String(config.allowedUserIds[0] || "global");
                await rag.addFact(primaryChatId, factContent, {
                    url: post.url,
                    source: post.source,
                    type: "llm_tracker_discovery"
                });
                console.log(`🧠 Fact added to RAG for ${primaryChatId}`);
            } catch (ragErr) {
                console.warn("⚠️ Failed to add fact to RAG:", ragErr);
            }
        } else {
            // Save as irrelevant (by saving without reporting or something)
            // Actually, just save it with curated_summary = null and reported = 1 so we don't query it again
            insertNews({
                source: post.source,
                title: post.title,
                url: post.url,
                content_snippet: post.content_snippet,
                reported: true // Mark as reported so the daily summary ignores it
            });
        }
    }

    console.log(`✅ Curation Cycle Complete. Processed: ${processed}, Relevant Found: ${relevantCount}.`);
}
