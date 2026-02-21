import { registerTool } from "./registry.js";
import {
  analyzeMessageForPatterns,
  generateRecommendations,
  generateAIRecommendation,
  getPendingRecommendations,
  markRecommendationShown,
  recordRecommendationFeedback,
  getRecommendationStats,
  getPatterns,
  cleanupOldPatterns,
  type PatternType
} from "../recommendations.js";

registerTool({
  name: "analyze_patterns",
  description: "Analyze the user's message for behavior patterns (topics, time, commands). Call this implicitly when the user sends a message to track patterns for proactive recommendations.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" },
      message: { type: "string", description: "The message to analyze" }
    },
    required: ["chatId", "message"]
  },
  execute: async ({ chatId, message }) => {
    analyzeMessageForPatterns(String(chatId), String(message));
    return JSON.stringify({ status: "analyzed", messageLength: String(message).length });
  }
});

registerTool({
  name: "get_recommendations",
  description: "Generate smart proactive recommendations based on tracked behavior patterns. Use this to suggest actions before the user asks.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" }
    },
    required: ["chatId"]
  },
  execute: async ({ chatId }) => {
    const recommendations = await generateRecommendations(String(chatId));
    return JSON.stringify({
      count: recommendations.length,
      recommendations: recommendations.map(r => ({
        id: r.id,
        text: r.recommendation,
        reason: r.reason,
        priority: r.priority
      }))
    });
  }
});

registerTool({
  name: "get_ai_recommendation",
  description: "Use AI to generate a context-aware proactive recommendation based on deep pattern analysis. More sophisticated than get_recommendations.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" }
    },
    required: ["chatId"]
  },
  execute: async ({ chatId }) => {
    const recommendation = await generateAIRecommendation(String(chatId));
    return JSON.stringify({
      hasRecommendation: !!recommendation,
      recommendation: recommendation || "No proactive suggestion at this time."
    });
  }
});

registerTool({
  name: "get_pattern_stats",
  description: "Get statistics about tracked behavior patterns for a user. Shows top topics, active hours, and pending recommendations.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" }
    },
    required: ["chatId"]
  },
  execute: async ({ chatId }) => {
    const stats = getRecommendationStats(String(chatId));
    return JSON.stringify(stats, null, 2);
  }
});

registerTool({
  name: "show_pending_recommendations",
  description: "Get pending recommendations that haven't been shown to the user yet.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" },
      limit: { type: "number", description: "Max number of recommendations to return", default: 3 }
    },
    required: ["chatId"]
  },
  execute: async ({ chatId, limit }) => {
    const recommendations = getPendingRecommendations(String(chatId), Number(limit) || 3);
    
    recommendations.forEach(r => markRecommendationShown(r.id));
    
    return JSON.stringify({
      count: recommendations.length,
      recommendations: recommendations.map(r => ({
        id: r.id,
        text: r.recommendation,
        reason: r.reason
      }))
    });
  }
});

registerTool({
  name: "feedback_recommendation",
  description: "Record user feedback on a recommendation (accepted, dismissed, or helpful). Used for improving future recommendations.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" },
      recommendationId: { type: "number", description: "The ID of the recommendation" },
      action: { type: "string", enum: ["accepted", "dismissed", "helpful"], description: "The user's action" }
    },
    required: ["chatId", "recommendationId", "action"]
  },
  execute: async ({ chatId, recommendationId, action }) => {
    recordRecommendationFeedback(String(chatId), Number(recommendationId), String(action) as any);
    return JSON.stringify({ status: "recorded", action: String(action) });
  }
});

registerTool({
  name: "view_patterns",
  description: "View raw behavior patterns for debugging or analysis.",
  parameters: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "The chat ID of the user" },
      patternType: { 
        type: "string", 
        enum: ["topic_frequency", "time_pattern", "command_usage", "finance_pattern", "task_pattern", "communication_style"],
        description: "Optional filter by pattern type"
      }
    },
    required: ["chatId"]
  },
  execute: async ({ chatId, patternType }) => {
    const patterns = getPatterns(String(chatId), patternType as PatternType | undefined);
    return JSON.stringify({
      count: patterns.length,
      patterns: patterns.slice(0, 20)
    });
  }
});

registerTool({
  name: "cleanup_old_patterns",
  description: "Remove behavior patterns older than specified days. Useful for keeping the database clean.",
  parameters: {
    type: "object",
    properties: {
      daysOld: { type: "number", description: "Remove patterns older than this many days", default: 90 }
    },
    required: []
  },
  execute: async ({ daysOld }) => {
    cleanupOldPatterns(Number(daysOld) || 90);
    return JSON.stringify({ status: "cleaned", daysOld: Number(daysOld) || 90 });
  }
});

console.log("🔧 Registered recommendation tools: analyze_patterns, get_recommendations, get_ai_recommendation, get_pattern_stats, show_pending_recommendations, feedback_recommendation, view_patterns, cleanup_old_patterns");
