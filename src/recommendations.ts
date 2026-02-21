import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { chat, type Message } from "./llm.js";
import { getChatHistory, getFacts } from "./db-provider.js";

const GRAVITY_DIR = path.join(os.homedir(), ".gravity_claw");
if (!fs.existsSync(GRAVITY_DIR)) fs.mkdirSync(GRAVITY_DIR, { recursive: true });
const DB_PATH = path.join(GRAVITY_DIR, "patterns.sqlite");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS behavior_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    pattern_key TEXT NOT NULL,
    pattern_value TEXT,
    occurrence_count INTEGER DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    UNIQUE(chat_id, pattern_type, pattern_key)
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    reason TEXT,
    priority INTEGER DEFAULT 0,
    shown BOOLEAN DEFAULT 0,
    shown_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    recommendation_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export type PatternType = 
  | "topic_frequency"
  | "time_pattern"
  | "command_usage"
  | "finance_pattern"
  | "task_pattern"
  | "communication_style";

export interface BehaviorPattern {
  patternType: PatternType;
  patternKey: string;
  patternValue?: string;
  metadata?: Record<string, unknown>;
}

export interface Recommendation {
  id: number;
  recommendation: string;
  reason: string;
  priority: number;
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  finance: ["dinheiro", "gasto", "receita", "mercado", "compra", "venda", "pix", "cartão", "boleto", "saldo", "invest", "ação", "crypto"],
  tasks: ["tarefa", "task", "fazer", "lembrete", "agenda", "compromisso", "reunião", "projeto"],
  trello: ["trello", "board", "card", "lista", "kanban"],
  code: ["código", "code", "script", "programa", "função", "bug", "erro", "deploy"],
  learning: ["aprender", "estudar", "curso", "livro", "tutorial"],
  health: ["saúde", "exercício", "academia", "medicamento", "consulta"],
  work: ["trabalho", "cliente", "entrega", "prazo", "deadline"],
};

export function trackPattern(chatId: string, pattern: BehaviorPattern): void {
  const stmt = db.prepare(`
    INSERT INTO behavior_patterns (chat_id, pattern_type, pattern_key, pattern_value, metadata)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, pattern_type, pattern_key) 
    DO UPDATE SET 
      occurrence_count = occurrence_count + 1,
      last_seen = CURRENT_TIMESTAMP,
      pattern_value = excluded.pattern_value,
      metadata = excluded.metadata
  `);
  
  stmt.run(
    chatId,
    pattern.patternType,
    pattern.patternKey,
    pattern.patternValue || null,
    pattern.metadata ? JSON.stringify(pattern.metadata) : null
  );
}

export function analyzeMessageForPatterns(chatId: string, message: string): void {
  const lowerMsg = message.toLowerCase();
  const hour = new Date().getHours();
  
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lowerMsg.includes(kw))) {
      trackPattern(chatId, {
        patternType: "topic_frequency",
        patternKey: topic,
        patternValue: String(hour),
        metadata: { messageLength: message.length }
      });
    }
  }
  
  trackPattern(chatId, {
    patternType: "time_pattern",
    patternKey: `hour_${hour}`,
    metadata: { dayOfWeek: new Date().getDay() }
  });
  
  if (lowerMsg.startsWith("/")) {
    const cmd = lowerMsg.split(" ")[0];
    trackPattern(chatId, {
      patternType: "command_usage",
      patternKey: cmd
    });
  }
  
  const financeMatch = lowerMsg.match(/(?:gastei|comprei|paguei|recebi|ganhei)\s+(?:r?\$?\s*)?(\d+)/);
  if (financeMatch) {
    trackPattern(chatId, {
      patternType: "finance_pattern",
      patternKey: "transaction",
      patternValue: financeMatch[1],
      metadata: { type: lowerMsg.includes("gastei") || lowerMsg.includes("paguei") ? "expense" : "income" }
    });
  }
}

