import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions/completions.js";
import { chat, type Message } from "./llm.js";
import { getTool } from "./tools/registry.js";
import { saveMessage, getChatHistory, getFacts, getFeedbackSummary, getLatestJudgments, snapshotState, getLatestState } from "./db-provider.js";
import { rag } from "./rag-provider.js";
import { cachedSkills } from "./skills.js";
import { analyzeMessageForPatterns } from "./recommendations.js";
import { validateToolArgs } from "./utils/validation.js";

const MAX_ITERATIONS = 10;

// ── Patterns that indicate a short confirmation reply — skip RAG search ──
const RAG_SKIP_PATTERN = /^(ok|sim|não|nao|obrigado|valeu|entendi|certo|legal|show|beleza|blz|tudo bem|bom dia|boa tarde|boa noite|oi|olá|ola|opa|e aí|e a|claro|perfeito|s|n|ok!|sim!|combinado|perfeito!|maravilha|exato|exatamente)[\.!\?]?$/i;

// ── Read-only tools that are safe to run in parallel ──────────────────
const READ_ONLY_TOOLS = new Set([
  "get_current_time", "web_search", "browse_web", "search_core_memory",
  "trello_list_tasks", "supabase_query", "list_reminders", "finance_get_summary"
]);

// ── Critic Pass cache: (toolName+argsHash) -> approval, expires in 60s ─
const criticCache = new Map<string, { approved: boolean; expiresAt: number }>();
function hashArgs(args: any): string {
  const str = JSON.stringify(args);
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = (hash * 31 + str.charCodeAt(i)) >>> 0; }
  return hash.toString(36);
}

export interface AgentResult {
  text: string;
  media: {
    type: "image" | "audio" | "document";
    buffer: Buffer;
    caption?: string;
  }[];
}

export interface AgentOptions {
  skipCritic?: boolean;
}

export async function runAgent(
  chatId: string,
  userMessage: string,
  userId?: number,
  options?: AgentOptions
): Promise<AgentResult> {
  analyzeMessageForPatterns(chatId, userMessage);

  const history = (await getChatHistory(chatId, 24)) as Message[];
  const facts = await getFacts(chatId);
  const mentalState = await getLatestState(chatId);

  // Skip RAG for short confirmation replies to reduce latency
  let semanticFacts: string[] = [];
  const isConfirmation = RAG_SKIP_PATTERN.test(userMessage.trim());
  if (!isConfirmation) {
    try {
      semanticFacts = await rag.searchFacts(chatId, userMessage, 5);
    } catch (err) {
      console.warn("⚠️ Semantic search unavailable (Ollama offline?). Proceeding without RAG.");
    }
  }

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

CORE MEMORY (VAULT):
- You have a persistent memory vault (save_core_memory). Think of it like Obsidian folders.
- NEVER assume a category. If a user tells you a fact or preference, ask them: "Em qual pasta/categoria devo guardar isso? (Ex: Trabalho, Pessoal, Familia, Projetos)".
- If they specify the category, save it using save_core_memory.
- For retrieving facts and context, always use search_core_memory first before answering questions about the user's life.

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

      // Persist the user message and final response
      await saveMessage(chatId, "user", userMessage);
      await saveMessage(chatId, "assistant", finalResponse);

      if (finalResponse.length > 200) {
        await snapshotState(chatId, {
          last_interaction: new Date().toISOString(),
          summary: finalResponse.substring(0, 100) + "..."
        }, "Automatic interaction snapshot");
      }
      return { text: finalResponse, media: accumulatedMedia };
    }

    // ── Split into read-only (parallel) vs mutative (sequential) ────────
    const readOnlyCalls = toolCalls.filter((tc: ChatCompletionMessageFunctionToolCall) => READ_ONLY_TOOLS.has(tc.function.name));
    const mutativeCalls = toolCalls.filter((tc: ChatCompletionMessageFunctionToolCall) => !READ_ONLY_TOOLS.has(tc.function.name));
    const orderedCalls = [...readOnlyCalls, ...mutativeCalls];

    // Execute read-only tools in parallel, then run mutative ones sequentially after
    const resultsMap = new Map<string, string>();
    if (readOnlyCalls.length > 0) {
      const parallelResults = await Promise.allSettled(
        readOnlyCalls.map((tc: ChatCompletionMessageFunctionToolCall) => executeToolCall(tc, chatId, userId, accumulatedMedia, messages, options?.skipCritic))
      );
      parallelResults.forEach((r, i) => {
        resultsMap.set(readOnlyCalls[i].id, r.status === "fulfilled" ? r.value : JSON.stringify({ error: String((r as any).reason) }));
      });
    }
    for (const tc of mutativeCalls) {
      resultsMap.set(tc.id, await executeToolCall(tc, chatId, userId, accumulatedMedia, messages, options?.skipCritic));
    }

    // Reconstruct assistant message + tool results for history
    const toolCallAssistantMsg: Message = { role: "assistant", content: assistantMessage.content || null, tool_calls: toolCalls };
    messages.push(toolCallAssistantMsg as any);

    // Persist tool calls
    await saveMessage(chatId, "assistant", assistantMessage.content || "", { tool_calls: toolCalls });

    for (const tc of orderedCalls) {
      const result = resultsMap.get(tc.id) ?? "";
      const toolMsg: Message = { role: "tool" as const, tool_call_id: tc.id, content: result };
      messages.push(toolMsg);

      // Persist tool results
      await saveMessage(chatId, "tool", result, { tool_call_id: tc.id, name: tc.function.name });
    }
  }

  return { text: "⚠️ Limite máximo de iterações atingido.", media: accumulatedMedia };
}

