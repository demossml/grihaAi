import type {
  MemoryFact,
  SearchResult,
  SessionMessage,
  SessionId,
  ProjectId,
  BotId,
  SharedInsight,
} from "../../../src/types/index.js";

export interface MemoryService {
  init(dbPath: string): Promise<void>;
  addFact(fact: Omit<MemoryFact, "id" | "createdAt" | "updatedAt">): Promise<MemoryFact>;
  search(
    query: string,
    options?: { limit?: number; projectId?: ProjectId; category?: string; botId?: BotId },
  ): Promise<SearchResult[]>;
  deleteFact(id: string): Promise<boolean>;
  addMessage(msg: Omit<SessionMessage, "id" | "createdAt">): Promise<SessionMessage>;
  getSessionMessages(sessionId: SessionId, limit?: number): Promise<SessionMessage[]>;
  searchSessions(
    query: string,
    options?: { limit?: number; projectId?: ProjectId; botId?: BotId },
  ): Promise<SearchResult[]>;
  listRecentFacts(limit?: number, projectId?: ProjectId): Promise<MemoryFact[]>;
  getEmbedding(id: string): Promise<Float32Array | null>;
  reembedMissing(): Promise<number>;
  addInsight(insight: Omit<SharedInsight, "id" | "createdAt">): Promise<SharedInsight>;
  searchInsights(
    query: string,
    options?: { limit?: number; projectId?: string },
  ): Promise<SearchResult[]>;
  listRecentInsights(limit?: number, projectId?: string): Promise<SharedInsight[]>;
  close(): Promise<void>;
}
