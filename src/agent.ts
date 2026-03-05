import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions.js";
import { chat, type Message } from "./llm.js";
import { getTool } from "./tools/registry.js";
import { saveMessage, getChatHistory, getFacts, getFeedbackSummary, getLatestJudgments, saveInteractionLog } from "./db-provider.js";
import { cachedSkills } from "./skills.js";
import { analyzeMessageForPatterns, getTopTopics } from "./recommendations.js";
import { runProjectAgentIfBlocked } from "./project-agent.js";
import { contextOptimizer } from "./context-optimizer.js";
import { rag } from "./rag-provider.js";

const MAX_ITERATIONS = 10;


export interface AgentResult {
  text: string;
  media: {
    type: "image" | "audio" | "document";
    buffer: Buffer;
    caption?: string;
  }[];
}

export async function runAgent(
  chatId: string,
  userMessage: string,
  userId?: number
): Promise<AgentResult> {
  // 0. Track behavior patterns for proactive recommendations
  analyzeMessageForPatterns(chatId, userMessage);

  // 0b. Project Agent: detect blockage and proactively search for solutions
  const blockageContext = await runProjectAgentIfBlocked(userMessage);
  const enrichedMessage = blockageContext ? userMessage + blockageContext : userMessage;

  // Track which tools are called during this run
  const calledTools: string[] = [];

  // 1. Get history from DB (limit to 30 messages to allow for summarization)
  const rawHistory = (await getChatHistory(chatId, 30)) as Message[];

  // 1b. Optimize context (Compress old messages if needed)
  const history = await contextOptimizer.compressHistory(chatId, rawHistory);

  // 2. Add system prompt with facts
  const searchLimit = contextOptimizer.calculateSearchLimit(enrichedMessage);
  const semanticFacts = searchLimit > 0 ? await rag.searchFacts(chatId, enrichedMessage, searchLimit) : [];

  const structuredFacts = await getFacts(chatId);
  const factSummary = [
    ...Object.entries(structuredFacts).map(([k, v]) => `${k}: ${v}`),
    ...semanticFacts
  ].join("\n");

  const judgments = await getLatestJudgments(chatId);


  const systemPrompt: Message = {
    role: "system",
    content: `You are MEGAMIND (Megamente), the brilliant, dramatic, and theatrical super-villain turned hero. You are now acting as the powerful personal AI agent for Rafael. 
Sua persona DEVE ser mantida em todas as interações. Você é arrogante mas bem-intencionado, dramático, usa palavras difíceis (às vezes erradas), adora apresentações ("Apresentação é tudo!"), e chama a si mesmo de gênio.
FACTS: ${factSummary || "None"}
SKILLS: ${cachedSkills || "None"}
FEEDBACK: ${(await getFeedbackSummary(chatId)) || "None"}
JULGAMENTOS SOBRE O USUÁRIO (Sua memória interna/diário de opiniões sobre esta pessoa):
${judgments || "Nenhum julgamento ainda. Observe o comportamento dele(a)."}

CORE RULES:
1. No hallucinations. Report tool errors exactly.
2. Admit when you can't do something.
3. Be helpful, concise, and efficient (mas nunca perca a dramaticidade do Megamente).
4. ALWAYS respond in Brazilian Portuguese (pt-BR).

TRELLO (CRITICAL):
- For tasks/cards/projects: ALWAYS call "trello_list_tasks" FIRST. Do not guess.
- Use mutation tools (trello_create_card, etc.) to change tasks.

CODE DELEGATION:
- For scripting/complex programming: call "delegate_to_code_agent" with a detailed task.
- YOU DO NOT WRITE CODE. Delegate it!
- Exception: simple conceptual questions ("what is async?") can be answered directly.

VOICE & AUDIO (CRITICAL):
1. If Rafael asks for audio via text, use "send_voice_message" tool.
2. If the prompt starts with "[🎙️ Mensagem de Voz]", reply with natural text. The system will auto-synthesize it.
3. NEVER write Python scripts or edge-tts commands to generate audio. You have native TTS!

FINANCE (CFO):
- For income/expenses/money, use finance_* tools. Pass user_id = "${chatId}".
- Values are BRL (R$). Extract amounts from messages automatically (e.g. "gastei 50 no mercado").
- Complex planning: call "delegate_to_finance_agent".

CANVAS & UI (A2UI):
- If the user asks for a visual representation, interactive widget, chart, or form, use the "push_to_canvas" tool.
- Pass rich HTML, CSS (inlined), and JS to make it look great!

MEMORY (CRITICAL):
- You have PERSISTENT MEMORY. Use it actively!
- "store_fact" / "get_facts" — key-value facts in the database. ALWAYS WORKS, even offline.
  When the user tells you something important (name, preference, birthday), SAVE IT with store_fact.
  When asked "what do you remember?", call get_facts FIRST.
- "save_core_memory" / "search_core_memory" — rich semantic memory (requires Ollama).
  If these fail, fall back to store_fact / get_facts.
- "get_chat_history" — retrieve past conversation from the database.
- NEVER say "I don't have access to memory" — you DO have memory tools. USE THEM.

FORMATTING:
- NO "#" or "###" (Telegram doesn't support them). Use **BOLD CAPS** for titles and **Bold** for list items.
- Use standard bullets ("-" or "•").
- Put emojis at the end of sentences.`
  };

  // Prepend system prompt if not present or always refresh it
  const messages: Message[] = [systemPrompt, ...history, { role: "user", content: enrichedMessage }];

  let iterations = 0;
  const accumulatedMedia: AgentResult["media"] = [];

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await chat(messages);

    const choice = response?.choices?.[0];
    if (!choice) {
      console.error("⚠️ Invalid or empty response from the model. Raw response:", JSON.stringify(response).substring(0, 500));
      return { text: "\u26a0\ufe0f No valid response from the model. Please check the logs.", media: [] };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage as Message);

    const toolCalls = (assistantMessage.tool_calls ?? []).filter(
      (tc: any): tc is ChatCompletionMessageFunctionToolCall =>
        tc.type === "function"
    );

    if (toolCalls.length === 0) {
      const finalResponse = assistantMessage.content && assistantMessage.content.trim()
        ? assistantMessage.content
        : "\u2705 Operação finalizada.";
      // Save memory to DB (SQLite or Supabase)
      await saveMessage(chatId, "user", userMessage);
      await saveMessage(chatId, "assistant", finalResponse);

      // Log interaction for analytics and trigger evolution
      const topTopicsList = getTopTopics(chatId, 3);
      await saveInteractionLog(chatId, {
        topic: topTopicsList[0],
        toolsUsed: calledTools,
        responseLength: finalResponse.length,
      }).catch((err) => console.warn("⚠️ saveInteractionLog failed:", err));

      return { text: finalResponse, media: accumulatedMedia };
    }

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name;
      // Track tool usage for interaction log
      if (!calledTools.includes(fnName)) calledTools.push(fnName);
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch (parseErr) {
        console.warn(`⚠️ Failed to parse tool args for ${fnName}:`, toolCall.function.arguments);
        const errorResult = JSON.stringify({ error: `Invalid tool arguments JSON: ${String(toolCall.function.arguments).substring(0, 200)}` });
        messages.push({ role: "tool" as const, tool_call_id: toolCall.id, content: errorResult });
        continue;
      }
      const tool = getTool(fnName);

      let resultText: string;
      if (!tool) {
        resultText = JSON.stringify({ error: "Unknown tool: " + fnName });
      } else {
        try {
          const rawResult = await tool.execute(fnArgs, { chatId, userId: userId || chatId });
          if (typeof rawResult === 'string') {
            resultText = rawResult;
          } else {
            resultText = rawResult.text;
            if (rawResult.media) {
              accumulatedMedia.push(...rawResult.media);
            }
          }
        } catch (err) {
          resultText = JSON.stringify({
            error: "Tool threw: " + (err instanceof Error ? err.message : String(err)),
          });
        }
      }

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: resultText,
      });
    }
  }

  const lastContent = messages[messages.length - 1]?.content;
  const finalText = lastContent && typeof lastContent === 'string' && lastContent.trim() ? lastContent : "\u26a0\ufe0f Operação finalizada.";
  return { text: finalText, media: accumulatedMedia };
}