// ── Tool execution helper ─────────────────────────────────────────────
async function executeToolCall(
  toolCall: ChatCompletionMessageFunctionToolCall,
  chatId: string,
  userId: number | undefined,
  accumulatedMedia: AgentResult["media"],
  _messages: Message[],
  skipCritic?: boolean
): Promise<string> {
  const fnName = toolCall.function.name;
  const fnArgs = (() => { try { return JSON.parse(toolCall.function.arguments || "{}"); } catch { return {}; } })();
  const tool = getTool(fnName);

  // ── CRITIC PASS with 60s cache ────────────────────────────────────
  const SENSITIVE_TOOLS = new Set(["trello_create_card", "trello_update_card", "trello_delete_card", "supabase_insert", "delete_reminder"]);
  if (SENSITIVE_TOOLS.has(fnName) && !skipCritic) {
    const cacheKey = `${fnName}:${hashArgs(fnArgs)}`;
    const cached = criticCache.get(cacheKey);
    const now = Date.now();

    if (!cached || cached.expiresAt < now) {
      console.log(`🔍 critic: Reviewing "${fnName}"...`);
      try {
        const criticPrompt = `CRITIC: Review this tool call. Current date/time: ${new Date().toISOString()}. Respond ONLY "APPROVED" or "REJECTED: [reason]".\nTOOL: ${fnName}\nARGS: ${JSON.stringify(fnArgs)}`;
        const reviewResponse = await chat([{ role: "user", content: criticPrompt }]);
        const reviewText = reviewResponse.choices[0].message.content || "";
        const approved = reviewText.toUpperCase().includes("APPROVED");
        criticCache.set(cacheKey, { approved, expiresAt: now + 60_000 });
        if (!approved) {
          console.warn(`🛑 critic rejected: ${reviewText}`);
          return JSON.stringify({ error: "CRITIC_REJECTION", message: reviewText });
        }
      } catch {
        console.warn("⚠️ Critic pass failed, proceeding...");
      }
    } else if (!cached.approved) {
      return JSON.stringify({ error: "CRITIC_REJECTION", message: "Previously rejected (cached)." });
    }
  }

  if (!tool) return JSON.stringify({ error: "Unknown tool: " + fnName });

  const validation = validateToolArgs(tool.parameters, fnArgs);
  if (!validation.valid) {
    console.warn(`🛑 Hallucination in "${fnName}": ${validation.error}`);
    return JSON.stringify({ error: "INVALID_ARGS", message: validation.error, accepted_parameters: tool.parameters });
  }

  try {
    const ctx = { chatId, userId };
    const rawResult = await tool.execute(fnArgs, ctx);
    if (typeof rawResult === "string") return rawResult;
    if (rawResult.media) accumulatedMedia.push(...rawResult.media);
    return rawResult.text;
  } catch (err) {
    return JSON.stringify({ error: "Tool threw: " + (err instanceof Error ? err.message : String(err)) });
  }
}

