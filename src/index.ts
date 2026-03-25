/**
 * Engram v0.7 - Main Implementation
 * 
 * Persistent semantic memory for AI agents with:
 * - Embedding cache (LRU)
 * - FTS5 hybrid search
 * - Batch embedding
 * - Deduplication
 * - Importance scoring
 * - Recency decay
 * - Multi-hop graph traversal
 * - WAL mode
 */

import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { EmbeddingCache } from './cache/embedding-cache.js';
import { FTS5Search } from './search/fts5.js';
import {
  calculateRecencyBoost,
  calculateHybridScore,
  rankMemories,
  normalizeBM25,
  DEFAULT_WEIGHTS,
} from './search/hybrid.js';
import { rerank } from './search/reranker.js';
import { extractPropositions } from './search/propositions.js';
import { embedBatch } from './utils/batch.js';
import {
  cosineSimilarity,
  findSimilarInList,
  generateContentHash,
  deduplicateMemories,
} from './utils/dedup.js';
import { findPath, findNearbyEntities } from './graph/traversal.js';
import type {
  MemoryEntry,
  UserMemoryEntry,
  MemoryTier,
  MemoryRole,
  EngramConfig,
  RecallOptions,
  RecallIterOptions,
  ConsolidateOptions,
  ConsolidationResult,
  SessionStats,
  UserStats,
  ForgetOptions,
  GraphResult,
  GraphPathResult,
  GraphEdge,
  HybridSearchResult,
} from './types.js';

export * from './types.js';
export { EmbeddingCache } from './cache/embedding-cache.js';
export { FTS5Search } from './search/fts5.js';
export * from './search/hybrid.js';
export * from './utils/batch.js';
export * from './utils/dedup.js';
export * from './graph/traversal.js';
export { rerank, rerankerAvailable } from './search/reranker.js';
export { extractPropositions } from './search/propositions.js';
export type { Proposition } from './search/propositions.js';
export type { RerankerResult } from './search/reranker.js';

/**
 * Main Engram class - persistent semantic memory for AI agents
 */
export class Engram {
  private db: Database | null = null;
  private config: Required<EngramConfig>;
  private cache: EmbeddingCache;
  private fts5: FTS5Search | null = null;
  private initialized = false;

  // Default configuration
  private static readonly DEFAULT_CONFIG: Required<EngramConfig> = {
    dbPath: ':memory:',
    maxContextLength: 4000,
    embeddingUrl: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    semanticSearch: true,
    graphMemory: false,
    graphModel: 'qwen2.5:32b',
    autoConsolidate: false,
    consolidateThreshold: 100,
    consolidateKeep: 20,
    consolidateBatch: 50,
    consolidateModel: 'qwen2.5:32b',
    embeddingCacheSize: 1000,
    embeddingBatchSize: 10,
    dedupThreshold: 0.95,
    enableImportanceScoring: false,
    recencyHalfLifeDays: 30,
    graphMaxDepth: 3,
    enableFTS5: true,
    enableWAL: true,
    rerankerUrl: undefined as unknown as string,
    rerankerTopK: 20,
  };

  constructor(config: EngramConfig = {}) {
    this.config = { ...Engram.DEFAULT_CONFIG, ...config };
    this.cache = new EmbeddingCache({ maxSize: this.config.embeddingCacheSize });
  }

