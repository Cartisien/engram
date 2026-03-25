/**
 * Core types for @cartisien/engram v0.7
 *
 * Memory is the trace that precedes presence.
 */

/** Memory tier - determines retention and consolidation policy */
export type MemoryTier = 'working' | 'long_term' | 'archived';

/** Role of the memory creator */
export type MemoryRole = 'user' | 'assistant' | 'system';

/**
 * Core memory entry structure
 */
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  role: MemoryRole;
  timestamp: Date;
  tier: MemoryTier;
  
  /** IDs of memories this was consolidated from (for long_term entries) */
  consolidatedFrom?: string[];
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  
  /** Semantic similarity score (0-1) when returned from recall */
  similarity?: number;
  
  /** Importance score (0-1) - v0.7 */
  importance?: number;
  
  /** Content hash for deduplication - v0.7 */
  contentHash: string;
  
  /** Embedding vector (stored as JSON string in DB) */
  embedding?: number[];
}

/**
 * User-scoped memory entry (cross-session persistence)
 */
export interface UserMemoryEntry {
  id: string;
  userId: string;
  content: string;
  role: MemoryRole;
  timestamp: Date;
  tier: MemoryTier;
  consolidatedFrom?: string[];
  metadata?: Record<string, unknown>;
  similarity?: number;
  importance?: number;
  /** Content hash for deduplication - v0.7 */
  contentHash: string;
  /** Embedding vector (stored as JSON string in DB) */
  embedding?: number[];
}

/**
 * Graph node representing an entity
 */
export interface GraphNode {
  entity: string;
  type?: string;
}

/**
 * Graph edge representing a relationship
 */
export interface GraphEdge {
  from: string;
  relation: string;
  to: string;
  confidence?: number;
  memoryId?: string;
}

/**
 * Result from graph query for a single entity
 */
export interface GraphResult {
  entity: string;
  relationships: Array<{
    type: 'outgoing' | 'incoming';
    relation: string;
    target: string;
    confidence?: number;
  }>;
  relatedMemories: MemoryEntry[];
}

/**
 * Path result for multi-hop graph traversal - v0.7
 */
export interface GraphPathResult {
  /** Whether a path was found */
  found: boolean;
  
  /** The path as an array of edges */
  path?: GraphEdge[];
  
  /** Number of hops in the path */
  hops?: number;
  
  /** Combined confidence score */
  confidence?: number;
  
  /** Memories connected to entities in the path */
  relatedMemories: MemoryEntry[];
}

/**
 * Options for recall operations
 */
export interface RecallOptions {
  /** Maximum results to return */
  limit?: number;
  
  /** Only return memories before this date */
  before?: Date;
  
  /** Only return memories after this date */
  after?: Date;
  
  /** Filter by role */
  role?: MemoryRole;
  
  /** Include graph-augmented results */
  includeGraph?: boolean;
  
  /** Tiers to search (default: ['working', 'long_term']) */
  tiers?: MemoryTier[];
  
  /** User ID for cross-session memory blending */
  userId?: string;
  
  /** Similarity threshold (0-1) for semantic search */
  threshold?: number;
  
  /** Apply recency decay scoring - v0.7 */
  applyDecay?: boolean;
  
  /** Boost factor for graph connections - v0.7 */
  graphBoost?: number;

  /** Apply cross-encoder reranking (default: false) */
  rerank?: boolean;
}

/**
 * Options for iterator-based recall - v0.7
 */
export interface RecallIterOptions extends RecallOptions {
  /** Chunk size for iteration */
  chunkSize?: number;
}

/**
 * Options for memory consolidation
 */
export interface ConsolidateOptions {
  /** Number of memories to process per batch */
  batch?: number;
  
  /** Number of most recent memories to preserve */
  keep?: number;
  
  /** Model to use for summarization */
  model?: string;
  
  /** Preview mode - don't write changes */
  dryRun?: boolean;
}

/**
 * Result from consolidation operation
 */
export interface ConsolidationResult {
  summarized: number;
  created: number;
  archived: number;
  previews?: string[];
}

/**
 * Configuration for Engram instance - v0.7 extended
 */
export interface EngramConfig {
  /** SQLite database file path (default: ':memory:') */
  dbPath?: string;
  
  /** Maximum characters per memory entry (default: 4000) */
  maxContextLength?: number;
  
  /** Ollama base URL (default: 'http://localhost:11434') */
  embeddingUrl?: string;
  
  /** Embedding model name (default: 'nomic-embed-text') */
  embeddingModel?: string;
  
  /** Enable semantic search (default: true) */
  semanticSearch?: boolean;
  
  /** Enable graph memory extraction (default: false) */
  graphMemory?: boolean;
  
  /** Model for graph extraction (default: 'qwen2.5:32b') */
  graphModel?: string;
  
  /** Auto-consolidate on threshold breach (default: false) */
  autoConsolidate?: boolean;
  
  /** Working memory threshold for auto-consolidation (default: 100) */
  consolidateThreshold?: number;
  
  /** Memories to preserve during consolidation (default: 20) */
  consolidateKeep?: number;
  
  /** Batch size for consolidation (default: 50) */
  consolidateBatch?: number;
  
  /** Model for consolidation (default: 'qwen2.5:32b') */
  consolidateModel?: string;
  
  // ===== v0.7 NEW OPTIONS =====
  
  /** LRU cache size for embeddings (default: 1000) */
  embeddingCacheSize?: number;
  
  /** Batch size for parallel embedding requests (default: 10) */
  embeddingBatchSize?: number;
  
  /** Similarity threshold for duplicate detection (default: 0.95) */
  dedupThreshold?: number;
  
  /** Enable LLM-based importance scoring on store (default: false) */
  enableImportanceScoring?: boolean;
  
  /** Half-life in days for recency decay (default: 30) */
  recencyHalfLifeDays?: number;
  
  /** Maximum depth for graph traversal (default: 3) */
  graphMaxDepth?: number;
  
  /** Enable FTS5 for keyword search (default: true) */
  enableFTS5?: boolean;
  
  /** Enable WAL mode for SQLite (default: true) */
  enableWAL?: boolean;

  /** Cross-encoder reranker service URL (default: undefined = disabled) */
  rerankerUrl?: string;

  /** Number of candidates to retrieve before reranking (default: 20) */
  rerankerTopK?: number;
}

/**
 * Statistics for a session's memory
 */
export interface SessionStats {
  total: number;
  byRole: Record<string, number>;
  byTier: Record<MemoryTier, number>;
  oldest: Date | null;
  newest: Date | null;
  withEmbeddings: number;
  graphNodes?: number;
  graphEdges?: number;
  /** Average importance score - v0.7 */
  avgImportance?: number;
}

/**
 * User memory statistics
 */
export interface UserStats {
  total: number;
  byRole: Record<string, number>;
  byTier: Record<MemoryTier, number>;
  oldest: Date | null;
  newest: Date | null;
  withEmbeddings: number;
  avgImportance?: number;
}

/**
 * Search result with hybrid scoring - v0.7
 */
export interface HybridSearchResult {
  memory: MemoryEntry;
  semanticScore: number;
  keywordScore: number;
  combinedScore: number;
  recencyBoost: number;
}

/**
 * Options for forgetting memories
 */
export interface ForgetOptions {
  /** Delete by specific ID */
  id?: string;
  
  /** Delete memories before this date */
  before?: Date;
  
  /** Include long_term memories in deletion */
  includeLongTerm?: boolean;
}

/**
 * Embedding cache entry - v0.7
 */
export interface EmbeddingCacheEntry {
  contentHash: string;
  embedding: number[];
  timestamp: number;
}
