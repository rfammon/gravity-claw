import { randomUUID } from "crypto";

export interface SessionMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
}

export interface AgentSession {
    id: string;
    agentType: string;
    history: SessionMessage[];
    createdAt: number;
    updatedAt: number;
}

export class SessionManager {
    private sessions: Map<string, AgentSession> = new Map();

    createSession(agentType: string, initialSystemPrompt?: string): string {
        const id = randomUUID().split("-")[0]; // Short intuitive ID
        const session: AgentSession = {
            id,
            agentType,
            history: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        if (initialSystemPrompt) {
            session.history.push({ role: "system", content: initialSystemPrompt });
        }

        this.sessions.set(id, session);
        console.log(`🧠 [SessionManager] Created new session '${id}' for agent '${agentType}'`);
        return id;
    }

    getSession(id: string): AgentSession | undefined {
        return this.sessions.get(id);
    }

    listSessions(): Array<{ id: string, agentType: string, updatedAt: number }> {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            agentType: s.agentType,
            updatedAt: s.updatedAt
        })).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    appendMessage(id: string, message: SessionMessage): void {
        const session = this.sessions.get(id);
        if (session) {
            session.history.push(message);
            session.updatedAt = Date.now();
        } else {
            throw new Error(`Session ${id} not found.`);
        }
    }

    deleteSession(id: string): boolean {
        return this.sessions.delete(id);
    }
}

export const sessionManager = new SessionManager();