export function getPatterns(chatId: string, patternType?: PatternType): BehaviorPattern[] {
  let query = "SELECT * FROM behavior_patterns WHERE chat_id = ?";
  const params: any[] = [chatId];
  
  if (patternType) {
    query += " AND pattern_type = ?";
    params.push(patternType);
  }
  
  query += " ORDER BY occurrence_count DESC LIMIT 50";
  
  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  
  return rows.map(row => ({
    patternType: row.pattern_type as PatternType,
    patternKey: row.pattern_key,
    patternValue: row.pattern_value,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined
  }));
}

export function getTopTopics(chatId: string, limit: number = 5): string[] {
  const stmt = db.prepare(`
    SELECT pattern_key, SUM(occurrence_count) as total
    FROM behavior_patterns 
    WHERE chat_id = ? AND pattern_type = 'topic_frequency'
    GROUP BY pattern_key
    ORDER BY total DESC
    LIMIT ?
  `);
  
  const rows = stmt.all(chatId, limit) as { pattern_key: string }[];
  return rows.map(r => r.pattern_key);
}

export function getActiveHours(chatId: string): number[] {
  const stmt = db.prepare(`
    SELECT pattern_key, SUM(occurrence_count) as total
    FROM behavior_patterns 
    WHERE chat_id = ? AND pattern_type = 'time_pattern' AND pattern_key LIKE 'hour_%'
    GROUP BY pattern_key
    ORDER BY total DESC
    LIMIT 5
  `);
  
  const rows = stmt.all(chatId) as { pattern_key: string }[];
  return rows.map(r => parseInt(r.pattern_key.replace("hour_", "")));
}

export async function generateRecommendations(chatId: string): Promise<Recommendation[]> {
  const patterns = getPatterns(chatId);
  const topTopics = getTopTopics(chatId);
  const activeHours = getActiveHours(chatId);
  const facts = await getFacts(chatId);
  const history = await getChatHistory(chatId, 30);
  
  const recommendations: Recommendation[] = [];
  
  if (topTopics.includes("finance") && !facts["last_finance_review"]) {
    recommendations.push({
      id: 0,
      recommendation: "Que tal fazermos um resumo financeiro? Você tem falado muito sobre gastos recentemente.",
      reason: "Alta frequência de tópicos financeiros sem revisão recente",
      priority: 8
    });
  }
  
  if (topTopics.includes("tasks") || topTopics.includes("trello")) {
    recommendations.push({
      id: 0,
      recommendation: "Posso verificar suas tarefas pendentes e sugerir prioridades para hoje?",
      reason: "Padrão recorrente de gestão de tarefas",
      priority: 7
    });
  }
  
  if (activeHours.length > 0 && activeHours[0] >= 8 && activeHours[0] <= 10) {
    recommendations.push({
      id: 0,
      recommendation: "Bom dia! Quer que eu prepare um briefing do seu dia?",
      reason: "Padrão de uso matinal detectado",
      priority: 9
    });
  }
  
  if (activeHours.length > 0 && activeHours[0] >= 18 && activeHours[0] <= 21) {
    recommendations.push({
      id: 0,
      recommendation: "Boa noite! Quer um resumo do que fizemos hoje?",
      reason: "Padrão de uso noturno detectado",
      priority: 8
    });
  }
  
  if (topTopics.includes("health") && !facts["last_health_check"]) {
    recommendations.push({
      id: 0,
      recommendation: "Você tem mencionado saúde. Já bebeu água hoje? Posso criar lembretes!",
      reason: "Interesse em saúde sem acompanhamento estruturado",
      priority: 6
    });
  }
  
  if (topTopics.includes("learning")) {
    recommendations.push({
      id: 0,
      recommendation: "Tenho notado seu interesse em aprender. Quer que eu pesquise recursos sobre o tema?",
      reason: "Padrão de aprendizado ativo",
      priority: 5
    });
  }
  
  if (recommendations.length === 0 && topTopics.length > 0) {
    recommendations.push({
      id: 0,
      recommendation: `Vejo que você tem focado em ${topTopics[0]}. Como posso ajudar mais nessa área?`,
      reason: "Personalização baseada em interesses detectados",
      priority: 4
    });
  }
  
  return recommendations.sort((a, b) => b.priority - a.priority);
}