  /**
   * Initialize the database and create tables
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Open database with WAL mode if enabled
    this.db = await open({
      filename: this.config.dbPath,
      driver: sqlite3.Database,
    });

    // Enable WAL mode for better concurrency
    if (this.config.enableWAL) {
      await this.db.exec('PRAGMA journal_mode = WAL');
      await this.db.exec('PRAGMA synchronous = NORMAL');
    }

    // Enable foreign keys
    await this.db.exec('PRAGMA foreign_keys = ON');

    // Create tables
    await this.createTables();

    // Initialize FTS5
    this.fts5 = new FTS5Search(this.db, this.config.enableFTS5);
    await this.fts5.init();

    this.initialized = true;
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Main memories table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'working',
        content_hash TEXT NOT NULL,
        embedding TEXT,
        importance REAL DEFAULT 0.5,
        metadata TEXT,
        consolidated_from TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User memories table (cross-session)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'working',
        content_hash TEXT NOT NULL,
        embedding TEXT,
        importance REAL DEFAULT 0.5,
        metadata TEXT,
        consolidated_from TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Graph edges table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        from_entity TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        memory_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
      )
    `);

    // Indexes
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edges_session ON graph_edges(session_id)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_entity)`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_entity)`);
  }

  /**
   * Generate embedding for text using Ollama
   */
  async embed(text: string): Promise<number[] | null> {
    const trimmed = text.slice(0, this.config.maxContextLength);
    const contentHash = generateContentHash(trimmed);

    // Check cache first
    const cached = this.cache.get(contentHash);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(`${this.config.embeddingUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.embeddingModel,
          prompt: trimmed,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding failed: ${response.statusText}`);
      }

      const data = await response.json() as { embedding?: number[] };
      const embedding = data.embedding;

      if (embedding) {
        this.cache.set(contentHash, embedding);
      }

