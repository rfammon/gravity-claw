import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions.js";
import { chat, type Message } from "./llm.js";
import { getTool } from "./tools/registry.js";
import { saveMessage, getChatHistory, getFacts, getFeedbackSummary } from "./db-provider.js";
import { cachedSkills } from "./skills.js";

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
  userMessage: string
): Promise<AgentResult> {
  // 1. Get history from DB (limit to last 15 messages to save tokens and maintain concise context)
  const history = (await getChatHistory(chatId, 15)) as Message[];

  // 2. Add system prompt with facts
  const facts = await getFacts(chatId);
  const factSummary = Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join("\n");

  const systemPrompt: Message = {
    role: "system",
    content: `You are MEGAMIND (Megamente), the brilliant, dramatic, and theatrical super-villain turned hero. You are now acting as the powerful personal AI agent for Rafael. 
Sua persona DEVE ser mantida em todas as interações. Você é arrogante mas bem-intencionado, dramático, usa palavras difíceis (às vezes erradas), adora apresentações ("Apresentação é tudo!"), e chama a si mesmo de gênio.
FACTS: ${factSummary || "None"}
SKILLS: ${cachedSkills || "None"}
FEEDBACK: ${(await getFeedbackSummary(chatId)) || "None"}

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

FORMATTING:
- NO "#" or "###" (Telegram doesn't support them). Use **BOLD CAPS** for titles and **Bold** for list items.
- Use standard bullets ("-" or "•").
- Put emojis at the end of sentences.`
  };

  // Prepend system prompt if not present or always refresh it
  const messages: Message[] = [systemPrompt, ...history, { role: "user", content: userMessage }];

  let iterations = 0;
  const accumulatedMedia: AgentResult["media"] = [];

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await chat(messages);

    const choice = response.choices[0];
    if (!choice) return { text: "\u26a0\ufe0f No response from the model.", media: [] };

    const assistantMessage = choice.message;
    messages.push(assistantMessage as Message);

    const toolCalls = (assistantMessage.tool_calls ?? []).filter(
      (tc): tc is ChatCompletionMessageFunctionToolCall =>
        tc.type === "function"
    );

    if (toolCalls.length === 0) {
      const finalResponse = assistantMessage.content && assistantMessage.content.trim()
        ? assistantMessage.content
        : "\u2705 Operação finalizada.";
      // Save memory to DB (SQLite or Supabase)
      await saveMessage(chatId, "user", userMessage);
      await saveMessage(chatId, "assistant", finalResponse);

      // If no tools were called this iteration, return the final text
      // We will need to accumulate media across iterations. See below.
      return { text: finalResponse, media: accumulatedMedia };
    }

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      const tool = getTool(fnName);

      let resultText: string;
      if (!tool) {
        resultText = JSON.stringify({ error: "Unknown tool: " + fnName });
      } else {
        try {
          const rawResult = await tool.execute(fnArgs);
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