export async function generateAIRecommendation(chatId: string): Promise<string | null> {
  const patterns = getPatterns(chatId);
  const topTopics = getTopTopics(chatId);
  const history = await getChatHistory(chatId, 50);
  
  if (patterns.length < 10) {
    return null;
  }
  
  const recentTopics = patterns
    .filter(p => p.patternType === "topic_frequency")
    .slice(0, 5)
    .map(p => `${p.patternKey} (${p.patternValue}h)`)
    .join(", ");
  
  const systemPrompt: Message = {
    role: "system",
    content: `Você é o Megamente sugerindo uma ação PROATIVA para o usuário.
Analise os padrões e sugira UMA ação específica e útil.

TÓPICOS FREQUENTES: ${recentTopics}
HISTÓRICO RECENTE: ${history.slice(-5).map(h => h.content.substring(0, 100)).join(" | ")}

Regras:
- Seja específico e acionável
- Use português brasileiro
- Seja dramático mas útil
- Máximo 2 frases
- Se não houver padrão claro, responda apenas "SKIP"`
  };
  
  try {
    const response = await chat([systemPrompt]);
    const suggestion = response.choices[0]?.message?.content?.trim();
    
    if (suggestion && suggestion !== "SKIP") {
      saveRecommendation(chatId, suggestion, "AI-generated pattern analysis", 7);
      return suggestion;
    }
  } catch (err) {
    console.error("⚠️ AI recommendation generation failed:", err);
  }
  
  return null;
}

export function saveRecommendation(chatId: string, recommendation: string, reason: string, priority: number = 5): number {
  const stmt = db.prepare(`
    INSERT INTO recommendations (chat_id, recommendation, reason, priority)
    VALUES (?, ?, ?, ?)
  `);
  
  const result = stmt.run(chatId, recommendation, reason, priority);
  return Number(result.lastInsertRowid);
}

export function getPendingRecommendations(chatId: string, limit: number = 3): Recommendation[] {
  const stmt = db.prepare(`
    SELECT id, recommendation, reason, priority
    FROM recommendations
    WHERE chat_id = ? AND shown = 0
    ORDER BY priority DESC, created_at DESC
    LIMIT ?
  `);
  
  return stmt.all(chatId, limit) as Recommendation[];
}

export function markRecommendationShown(recommendationId: number): void {
  const stmt = db.prepare(`
    UPDATE recommendations 
    SET shown = 1, shown_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(recommendationId);
}

export function recordRecommendationFeedback(chatId: string, recommendationId: number, action: "accepted" | "dismissed" | "helpful"): void {
  const stmt = db.prepare(`
    INSERT INTO recommendation_feedback (chat_id, recommendation_id, action)
    VALUES (?, ?, ?)
  `);
  stmt.run(chatId, recommendationId, action);
}

export function cleanupOldPatterns(daysOld: number = 90): void {
  const stmt = db.prepare(`
    DELETE FROM behavior_patterns 
    WHERE last_seen < datetime('now', '-' || ? || ' days')
  `);
  stmt.run(daysOld);
  console.log("🧹 Cleaned up old behavior patterns");
}

export function getRecommendationStats(chatId: string): {
  totalPatterns: number;
  topTopics: string[];
  activeHours: number[];
  pendingRecommendations: number;
} {
  const patterns = db.prepare("SELECT COUNT(*) as count FROM behavior_patterns WHERE chat_id = ?").get(chatId) as { count: number };
  const pending = db.prepare("SELECT COUNT(*) as count FROM recommendations WHERE chat_id = ? AND shown = 0").get(chatId) as { count: number };
  
  return {
    totalPatterns: patterns.count,
    topTopics: getTopTopics(chatId),
    activeHours: getActiveHours(chatId),
    pendingRecommendations: pending.count
  };
}
