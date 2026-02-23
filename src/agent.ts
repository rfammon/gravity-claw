import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions.js";
import { chat, type Message } from "./llm.js";
import { getTool } from "./tools/registry.js";
import { saveMessage, getChatHistory, getFacts, getFeedbackSummary, getLatestJudgments, snapshotState, getLatestState } from "./db-provider.js";
import { rag } from "./rag-provider.js";
import { cachedSkills } from "./skills.js";
import { analyzeMessageForPatterns } from "./recommendations.js";
import { validateToolArgs } from "./utils/validation.js";

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

  // 1. Get history from DB (limit to last 15 messages to save tokens and maintain concise context)
  const history = (await getChatHistory(chatId, 15)) as Message[];

  // 2. Add system prompt with facts
  const facts = await getFacts(chatId);
  const semanticFacts = await rag.searchFacts(chatId, userMessage, 5);
  const mentalState = await getLatestState(chatId);

  const factSummary = [
    ...Object.entries(facts).map(([k, v]) => `${k}: ${v}`),
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
ESTADO MENTAL (Sua consciência persistente):
${mentalState ? JSON.stringify(mentalState) : "Tabula rasa. Defina seus objetivos e humor iniciais."}

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
    if (!choice) return { text: "⚠️ No response from the model.", media: [] };

    const assistantMessage = choice.message;
    messages.push(assistantMessage as Message);

    const toolCalls = (assistantMessage.tool_calls ?? []).filter(
      (tc: any): tc is ChatCompletionMessageFunctionToolCall =>
        tc.type === "function"
    );

    if (toolCalls.length === 0) {
      const finalResponse = assistantMessage.content && assistantMessage.content.trim()
        ? assistantMessage.content
        : "✅ Operação finalizada.";
      // Save memory to DB (SQLite or Supabase)
      await saveMessage(chatId, "user", userMessage);
      await saveMessage(chatId, "assistant", finalResponse);

      // 3. Update Mental State (Versioning)
      // We'll use a lightweight approach: ask the agent to summarize its state if it changed.
      // For now, let's just snapshot the current context's "understanding" if the response was long.
      if (finalResponse.length > 200) {
        await snapshotState(chatId, {
          last_interaction: new Date().toISOString(),
          summary: finalResponse.substring(0, 100) + "..."
        }, "Automatic interaction snapshot");
      }

      return { text: finalResponse, media: accumulatedMedia };
    }

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      const tool = getTool(fnName);

      // ── CRITIC PASS (Self-Review for Sensitivity) ──────────
      const SENSITIVE_TOOLS = ["trello", "supabase_query", "delete_reminder"];
      if (SENSITIVE_TOOLS.includes(fnName)) {
        console.log(`🔍 critic: Reviewing high-stakes tool call "${fnName}"...`);
        const criticPrompt = `You are a strict REASONING CRITIC. 
Review the following proposed tool call for accuracy and safety.
TOOL: ${fnName}
ARGS: ${JSON.stringify(fnArgs, null, 2)}

If the tool call is perfect and safe, respond with "APPROVED".
If you see any hallucination, error, or safety risk, respond with a correction or "REJECTED: [reason]".`;

        try {
          const reviewResponse = await chat([
            ...messages,
            { role: "system", content: criticPrompt }
          ]);
          const reviewText = reviewResponse.choices[0].message.content || "";
          if (!reviewText.toUpperCase().includes("APPROVED")) {
            console.warn(`🛑 critic rejected tool call: ${reviewText}`);
            const resultText = JSON.stringify({
              error: "CRITIC_REJECTION",
              message: `The reasoning critic rejected this tool call: ${reviewText}. Please rethink your approach.`
            });
            // Skip execution and add to history
            messages.push({
              role: "assistant",
              content: null,
              tool_calls: [toolCall]
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: resultText
            });
            continue;
          }
        } catch (e) {
          console.warn("⚠️ Critic pass failed, proceeding with caution...");
        }
      }

      let resultText: string;
      if (!tool) {
        resultText = JSON.stringify({ error: "Unknown tool: " + fnName });
      } else {
        // Strict Validation Pass
        const validation = validateToolArgs(tool.parameters, fnArgs);
        if (!validation.valid) {
          console.warn(`🛑 Hallucination detected in tool call "${fnName}": ${validation.error}`);
          resultText = JSON.stringify({
            error: "HALUCINATION_PREVENTION_TRIGGERED",
            message: `Your tool call for "${fnName}" was invalid: ${validation.error}. Please correct the parameters and try again.`,
            accepted_parameters: tool.parameters
          });
        } else {
          try {
            const ctx = { chatId, userId };
            const rawResult = await tool.execute(fnArgs, ctx);
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
      }

      messages.push({
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: resultText,
      });
    }
  }

  const lastContent = messages[messages.length - 1]?.content;
  const finalText = lastContent && typeof lastContent === 'string' && lastContent.trim() ? lastContent : "⚠️ Operação finalizada.";
  return { text: finalText, media: accumulatedMedia };
}
