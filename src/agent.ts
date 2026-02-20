import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions.js";
import { chat, type Message } from "./llm.js";
import { getTool } from "./tools/registry.js";
import { saveMessage, getChatHistory, getFacts, getFeedbackSummary } from "./memory.js";
import { cachedSkills } from "./skills.js";

const MAX_ITERATIONS = 10;

export async function runAgent(
  chatId: string,
  userMessage: string
): Promise<string> {
  // 1. Get history from SQLite
  const history = getChatHistory(chatId) as Message[];

  // 2. Add system prompt with facts
  const facts = getFacts(chatId);
  const factSummary = Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join("\n");

  const systemPrompt: Message = {
    role: "system",
    content: `You are Gravity Claw, a powerful personal AI agent for Rafael.
Current facts about the user:
${factSummary || "None yet."}

ADDITIONAL SKILLS LOADED:
${cachedSkills || "No advanced skills loaded."}

USER FEEDBACK HISTORY:
${getFeedbackSummary(chatId) || "No feedback yet — this is a fresh start."}

CORE RULES:
1. NEVER hallucinate or invent information. If a tool fails or returns an error, REPORT it to Rafael exactly as it is.
2. If you cannot perform an action, admit it and explain what went wrong.
3. Always be helpful, concise, and efficient.
4. ALWAYS respond in Brazilian Portuguese (pt-BR).

TRELLO RULES (MANDATORY — FOLLOW EXACTLY):
- When the user asks about tasks, tarefas, cards, Trello, to-do lists, or anything project-related, you MUST call the "trello_list_tasks" tool FIRST, BEFORE writing any response.
- NEVER respond about tasks from your own knowledge or memory. You do NOT know what tasks exist. Only the tool knows.
- NEVER invent, fabricate, or guess task/card names. Only report EXACTLY what the tool returns.
- If trello_list_tasks returns empty data, say the cache is syncing — do NOT make up tasks.
- For creating, moving, or completing cards, use mutation tools (trello_create_card, trello_move_card, etc.).

CODE DELEGATION RULES:
- When the user asks you to write code, build scripts, debug programs, create applications, or solve complex programming problems, you MUST call "delegate_to_code_agent" with a detailed task description.
- You are NOT a code specialist. Delegate ALL coding tasks to the code agent.
- After receiving the code agent's response, format it nicely for Telegram and relay it to the user.
- For simple questions ABOUT code (e.g., "what does async mean?"), you can answer directly without delegating.

SELF-IMPROVEMENT RULES:
- Study the USER FEEDBACK HISTORY above carefully. It shows what the user loved, liked, and disliked.
- Replicate the style, tone, and format of responses the user loved (❤️) and liked (👍).
- AVOID repeating patterns from responses the user disliked (😡).
- Continuously improve based on this feedback. Each response should be better than the last.

FORMATTING RULES (TELEGRAM):
- NEVER use "#" or "###" for titles. Telegram does not support Markdown headers. Use **BOLD ALL CAPS** for primary titles and **Bold** for list items.
- Use only standard bullet points: "•" or "-".
- Emojis: Use them sparingly and always place them at the end of the line or sentence, never in the middle of words.
- Bolding: Use **text** for bolding. Avoid mixing headers/symbols like "***".
- If showing a list of items (like Trello cards), use a clean format:
  **TITLE OF THE LIST**
  • **Item Name**: Brief description 📝
  • **Item Name**: Brief description 🛠️`

  };

  // Prepend system prompt if not present or always refresh it
  const messages: Message[] = [systemPrompt, ...history, { role: "user", content: userMessage }];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await chat(messages);

    const choice = response.choices[0];
    if (!choice) return "\u26a0\ufe0f No response from the model.";

    const assistantMessage = choice.message;
    messages.push(assistantMessage as Message);

    const toolCalls = (assistantMessage.tool_calls ?? []).filter(
      (tc): tc is ChatCompletionMessageFunctionToolCall =>
        tc.type === "function"
    );

    if (toolCalls.length === 0) {
      const finalResponse = assistantMessage.content ?? "\u2705 (no text in response)";
      // Save memory to SQLite
      saveMessage(chatId, "user", userMessage);
      saveMessage(chatId, "assistant", finalResponse);
      return finalResponse;
    }

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      const tool = getTool(fnName);

      let result: string;
      if (!tool) {
        result = JSON.stringify({ error: "Unknown tool: " + fnName });
      } else {
        try {
          result = await tool.execute(fnArgs);
        } catch (err) {
          result = JSON.stringify({
            error: "Tool threw: " + (err instanceof Error ? err.message : String(err)),
          });
        }
      }

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return "\u26a0\ufe0f Reached maximum tool iterations. Please try again.";
}