      return embedding ?? null;
    } catch (error) {
      console.error('[Engram] Embedding error:', error);
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    return embedBatch(
      texts,
      (text) => this.embed(text),
      this.config.embeddingBatchSize
    );
  }

  /**
   * Calculate importance score for content (0-1)
   */
  private async calculateImportance(content: string): Promise<number> {
    // Fast-path heuristics
    const lowerContent = content.toLowerCase();
    const importantKeywords = ['remember', 'important', 'critical', 'key', 'essential', 'note', 'fact'];
    const keywordMatches = importantKeywords.filter(kw => lowerContent.includes(kw)).length;
    
    let score = 0.5; // Base score
    score += keywordMatches * 0.05; // Boost for keywords
    score += Math.min(content.length / 2000, 0.2); // Slight boost for longer content

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Store a memory entry
   */
  async remember(
    sessionId: string,
    content: string,
    role: MemoryRole = 'assistant',
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const trimmed = content.slice(0, this.config.maxContextLength);
    const contentHash = generateContentHash(trimmed);
    const id = crypto.randomUUID();
    const timestamp = new Date();

    // Check for duplicates if semantic search is enabled
    if (this.config.semanticSearch) {
      const similar = await this.findSimilarByHash(sessionId, contentHash, trimmed);
      if (similar.length > 0) {
        const best = similar[0]!;
        if (best.similarity >= this.config.dedupThreshold) {
          return best.memory;
        }
      }
    }

    // Generate embedding
    let embedding: number[] | null = null;
    if (this.config.semanticSearch) {
      embedding = await this.embed(trimmed);
    }

    // Calculate importance
    let importance = 0.5;
    if (this.config.enableImportanceScoring) {
      importance = await this.calculateImportance(trimmed);
    }

    const entry: MemoryEntry = {
      id,
      sessionId,
      content: trimmed,
      role,
      timestamp,
      tier: 'working',
      contentHash,
      embedding: embedding ?? undefined,
      importance,
      metadata,
    };

    // Store in database
    await this.db.run(
      `INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash, embedding, importance, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.sessionId,
        entry.content,
        entry.role,
        entry.timestamp.toISOString(),
        entry.tier,
        entry.contentHash,
        embedding ? JSON.stringify(embedding) : null,
        entry.importance,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    // Extract graph if enabled
    if (this.config.graphMemory) {
      await this.extractGraph(sessionId, entry.id, trimmed);
    }

    // Extract and store propositions as shadow entries
    if (this.config.semanticSearch) {
      const props = extractPropositions(trimmed);
      for (const propText of props) {
        if (propText === trimmed) continue; // Skip if identical to parent
        const propHash = generateContentHash(propText);
        const propId = crypto.randomUUID();
        const propEmbedding = await this.embed(propText);
        await this.db.run(
          `INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash, embedding, importance, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            propId,
            sessionId,
            propText,
            role,
            timestamp.toISOString(),
            'working',
            propHash,
            propEmbedding ? JSON.stringify(propEmbedding) : null,
            importance,
            JSON.stringify({ parentId: entry.id, type: 'proposition' }),
          ]
        );
        // FTS5 is auto-indexed via triggers on INSERT
      }
    }

    return entry;
  }

  /**
   * Find similar memories by content hash and embedding
   */
  private async findSimilarByHash(
    sessionId: string,
    contentHash: string,
    content: string,
    threshold?: number
  ): Promise<Array<{ memory: MemoryEntry; similarity: number }>> {
    if (!this.db) return [];

    // First check exact hash match
    const exact = await this.db.get(
      `SELECT * FROM memories WHERE session_id = ? AND content_hash = ? AND tier != 'archived'`,
      [sessionId, contentHash]
    );

    if (exact) {
      return [{
        memory: this.rowToMemory(exact),
        similarity: 1.0,
      }];
    }

    // Check embedding similarity
    const embedding = await this.embed(content);
    if (!embedding) return [];

    const rows = await this.db.all(
      `SELECT * FROM memories WHERE session_id = ? AND tier != 'archived' AND embedding IS NOT NULL LIMIT 100`,
      [sessionId]
    );

    const memories = rows.map(r => this.rowToMemory(r));
    return findSimilarInList(embedding, memories, threshold ?? this.config.dedupThreshold);
  }

  /**
   * Convert database row to MemoryEntry
   */
  private rowToMemory(row: any): MemoryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier,
      contentHash: row.content_hash,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      importance: row.importance ?? 0.5,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      consolidatedFrom: row.consolidated_from ? JSON.parse(row.consolidated_from) : undefined,
    };
  }

  /**
   * Convert database row to UserMemoryEntry
   */
  private rowToUserMemory(row: any): UserMemoryEntry {
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier,
      contentHash: row.content_hash,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      importance: row.importance ?? 0.5,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      consolidatedFrom: row.consolidated_from ? JSON.parse(row.consolidated_from) : undefined,
    };
  }

  /**
   * Recall memories based on query with hybrid scoring
   */
  async recall(
    sessionId: string,
    query?: string,
    options: RecallOptions = {}
  ): Promise<MemoryEntry[]> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const {
      limit = 10,
      before,
      after,
      role,
      tiers = ['working', 'long_term'],
      threshold = 0.7,
      applyDecay = true,
    } = options;

    let memories: MemoryEntry[] = [];
    let keywordResults: Map<string, number> = new Map();

    // If query provided, use hybrid search
    if (query && query.trim()) {
      // Get keyword search results from FTS5
      if (this.fts5?.isEnabled()) {
        const ftsResults = await this.fts5.search(sessionId, query, limit * 2);
        for (const result of ftsResults) {
          keywordResults.set(result.memoryId, normalizeBM25(result.rank));
        }
      }

      // Get semantic search results
      if (this.config.semanticSearch) {
        const queryEmbedding = await this.embed(query);
        if (queryEmbedding) {
          const placeholders = tiers.map(() => '?').join(',');
          const rows = await this.db.all(
            `SELECT * FROM memories 
             WHERE session_id = ? AND tier IN (${placeholders}) AND embedding IS NOT NULL`,
            [sessionId, ...tiers]
          );

          const scored = rows.map(row => {
            const memory = this.rowToMemory(row);
            const embedding = JSON.parse(row.embedding);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            return { memory, similarity };
          }).filter(({ similarity }) => similarity >= threshold);

          // Combine with keyword results
          const combined: Array<{ memory: MemoryEntry; semanticScore: number; keywordScore: number }> = [];
          
          for (const { memory, similarity } of scored) {
            const keywordScore = keywordResults.get(memory.id) ?? 0;
            combined.push({ memory, semanticScore: similarity, keywordScore });
          }

          // Add memories that only appeared in keyword search
          for (const [memoryId, keywordScore] of keywordResults) {
            const exists = combined.find(c => c.memory.id === memoryId);
            if (!exists) {
              const row = await this.db.get(`SELECT * FROM memories WHERE id = ?`, [memoryId]);
              if (row) {
                combined.push({
                  memory: this.rowToMemory(row),
                  semanticScore: 0,
                  keywordScore,
                });
              }
            }
          }

          // Rank using hybrid scoring
          const ranked = rankMemories(
            combined,
            DEFAULT_WEIGHTS,
            new Date(),
            applyDecay ? this.config.recencyHalfLifeDays : undefined
          );

          memories = ranked.map(r => r.memory);

          // Cross-encoder reranking (if enabled)
          if (options.rerank && this.config.rerankerUrl && memories.length > 1) {
            const topK = this.config.rerankerTopK ?? 20;
            const candidates = memories.slice(0, topK);
            const reranked = await rerank(
              query,
              candidates.map(m => m.content),
              this.config.rerankerUrl,
              topK
            );
            if (reranked) {
              const reordered = reranked.map(r => candidates[r.index]);
              // Append any memories beyond topK that weren't reranked
              memories = [...reordered, ...memories.slice(topK)];
            }
          }
        }
      } else {
        // Keyword only search
        const memoryIds = Array.from(keywordResults.keys());
        if (memoryIds.length > 0) {
          const placeholders = memoryIds.map(() => '?').join(',');
          const rows = await this.db.all(
            `SELECT * FROM memories WHERE id IN (${placeholders})`,
            memoryIds
          );
          memories = rows.map(r => this.rowToMemory(r));
        }
      }
    } else {
      // No query - return recent memories
      const placeholders = tiers.map(() => '?').join(',');
      let sql = `SELECT * FROM memories WHERE session_id = ? AND tier IN (${placeholders})`;
      const params: any[] = [sessionId, ...tiers];

      if (before) {
        sql += ` AND timestamp < ?`;
        params.push(before.toISOString());
      }
      if (after) {
        sql += ` AND timestamp > ?`;
        params.push(after.toISOString());
      }
      if (role) {
        sql += ` AND role = ?`;
        params.push(role);
      }

      sql += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      const rows = await this.db.all(sql, params);
      memories = rows.map(r => this.rowToMemory(r));
    }

    // Apply filters
    if (before) {
      memories = memories.filter(m => m.timestamp < before);
    }
    if (after) {
      memories = memories.filter(m => m.timestamp > after);
    }
    if (role) {
      memories = memories.filter(m => m.role === role);
    }

    return memories.slice(0, limit);
  }

  /**
   * Iterator-based recall for large result sets
   */
  async *recallIter(
    sessionId: string,
    query?: string,
    options: RecallIterOptions = {}
  ): AsyncGenerator<MemoryEntry> {
    const { chunkSize = 10 } = options;
    let offset = 0;

    while (true) {
      const results = await this.recall(sessionId, query, {
        ...options,
        limit: chunkSize,
      });

      if (results.length === 0) break;

      for (const memory of results) {
        yield memory;
      }

      if (results.length < chunkSize) break;
      offset += chunkSize;
    }
  }

  /**
   * Query graph for a single entity
   */
  async graph(sessionId: string, entity: string): Promise<GraphResult> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const normalizedEntity = entity.toLowerCase().trim();

    // Get outgoing relationships
    const outgoing = await this.db.all(
      `SELECT * FROM graph_edges WHERE session_id = ? AND from_entity = ?`,
      [sessionId, normalizedEntity]
    );

    // Get incoming relationships
    const incoming = await this.db.all(
      `SELECT * FROM graph_edges WHERE session_id = ? AND to_entity = ?`,
      [sessionId, normalizedEntity]
    );

    // Build relationships list
    const relationships: GraphResult['relationships'] = [];

    for (const row of outgoing) {
      relationships.push({
        type: 'outgoing',
        relation: row.relation,
        target: row.to_entity,
        confidence: row.confidence,
      });
    }

    for (const row of incoming) {
      relationships.push({
        type: 'incoming',
        relation: row.relation,
        target: row.from_entity,
        confidence: row.confidence,
      });
    }

    // Get related memories
    const memoryIds = [...outgoing, ...incoming]
      .map(r => r.memory_id)
      .filter((id): id is string => !!id);

    let relatedMemories: MemoryEntry[] = [];
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = await this.db.all(
        `SELECT * FROM memories WHERE id IN (${placeholders})`,
        memoryIds
      );
      relatedMemories = rows.map(r => this.rowToMemory(r));
    }

    return {
      entity: normalizedEntity,
      relationships,
      relatedMemories,
    };
  }

  /**
   * Find path between two entities (multi-hop)
   */
  async graphPath(
    sessionId: string,
    from: string,
    to: string,
    maxDepth?: number
  ): Promise<GraphPathResult> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return findPath(this.db, sessionId, from, to, maxDepth ?? this.config.graphMaxDepth);
  }

  /**
   * Extract graph entities and relationships from content
   */
  private async extractGraph(sessionId: string, memoryId: string, content: string): Promise<void> {
    const entityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const entities = content.match(entityPattern) || [];

    for (let i = 0; i < entities.length - 1; i++) {
      const from = entities[i]!.toLowerCase().trim();
      const to = entities[i + 1]!.toLowerCase().trim();
      
      if (from !== to) {
        await this.storeEdge(sessionId, from, 'related_to', to, 0.5, memoryId);
      }
    }
  }

  /**
   * Store a graph edge
   */
  async storeEdge(
    sessionId: string,
    from: string,
    relation: string,
    to: string,
    confidence = 1.0,
    memoryId?: string
  ): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      `INSERT INTO graph_edges (session_id, from_entity, relation, to_entity, confidence, memory_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, from.toLowerCase().trim(), relation, to.toLowerCase().trim(), confidence, memoryId]
    );
  }

  /**
   * Consolidate working memories into long_term
   */
  async consolidate(
    sessionId: string,
    options: ConsolidateOptions = {}
  ): Promise<ConsolidationResult> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const { keep = 20, dryRun = false } = options;

    const rows = await this.db.all(
      `SELECT * FROM memories 
       WHERE session_id = ? AND tier = 'working'
       ORDER BY timestamp DESC`,
      [sessionId]
    );

    const memories = rows.map(r => this.rowToMemory(r));

    if (memories.length <= keep) {
      return { summarized: 0, created: 0, archived: 0 };
    }

    const toConsolidate = memories.slice(keep);
    const consolidatedFrom = toConsolidate.map(m => m.id);

    if (dryRun) {
      return {
        summarized: toConsolidate.length,
        created: 1,
        archived: toConsolidate.length,
        previews: [`Would consolidate ${toConsolidate.length} memories`],
      };
    }

    const summaryContent = toConsolidate
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    const summaryEmbedding = this.config.semanticSearch ? await this.embed(summaryContent) : null;
    const id = crypto.randomUUID();

    await this.db.run(
      `INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash, embedding, importance, consolidated_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        summaryContent,
        'system',
        new Date().toISOString(),
        'long_term',
        generateContentHash(summaryContent),
        summaryEmbedding ? JSON.stringify(summaryEmbedding) : null,
        0.7,
        JSON.stringify(consolidatedFrom),
      ]
    );

    for (const memory of toConsolidate) {
      await this.db.run(
        `UPDATE memories SET tier = 'archived' WHERE id = ?`,
        [memory.id]
      );
    }

    return {
      summarized: toConsolidate.length,
      created: 1,
      archived: toConsolidate.length,
    };
  }

  /**
   * Get session statistics
   */
  async stats(sessionId: string): Promise<SessionStats> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const total = await this.db.get(
      `SELECT COUNT(*) as count FROM memories WHERE session_id = ?`,
      [sessionId]
    );

    const byRole = await this.db.all(
      `SELECT role, COUNT(*) as count FROM memories WHERE session_id = ? GROUP BY role`,
      [sessionId]
    );

    const byTier = await this.db.all(
      `SELECT tier, COUNT(*) as count FROM memories WHERE session_id = ? GROUP BY tier`,
      [sessionId]
    );

    const oldest = await this.db.get(
      `SELECT MIN(timestamp) as timestamp FROM memories WHERE session_id = ?`,
      [sessionId]
    );

    const newest = await this.db.get(
      `SELECT MAX(timestamp) as timestamp FROM memories WHERE session_id = ?`,
      [sessionId]
    );

    const withEmbeddings = await this.db.get(
      `SELECT COUNT(*) as count FROM memories WHERE session_id = ? AND embedding IS NOT NULL`,
      [sessionId]
    );

    const avgImportance = await this.db.get(
      `SELECT AVG(importance) as avg FROM memories WHERE session_id = ?`,
      [sessionId]
    );

    const graphNodes = await this.db.get(
      `SELECT COUNT(DISTINCT from_entity) as count FROM graph_edges WHERE session_id = ?`,
      [sessionId]
    );

    const graphEdges = await this.db.get(
      `SELECT COUNT(*) as count FROM graph_edges WHERE session_id = ?`,
      [sessionId]
    );

    return {
      total: total?.count ?? 0,
      byRole: Object.fromEntries(byRole.map((r: any) => [r.role, r.count])),
      byTier: {
        working: byTier.find((t: any) => t.tier === 'working')?.count ?? 0,
        long_term: byTier.find((t: any) => t.tier === 'long_term')?.count ?? 0,
        archived: byTier.find((t: any) => t.tier === 'archived')?.count ?? 0,
      },
      oldest: oldest?.timestamp ? new Date(oldest.timestamp) : null,
      newest: newest?.timestamp ? new Date(newest.timestamp) : null,
      withEmbeddings: withEmbeddings?.count ?? 0,
      graphNodes: graphNodes?.count ?? 0,
      graphEdges: graphEdges?.count ?? 0,
      avgImportance: avgImportance?.avg ?? 0.5,
    };
  }

  /**
   * Delete memories
   */
  async forget(sessionId: string, options: ForgetOptions = {}): Promise<number> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (options.id) {
      const result = await this.db.run(
        `DELETE FROM memories WHERE session_id = ? AND id = ?`,
        [sessionId, options.id]
      );
      return result.changes ?? 0;
    }

    if (options.before) {
      const tiers = options.includeLongTerm 
        ? ['working', 'long_term', 'archived'] 
        : ['working', 'archived'];
      const placeholders = tiers.map(() => '?').join(',');
      
      const result = await this.db.run(
        `DELETE FROM memories 
         WHERE session_id = ? AND timestamp < ? AND tier IN (${placeholders})`,
        [sessionId, options.before.toISOString(), ...tiers]
      );
      return result.changes ?? 0;
    }

    return 0;
  }

  // ===== User Memory Methods =====

  /**
   * Store user-scoped memory (cross-session)
   */
  async rememberUser(
    userId: string,
    content: string,
    role: MemoryRole = 'user',
    metadata?: Record<string, unknown>
  ): Promise<UserMemoryEntry> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const trimmed = content.slice(0, this.config.maxContextLength);
    const contentHash = generateContentHash(trimmed);
    const id = crypto.randomUUID();
    const timestamp = new Date();

    let embedding: number[] | null = null;
    if (this.config.semanticSearch) {
      embedding = await this.embed(trimmed);
    }

    let importance = 0.5;
    if (this.config.enableImportanceScoring) {
      importance = await this.calculateImportance(trimmed);
    }

    const entry: UserMemoryEntry = {
      id,
      userId,
      content: trimmed,
      role,
      timestamp,
      tier: 'working',
      contentHash,
      embedding: embedding ?? undefined,
      importance,
      metadata,
    };

    await this.db.run(
      `INSERT INTO user_memories (id, user_id, content, role, timestamp, tier, content_hash, embedding, importance, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.userId,
        entry.content,
        entry.role,
        entry.timestamp.toISOString(),
        entry.tier,
        entry.contentHash,
        embedding ? JSON.stringify(embedding) : null,
        entry.importance,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    return entry;
  }

  /**
   * Recall user-scoped memories
   */
  async recallUser(
    userId: string,
    query?: string,
    options: RecallOptions = {}
  ): Promise<UserMemoryEntry[]> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const {
      limit = 10,
      before,
      after,
      role,
      tiers = ['working', 'long_term'],
      threshold = 0.7,
    } = options;

    let memories: UserMemoryEntry[] = [];

    if (query && query.trim() && this.config.semanticSearch) {
      const queryEmbedding = await this.embed(query);
      if (queryEmbedding) {
        const placeholders = tiers.map(() => '?').join(',');
        const rows = await this.db.all(
          `SELECT * FROM user_memories 
           WHERE user_id = ? AND tier IN (${placeholders}) AND embedding IS NOT NULL`,
          [userId, ...tiers]
        );

        const scored = rows.map(row => {
          const memory = this.rowToUserMemory(row);
          const embedding = JSON.parse(row.embedding);
          const similarity = cosineSimilarity(queryEmbedding, embedding);
          return { memory, similarity };
        })
        .filter(({ similarity }) => similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);

        memories = scored.map(s => s.memory);
      }
    } else {
      const placeholders = tiers.map(() => '?').join(',');
      let sql = `SELECT * FROM user_memories WHERE user_id = ? AND tier IN (${placeholders})`;
      const params: any[] = [userId, ...tiers];

      if (before) {
        sql += ` AND timestamp < ?`;
        params.push(before.toISOString());
      }
      if (after) {
        sql += ` AND timestamp > ?`;
        params.push(after.toISOString());
      }
      if (role) {
        sql += ` AND role = ?`;
        params.push(role);
      }

      sql += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      const rows = await this.db.all(sql, params);
      memories = rows.map(r => this.rowToUserMemory(r));
    }

    return memories.slice(0, limit);
  }

  /**
   * Get user memory statistics
   */
  async recallUserStats(userId: string): Promise<UserStats> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const total = await this.db.get(
      `SELECT COUNT(*) as count FROM user_memories WHERE user_id = ?`,
      [userId]
    );

    const byRole = await this.db.all(
      `SELECT role, COUNT(*) as count FROM user_memories WHERE user_id = ? GROUP BY role`,
      [userId]
    );

    const byTier = await this.db.all(
      `SELECT tier, COUNT(*) as count FROM user_memories WHERE user_id = ? GROUP BY tier`,
      [userId]
    );

    const oldest = await this.db.get(
      `SELECT MIN(timestamp) as timestamp FROM user_memories WHERE user_id = ?`,
      [userId]
    );

    const newest = await this.db.get(
      `SELECT MAX(timestamp) as timestamp FROM user_memories WHERE user_id = ?`,
      [userId]
    );

    const withEmbeddings = await this.db.get(
      `SELECT COUNT(*) as count FROM user_memories WHERE user_id = ? AND embedding IS NOT NULL`,
      [userId]
    );

    const avgImportance = await this.db.get(
      `SELECT AVG(importance) as avg FROM user_memories WHERE user_id = ?`,
      [userId]
    );

    return {
      total: total?.count ?? 0,
      byRole: Object.fromEntries(byRole.map((r: any) => [r.role, r.count])),
      byTier: {
        working: byTier.find((t: any) => t.tier === 'working')?.count ?? 0,
        long_term: byTier.find((t: any) => t.tier === 'long_term')?.count ?? 0,
        archived: byTier.find((t: any) => t.tier === 'archived')?.count ?? 0,
      },
      oldest: oldest?.timestamp ? new Date(oldest.timestamp) : null,
      newest: newest?.timestamp ? new Date(newest.timestamp) : null,
      withEmbeddings: withEmbeddings?.count ?? 0,
      avgImportance: avgImportance?.avg ?? 0.5,
    };
  }

  /**
   * Delete user memories
   */
  async forgetUser(userId: string, options: ForgetOptions = {}): Promise<number> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (options.id) {
      const result = await this.db.run(
        `DELETE FROM user_memories WHERE user_id = ? AND id = ?`,
        [userId, options.id]
      );
      return result.changes ?? 0;
    }

    if (options.before) {
      const tiers = options.includeLongTerm 
        ? ['working', 'long_term', 'archived'] 
        : ['working', 'archived'];
      const placeholders = tiers.map(() => '?').join(',');
      
      const result = await this.db.run(
        `DELETE FROM user_memories 
         WHERE user_id = ? AND timestamp < ? AND tier IN (${placeholders})`,
        [userId, options.before.toISOString(), ...tiers]
      );
      return result.changes ?? 0;
    }

    return 0;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}
