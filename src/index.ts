import { createHash } from 'crypto';
import { open, Database as SQLiteDatabase } from 'sqlite';

export type MemoryTier = 'working' | 'long_term' | 'archived';

export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  tier: MemoryTier;
  consolidatedFrom?: string[];  // v0.4: source IDs for long_term entries
  importance: number;           // v0.8: 0.0–1.0, higher = more important
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export interface GraphNode {
  entity: string;
  type?: string;
}

export interface GraphEdge {
  from: string;
  relation: string;
  to: string;
  confidence?: number;
}

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

export interface RecallOptions {
  limit?: number;
  before?: Date;
  after?: Date;
  role?: 'user' | 'assistant' | 'system';
  includeGraph?: boolean;
  tiers?: MemoryTier[];  // v0.4: which tiers to search (default: ['working', 'long_term'])
  userId?: string;       // v0.5: also blend in user-scoped memories
}

// v0.5: User-scoped memory — persists across sessions
export interface UserMemoryEntry {
  id: string;
  userId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  tier: MemoryTier;
  consolidatedFrom?: string[];
  importance: number;           // v0.8: 0.0–1.0
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export interface ConsolidateOptions {
  batch?: number;         // how many working memories to consolidate (default: 50)
  keep?: number;          // keep N most recent working memories untouched (default: 20)
  model?: string;         // LLM model to use (overrides config)
  dryRun?: boolean;       // preview what would be consolidated without writing
}

export interface ConsolidationResult {
  summarized: number;     // working memories processed
  created: number;        // long_term summaries created
  archived: number;       // originals archived
  previews?: string[];    // only set on dryRun: the summary strings that would be stored
}

export interface EngramConfig {
  dbPath?: string;
  maxContextLength?: number;
  embeddingUrl?: string;
  embeddingModel?: string;
  semanticSearch?: boolean;
  graphMemory?: boolean;
  graphModel?: string;
  // v0.4: consolidation
  autoConsolidate?: boolean;       // auto-trigger consolidation on remember() (default: false)
  consolidateThreshold?: number;   // trigger when working memories exceed this (default: 100)
  consolidateKeep?: number;        // keep N most recent working memories as-is (default: 20)
  consolidateBatch?: number;       // process N memories per consolidation run (default: 50)
  consolidateModel?: string;       // Ollama model for summarization (default: qwen2.5:32b)
  // v0.8: importance scoring
  importanceScoring?: boolean;     // score importance at write time via LLM (default: false)
  importanceModel?: string;        // Ollama model for scoring (default: same as graphModel)
  importanceThreshold?: number;    // memories at/above this are protected from consolidation (default: 0.8)
}

/**
 * Engram - Persistent semantic memory for AI agents
 *
 * v0.4 adds memory consolidation — working memories are periodically
 * summarized into long-term memories by a local LLM, keeping context
 * dense and relevant as conversations grow.
 *
 * @example
 * ```typescript
 * import { Engram } from '@cartisien/engram';
 *
 * const memory = new Engram({
 *   dbPath: './memory.db',
 *   autoConsolidate: true,
 *   consolidateThreshold: 100,
 * });
 *
 * // Manual consolidation
 * const result = await memory.consolidate('session_1');
 * // → { summarized: 50, created: 4, archived: 50 }
 * ```
 */
export class Engram {
  private db!: SQLiteDatabase;
  private maxContextLength: number;
  private dbPath: string;
  private initialized: boolean = false;
  private embeddingUrl: string;
  private embeddingModel: string;
  private semanticSearch: boolean;
  private graphMemory: boolean;
  private graphModel: string;
  private autoConsolidate: boolean;
  private consolidateThreshold: number;
  private consolidateKeep: number;
  private consolidateBatch: number;
  private consolidateModel: string;
  private importanceScoring: boolean;
  private importanceModel: string;
  private importanceThreshold: number;

  constructor(config: EngramConfig = {}) {
    this.dbPath = config.dbPath || ':memory:';
    this.maxContextLength = config.maxContextLength || 4000;
    this.embeddingUrl = config.embeddingUrl || 'http://192.168.68.73:11434';
    this.embeddingModel = config.embeddingModel || 'nomic-embed-text';
    this.semanticSearch = config.semanticSearch !== false;
    this.graphMemory = config.graphMemory === true;
    this.graphModel = config.graphModel || 'qwen2.5:32b';
    this.autoConsolidate = config.autoConsolidate === true;
    this.consolidateThreshold = config.consolidateThreshold ?? 100;
    this.consolidateKeep = config.consolidateKeep ?? 20;
    this.consolidateBatch = config.consolidateBatch ?? 50;
    this.consolidateModel = config.consolidateModel || config.graphModel || 'qwen2.5:32b';
    this.importanceScoring = config.importanceScoring === true;
    this.importanceModel = config.importanceModel || config.graphModel || 'qwen2.5:32b';
    this.importanceThreshold = config.importanceThreshold ?? 0.8;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;

    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    // Memories table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        tier TEXT NOT NULL DEFAULT 'working',
        consolidated_from TEXT
      );
    `);

    // Migrations for existing databases
    const migrations = [
      `ALTER TABLE memories ADD COLUMN embedding TEXT`,
      `ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'working'`,
      `ALTER TABLE memories ADD COLUMN consolidated_from TEXT`,
      `ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5`,
    ];
    for (const m of migrations) {
      try { await this.db.exec(m); } catch { /* column exists */ }
    }

    // v0.3: Graph tables
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        type TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_node_entity
        ON graph_nodes(session_id, entity);
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        from_entity TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        memory_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edge_from
        ON graph_edges(session_id, from_entity);
      CREATE INDEX IF NOT EXISTS idx_edge_to
        ON graph_edges(session_id, to_entity);
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_timestamp
      ON memories(session_id, timestamp DESC);
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_tier
      ON memories(session_id, tier);
    `);

    // v0.5: User-scoped memories (cross-session)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        tier TEXT NOT NULL DEFAULT 'working',
        consolidated_from TEXT,
        importance REAL NOT NULL DEFAULT 0.5
      );
      CREATE INDEX IF NOT EXISTS idx_user_timestamp
        ON user_memories(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_user_tier
        ON user_memories(user_id, tier);
    `);

    this.initialized = true;
  }

  private async embed(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${this.embeddingUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return null;
      const data = await response.json() as { embedding: number[] };
      return data.embedding ?? null;
    } catch {
      return null;
    }
  }

  private async extractGraph(text: string): Promise<GraphEdge[]> {
    const prompt = `Extract entity-relationship triples from this text. Return ONLY a JSON array of objects with keys: "from", "relation", "to". Be concise. Max 5 triples. If nothing to extract, return [].

Text: "${text}"

JSON array:`;

    try {
      const response = await fetch(`${this.embeddingUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.graphModel,
          prompt,
          stream: false,
          options: { temperature: 0, num_predict: 200 }
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return [];
      const data = await response.json() as { response: string };
      const raw = data.response.trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const triples = JSON.parse(match[0]) as Array<{ from: string; relation: string; to: string }>;
      return triples
        .filter(t => t.from && t.relation && t.to)
        .map(t => ({
          from: t.from.toLowerCase().trim(),
          relation: t.relation.toLowerCase().trim(),
          to: t.to.toLowerCase().trim(),
          confidence: 0.9
        }));
    } catch {
      return [];
    }
  }

  private async upsertNode(sessionId: string, entity: string, type?: string): Promise<void> {
    const id = createHash('sha256').update(`${sessionId}:${entity}`).digest('hex').slice(0, 16);
    await this.db.run(
      `INSERT OR IGNORE INTO graph_nodes (id, session_id, entity, type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, entity, type || null, Date.now()]
    );
  }

  private async storeEdge(sessionId: string, edge: GraphEdge, memoryId: string): Promise<void> {
    const id = createHash('sha256')
      .update(`${sessionId}:${edge.from}:${edge.relation}:${edge.to}`)
      .digest('hex').slice(0, 16);
    await this.upsertNode(sessionId, edge.from);
    await this.upsertNode(sessionId, edge.to);
    await this.db.run(
      `INSERT OR REPLACE INTO graph_edges
       (id, session_id, from_entity, relation, to_entity, confidence, memory_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, edge.from, edge.relation, edge.to, edge.confidence ?? 1.0, memoryId, Date.now()]
    );
  }

  /**
   * v0.8: Heuristic importance scorer — instant, no LLM needed.
   * Signals: preferences/decisions/goals → high; small talk → low.
   */
  private scoreImportanceHeuristic(content: string): number {
    const text = content.toLowerCase();
    let score = 0.5;

    // High-signal phrases
    const highSignal = [
      'prefer', 'always', 'never', 'important', 'remember', 'critical',
      'must', 'need to', 'goal', 'decision', 'decided', 'agreed', 'confirmed',
      'password', 'api key', 'token', 'secret', 'deadline', 'due',
    ];
    // Low-signal phrases
    const lowSignal = [
      'thanks', 'thank you', 'ok', 'okay', 'sure', 'got it', 'sounds good',
      'hello', 'hi', 'hey', 'bye', 'goodbye', 'lol', 'haha',
    ];

    const highMatches = highSignal.filter(s => text.includes(s)).length;
    const lowMatches  = lowSignal.filter(s => text.includes(s)).length;

    score += highMatches * 0.08;
    score -= lowMatches * 0.08;

    // Dates and numbers → specificity → higher importance
    const datePattern = /\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
    if (datePattern.test(content)) score += 0.07;
    if (/\$[\d,]+|\d+%|\b\d{4,}\b/.test(content)) score += 0.05;

    // Longer = more specific = probably more important
    if (content.length > 200) score += 0.05;
    if (content.length < 30)  score -= 0.05;

    return Math.min(1.0, Math.max(0.0, Math.round(score * 100) / 100));
  }

  /**
   * v0.8: LLM importance scorer. Falls back to heuristic on failure.
   */
  private async scoreImportanceLLM(content: string): Promise<number> {
    const prompt = `Rate the importance of this memory for an AI agent on a scale from 0.0 to 1.0.

High (0.8–1.0): user preferences, decisions, goals, constraints, credentials, deadlines, facts.
Medium (0.4–0.7): context, background info, situational details.
Low (0.0–0.3): casual remarks, pleasantries, obvious or temporary info.

Return ONLY a decimal number between 0.0 and 1.0. Nothing else.

Memory: "${content.slice(0, 300)}"`;

    try {
      const response = await fetch(`${this.embeddingUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.importanceModel,
          prompt,
          stream: false,
          options: { temperature: 0, num_predict: 8 }
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return this.scoreImportanceHeuristic(content);
      const data = await response.json() as { response: string };
      const match = data.response.trim().match(/^(1\.0|0?\.\d+|\d+\.\d+)/);
      if (!match) return this.scoreImportanceHeuristic(content);
      const score = parseFloat(match[1] ?? '0');
      return isNaN(score) ? this.scoreImportanceHeuristic(content)
                          : Math.min(1.0, Math.max(0.0, Math.round(score * 100) / 100));
    } catch {
      return this.scoreImportanceHeuristic(content);
    }
  }

  private async scoreImportance(content: string): Promise<number> {
    return this.importanceScoring
      ? this.scoreImportanceLLM(content)
      : this.scoreImportanceHeuristic(content);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      magA += (a[i] ?? 0) * (a[i] ?? 0);
      magB += (b[i] ?? 0) * (b[i] ?? 0);
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Call LLM to summarize a batch of memories into consolidated entries.
   * Returns an array of summary strings (typically 2-5 per batch).
   */
  private async summarizeMemories(
    entries: MemoryEntry[],
    model: string
  ): Promise<string[]> {
    const numbered = entries
      .map((e, i) => `[${i + 1}] (${e.role}) ${e.content}`)
      .join('\n');

    const prompt = `You are a memory consolidation system. Given these conversation memories, produce 2-5 concise summary entries that preserve all important facts: names, dates, decisions, preferences, and technical details. Each summary should be a single dense sentence or short paragraph. Return ONLY a JSON array of strings.

Memories:
${numbered}

JSON array of summary strings:`;

    try {
      const response = await fetch(`${this.embeddingUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 800 }
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) return [];
      const data = await response.json() as { response: string };
      const raw = data.response.trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const summaries = JSON.parse(match[0]) as string[];
      return summaries.filter(s => typeof s === 'string' && s.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * v0.4: Consolidate working memories into long-term summaries.
   *
   * Takes the oldest `batch` working memories (excluding the `keep` most recent),
   * summarizes them via LLM, stores summaries as `long_term` tier, and archives
   * the originals.
   *
   * @example
   * ```typescript
   * const result = await memory.consolidate('session_1');
   * // → { summarized: 50, created: 4, archived: 50 }
   *
   * // Preview without writing
   * const preview = await memory.consolidate('session_1', { dryRun: true });
   * // → { summarized: 50, created: 0, archived: 0, previews: ['...', '...'] }
   * ```
   */
  async consolidate(
    sessionId: string,
    options: ConsolidateOptions = {}
  ): Promise<ConsolidationResult> {
    await this.init();

    const batch = options.batch ?? this.consolidateBatch;
    const keep = options.keep ?? this.consolidateKeep;
    const model = options.model ?? this.consolidateModel;

    // Fetch working memories oldest-first, excluding the N most recent
    // v0.8: also exclude high-importance memories (they survive consolidation)
    const rows = await this.db.all(
      `SELECT id, session_id, content, role, timestamp, metadata, tier, consolidated_from, importance
       FROM memories
       WHERE session_id = ? AND tier = 'working' AND importance < ?
       ORDER BY timestamp ASC
       LIMIT ?`,
      [sessionId, this.importanceThreshold, batch + keep]
    );

    // Drop the most recent `keep` entries — leave them as working memory
    const candidates = rows.slice(0, Math.max(0, rows.length - keep));

    if (candidates.length === 0) {
      return { summarized: 0, created: 0, archived: 0 };
    }

    const entries: MemoryEntry[] = candidates.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier as MemoryTier,
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));

    // Get summaries from LLM
    const summaries = await this.summarizeMemories(entries, model);

    if (summaries.length === 0) {
      return { summarized: entries.length, created: 0, archived: 0 };
    }

    if (options.dryRun) {
      return {
        summarized: entries.length,
        created: 0,
        archived: 0,
        previews: summaries
      };
    }

    const sourceIds = entries.map(e => e.id);
    const consolidatedFromJson = JSON.stringify(sourceIds);

    // Store each summary as a long_term memory
    for (const summary of summaries) {
      const id = createHash('sha256')
        .update(`${sessionId}:lt:${summary}:${Date.now()}`)
        .digest('hex').slice(0, 16);
      const contentHash = createHash('sha256').update(summary).digest('hex').slice(0, 16);

      // Embed the summary
      let embeddingJson: string | null = null;
      if (this.semanticSearch) {
        const vector = await this.embed(summary);
        if (vector) embeddingJson = JSON.stringify(vector);
      }

      await this.db.run(
        `INSERT INTO memories
         (id, session_id, content, role, timestamp, metadata, content_hash, embedding, tier, consolidated_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'long_term', ?)`,
        [id, sessionId, summary.slice(0, this.maxContextLength), 'system',
         Date.now(), null, contentHash, embeddingJson, consolidatedFromJson]
      );
    }

    // Archive the originals
    const placeholders = sourceIds.map(() => '?').join(',');
    await this.db.run(
      `UPDATE memories SET tier = 'archived' WHERE id IN (${placeholders})`,
      sourceIds
    );

    return {
      summarized: entries.length,
      created: summaries.length,
      archived: entries.length
    };
  }

  /**
   * Store a memory entry. With autoConsolidate enabled, triggers consolidation
   * when working memory count exceeds the configured threshold.
   */
  async remember(
    sessionId: string,
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    await this.init();

    const id = createHash('sha256')
      .update(`${sessionId}:${content}:${Date.now()}`)
      .digest('hex').slice(0, 16);

    const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const truncated = content.slice(0, this.maxContextLength);

    let embeddingJson: string | null = null;
    if (this.semanticSearch) {
      const vector = await this.embed(truncated);
      if (vector) embeddingJson = JSON.stringify(vector);
    }

    const importance = await this.scoreImportance(truncated);

    const entry: MemoryEntry = {
      id, sessionId, content: truncated, role,
      timestamp: new Date(), tier: 'working', importance,
      ...(metadata !== undefined && { metadata })
    };

    await this.db.run(
      `INSERT INTO memories
       (id, session_id, content, role, timestamp, metadata, content_hash, embedding, tier, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
      [id, sessionId, truncated, role, entry.timestamp.getTime(),
       metadata ? JSON.stringify(metadata) : null, contentHash, embeddingJson, importance]
    );

    // v0.3: Extract graph relationships
    if (this.graphMemory) {
      const edges = await this.extractGraph(truncated);
      for (const edge of edges) {
        await this.storeEdge(sessionId, edge, id);
      }
    }

    // v0.4: Auto-consolidate if threshold exceeded
    if (this.autoConsolidate) {
      const countRow = await this.db.get(
        `SELECT COUNT(*) as count FROM memories WHERE session_id = ? AND tier = 'working'`,
        [sessionId]
      );
      if ((countRow?.count ?? 0) > this.consolidateThreshold) {
        // Fire-and-forget — don't block the caller
        this.consolidate(sessionId).catch(() => {});
      }
    }

    return entry;
  }

  /**
   * Recall memories. Searches working and long_term tiers by default.
   * Archived memories (consolidated originals) are excluded unless explicitly requested.
   */
  async recall(
    sessionId: string,
    query?: string,
    limit: number = 10,
    options: RecallOptions = {}
  ): Promise<MemoryEntry[]> {
    await this.init();

    const tiers = options.tiers ?? ['working', 'long_term'];
    const tierPlaceholders = tiers.map(() => '?').join(',');

    let sql = `
      SELECT id, session_id, content, role, timestamp, metadata, embedding, tier, consolidated_from, importance
      FROM memories WHERE session_id = ? AND tier IN (${tierPlaceholders})
    `;
    const params: (string | number)[] = [sessionId, ...tiers];

    if (options.role) { sql += ` AND role = ?`; params.push(options.role); }
    if (options.after) { sql += ` AND timestamp >= ?`; params.push(options.after.getTime()); }
    if (options.before) { sql += ` AND timestamp <= ?`; params.push(options.before.getTime()); }

    const mapRow = (row: any, similarity?: number): MemoryEntry => {
      const entry: MemoryEntry = {
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        role: row.role,
        timestamp: new Date(row.timestamp),
        tier: row.tier as MemoryTier,
        importance: typeof row.importance === 'number' ? row.importance : 0.5,
      };
      if (row.consolidated_from) entry.consolidatedFrom = JSON.parse(row.consolidated_from);
      if (row.metadata) entry.metadata = JSON.parse(row.metadata);
      if (similarity !== undefined) entry.similarity = similarity;
      return entry;
    };

    // Semantic search
    if (query && query.trim() && this.semanticSearch) {
      const queryVector = await this.embed(query);
      if (queryVector) {
        const rows = await this.db.all(sql + ` ORDER BY timestamp DESC`, params);
        const scored = rows
          .map((row: any) => {
            let similarity = 0;
            if (row.embedding) {
              try {
                similarity = this.cosineSimilarity(queryVector, JSON.parse(row.embedding));
              } catch { /* skip */ }
            }
            const importance = typeof row.importance === 'number' ? row.importance : 0.5;
            // v0.8: blend similarity + importance for ranking
            const rankScore = similarity * 0.7 + importance * 0.3;
            return { row, similarity, rankScore };
          })
          .sort((a, b) => b.rankScore - a.rankScore)
          .slice(0, limit);

        const results = scored.map(({ row, similarity }) => mapRow(row, similarity));


        if (this.graphMemory && options.includeGraph !== false) {
          const graphAugmented = await this.augmentWithGraph(sessionId, results, limit);
          return this.blendUserMemories(graphAugmented, options.userId, query, limit);
        }
        return this.blendUserMemories(results, options.userId, query, limit);
      }
    }

    // Keyword fallback
    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      if (keywords.length > 0) {
        sql += ` AND (` + keywords.map(() => `LOWER(content) LIKE ?`).join(' OR ') + `)`;
        params.push(...keywords.map(k => `%${k}%`));
      }
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, params);
    const results = rows.map((row: any) => mapRow(row));
    return this.blendUserMemories(results, options.userId, query, limit);
  }

  /**
   * Blend user-scoped memories into session recall results.
   * User memories are appended after session results (deduplicated by content).
   */
  private async blendUserMemories(
    sessionResults: MemoryEntry[],
    userId: string | undefined,
    query: string | undefined,
    limit: number
  ): Promise<MemoryEntry[]> {
    if (!userId) return sessionResults;

    const userEntries = await this.recallUser(userId, query, Math.ceil(limit / 2));
    const seenContent = new Set(sessionResults.map(r => r.content));

    const blended: MemoryEntry[] = [...sessionResults];
    for (const u of userEntries) {
      if (!seenContent.has(u.content)) {
        // Adapt UserMemoryEntry to MemoryEntry shape for unified return
        const adapted: MemoryEntry = {
          id: u.id,
          sessionId: `user:${u.userId}`,
          content: u.content,
          role: u.role,
          timestamp: u.timestamp,
          tier: u.tier,
          importance: u.importance,
          metadata: { ...(u.metadata ?? {}), _userMemory: true, userId: u.userId },
        };
        if (u.consolidatedFrom) adapted.consolidatedFrom = u.consolidatedFrom;
        if (u.similarity !== undefined) adapted.similarity = u.similarity;
        blended.push(adapted);
      }
    }

    return blended.slice(0, limit);
  }

  private async augmentWithGraph(
    sessionId: string,
    results: MemoryEntry[],
    limit: number
  ): Promise<MemoryEntry[]> {
    const seenIds = new Set(results.map(r => r.id));
    const graphMemoryIds = new Set<string>();

    for (const result of results.slice(0, 3)) {
      const edges = await this.db.all(
        `SELECT memory_id FROM graph_edges WHERE session_id = ? AND memory_id IS NOT NULL
         AND (from_entity IN (
           SELECT from_entity FROM graph_edges WHERE memory_id = ?
           UNION SELECT to_entity FROM graph_edges WHERE memory_id = ?
         ))
         LIMIT 5`,
        [sessionId, result.id, result.id]
      );
      for (const edge of edges) {
        if (edge.memory_id && !seenIds.has(edge.memory_id)) {
          graphMemoryIds.add(edge.memory_id);
        }
      }
    }

    if (graphMemoryIds.size === 0) return results;

    const placeholders = Array.from(graphMemoryIds).map(() => '?').join(',');
    const connectedRows = await this.db.all(
      `SELECT id, session_id, content, role, timestamp, metadata, tier, consolidated_from, importance
       FROM memories WHERE id IN (${placeholders})`,
      Array.from(graphMemoryIds)
    );

    const connected: MemoryEntry[] = connectedRows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier as MemoryTier,
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
      consolidatedFrom: row.consolidated_from ? JSON.parse(row.consolidated_from) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      similarity: 0
    }));

    return [...results, ...connected].slice(0, limit);
  }

  async graph(sessionId: string, entity: string): Promise<GraphResult> {
    await this.init();
    const ent = entity.toLowerCase().trim();

    const outgoing = await this.db.all(
      `SELECT relation, to_entity, confidence, memory_id FROM graph_edges
       WHERE session_id = ? AND from_entity = ?`,
      [sessionId, ent]
    );
    const incoming = await this.db.all(
      `SELECT relation, from_entity, confidence, memory_id FROM graph_edges
       WHERE session_id = ? AND to_entity = ?`,
      [sessionId, ent]
    );

    const relationships = [
      ...outgoing.map((e: any) => ({
        type: 'outgoing' as const,
        relation: e.relation,
        target: e.to_entity,
        confidence: e.confidence
      })),
      ...incoming.map((e: any) => ({
        type: 'incoming' as const,
        relation: e.relation,
        target: e.from_entity,
        confidence: e.confidence
      }))
    ];

    const memoryIds = [
      ...outgoing.map((e: any) => e.memory_id),
      ...incoming.map((e: any) => e.memory_id)
    ].filter(Boolean);

    let relatedMemories: MemoryEntry[] = [];
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = await this.db.all(
        `SELECT id, session_id, content, role, timestamp, metadata, tier, consolidated_from, importance
         FROM memories WHERE id IN (${placeholders})`,
        memoryIds
      );
      relatedMemories = rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        role: row.role,
        timestamp: new Date(row.timestamp),
        tier: row.tier as MemoryTier,
        importance: typeof row.importance === 'number' ? row.importance : 0.5,
        consolidatedFrom: row.consolidated_from ? JSON.parse(row.consolidated_from) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));
    }

    return { entity: ent, relationships, relatedMemories };
  }

  async history(sessionId: string, limit: number = 20): Promise<MemoryEntry[]> {
    await this.init();
    // Fetch newest N, then sort ASC for chronological display
    const rows = await this.db.all(
      `SELECT id, session_id, content, role, timestamp, metadata, tier, consolidated_from, importance
       FROM (
         SELECT * FROM memories
         WHERE session_id = ? AND tier IN ('working', 'long_term')
         ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`,
      [sessionId, limit]
    );
    return rows.map((row: any) => {
      const entry: MemoryEntry = {
        id: row.id, sessionId: row.session_id, content: row.content,
        role: row.role, timestamp: new Date(row.timestamp), tier: row.tier as MemoryTier,
        importance: typeof row.importance === 'number' ? row.importance : 0.5,
      };
      if (row.consolidated_from) entry.consolidatedFrom = JSON.parse(row.consolidated_from);
      if (row.metadata) entry.metadata = JSON.parse(row.metadata);
      return entry;
    });
  }

  async forget(
    sessionId: string,
    options?: { before?: Date; id?: string; includeLongTerm?: boolean }
  ): Promise<number> {
    await this.init();

    const tiers = options?.includeLongTerm
      ? `('working', 'long_term', 'archived')`
      : `('working', 'long_term')`;

    if (options?.id) {
      const result = await this.db.run(
        `DELETE FROM memories WHERE session_id = ? AND id = ?`,
        [sessionId, options.id]
      );
      return result.changes || 0;
    }

    let sql = `DELETE FROM memories WHERE session_id = ? AND tier IN ${tiers}`;
    const params: (string | number)[] = [sessionId];

    if (options?.before) {
      sql += ' AND timestamp < ?';
      params.push(options.before.getTime());
    }

    const result = await this.db.run(sql, params);
    return result.changes || 0;
  }

  async stats(sessionId: string): Promise<{
    total: number;
    byRole: Record<string, number>;
    byTier: Record<MemoryTier, number>;
    oldest: Date | null;
    newest: Date | null;
    withEmbeddings: number;
    graphNodes?: number;
    graphEdges?: number;
  }> {
    await this.init();

    const totalRow = await this.db.get(
      `SELECT COUNT(*) as count FROM memories WHERE session_id = ? AND tier != 'archived'`,
      [sessionId]
    );
    const roleRows = await this.db.all(
      `SELECT role, COUNT(*) as count FROM memories WHERE session_id = ? AND tier != 'archived' GROUP BY role`,
      [sessionId]
    );
    const tierRows = await this.db.all(
      `SELECT tier, COUNT(*) as count FROM memories WHERE session_id = ? GROUP BY tier`,
      [sessionId]
    );

    const byRole: Record<string, number> = {};
    roleRows.forEach((row: any) => { byRole[row.role] = row.count; });

    const byTier: Record<MemoryTier, number> = { working: 0, long_term: 0, archived: 0 };
    tierRows.forEach((row: any) => { byTier[row.tier as MemoryTier] = row.count; });

    const range = await this.db.get(
      `SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest
       FROM memories WHERE session_id = ? AND tier != 'archived'`,
      [sessionId]
    );
    const embRow = await this.db.get(
      `SELECT COUNT(*) as count FROM memories
       WHERE session_id = ? AND tier != 'archived' AND embedding IS NOT NULL`,
      [sessionId]
    );

    const result: {
      total: number;
      byRole: Record<string, number>;
      byTier: Record<MemoryTier, number>;
      oldest: Date | null;
      newest: Date | null;
      withEmbeddings: number;
      graphNodes?: number;
      graphEdges?: number;
    } = {
      total: totalRow?.count || 0,
      byRole,
      byTier,
      oldest: range?.oldest ? new Date(range.oldest) : null,
      newest: range?.newest ? new Date(range.newest) : null,
      withEmbeddings: embRow?.count || 0,
    };

    if (this.graphMemory) {
      const nodeRow = await this.db.get(
        `SELECT COUNT(*) as count FROM graph_nodes WHERE session_id = ?`, [sessionId]
      );
      const edgeRow = await this.db.get(
        `SELECT COUNT(*) as count FROM graph_edges WHERE session_id = ?`, [sessionId]
      );
      result.graphNodes = nodeRow?.count || 0;
      result.graphEdges = edgeRow?.count || 0;
    }

    return result;
  }

  /**
   * v0.8: Manually set the importance of a memory (0.0–1.0).
   * Use to protect a memory from consolidation or boost its recall rank.
   *
   * @example
   * ```typescript
   * await memory.setImportance(entryId, 0.95); // protected from consolidation
   * await memory.setImportance(entryId, 0.1);  // low priority, consolidate first
   * ```
   */
  async setImportance(id: string, importance: number): Promise<void> {
    await this.init();
    const clamped = Math.min(1.0, Math.max(0.0, importance));
    // Try both memories and user_memories tables
    await this.db.run(`UPDATE memories SET importance = ? WHERE id = ?`, [clamped, id]);
    await this.db.run(`UPDATE user_memories SET importance = ? WHERE id = ?`, [clamped, id]);
  }

  // ── v0.5: User-scoped memory (cross-session) ──────────────────────────────

  private mapUserRow(row: any, similarity?: number): UserMemoryEntry {
    const entry: UserMemoryEntry = {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier as MemoryTier,
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
    };
    if (row.consolidated_from) entry.consolidatedFrom = JSON.parse(row.consolidated_from);
    if (row.metadata) entry.metadata = JSON.parse(row.metadata);
    if (similarity !== undefined) entry.similarity = similarity;
    return entry;
  }

  /**
   * v0.5: Store a user-scoped memory that persists across all sessions.
   *
   * Use this for facts about the user that should always be available
   * regardless of which session is active — preferences, identity, long-term goals.
   *
   * @example
   * ```typescript
   * await memory.rememberUser('user_jeff', 'Prefers TypeScript over JavaScript', 'preference');
   * await memory.rememberUser('user_jeff', 'Building GovScout — a federal contracting app');
   *
   * // Available in any session
   * const facts = await memory.recallUser('user_jeff', 'what does the user prefer?', 5);
   * ```
   */
  async rememberUser(
    userId: string,
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<UserMemoryEntry> {
    await this.init();

    const id = createHash('sha256')
      .update(`${userId}:${content}:${Date.now()}`)
      .digest('hex').slice(0, 16);

    const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const truncated = content.slice(0, this.maxContextLength);

    let embeddingJson: string | null = null;
    if (this.semanticSearch) {
      const vector = await this.embed(truncated);
      if (vector) embeddingJson = JSON.stringify(vector);
    }

    const importance = await this.scoreImportance(truncated);

    await this.db.run(
      `INSERT INTO user_memories
       (id, user_id, content, role, timestamp, metadata, content_hash, embedding, tier, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
      [id, userId, truncated, role, Date.now(),
       metadata ? JSON.stringify(metadata) : null, contentHash, embeddingJson, importance]
    );

    const entry: UserMemoryEntry = {
      id, userId, content: truncated, role,
      timestamp: new Date(), tier: 'working', importance,
      ...(metadata !== undefined && { metadata })
    };
    return entry;
  }

  /**
   * v0.5: Recall user-scoped memories. Works independently of session.
   * Semantic search when available, keyword fallback otherwise.
   */
  async recallUser(
    userId: string,
    query?: string,
    limit: number = 10,
    options: { tiers?: MemoryTier[]; role?: string } = {}
  ): Promise<UserMemoryEntry[]> {
    await this.init();

    const tiers = options.tiers ?? ['working', 'long_term'];
    const tierPlaceholders = tiers.map(() => '?').join(',');

    let sql = `SELECT * FROM user_memories WHERE user_id = ? AND tier IN (${tierPlaceholders})`;
    const params: (string | number)[] = [userId, ...tiers];

    if (options.role) { sql += ' AND role = ?'; params.push(options.role); }

    // Semantic search
    if (query && query.trim() && this.semanticSearch) {
      const queryVector = await this.embed(query);
      if (queryVector) {
        const rows = await this.db.all(sql + ' ORDER BY timestamp DESC', params);
        const scored = rows
          .map((row: any) => {
            let similarity = 0;
            if (row.embedding) {
              try { similarity = this.cosineSimilarity(queryVector, JSON.parse(row.embedding)); }
              catch { /* skip */ }
            }
            return { row, similarity };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);
        return scored.map(({ row, similarity }) => this.mapUserRow(row, similarity));
      }
    }

    // Keyword fallback
    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      if (keywords.length > 0) {
        sql += ' AND (' + keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ') + ')';
        params.push(...keywords.map(k => `%${k}%`));
      }
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all(sql, params);
    return rows.map((row: any) => this.mapUserRow(row));
  }

  /**
   * v0.5: Delete user-scoped memories.
   */
  async forgetUser(
    userId: string,
    options?: { id?: string; before?: Date; includeLongTerm?: boolean }
  ): Promise<number> {
    await this.init();

    const tiers = options?.includeLongTerm
      ? `('working', 'long_term', 'archived')`
      : `('working', 'long_term')`;

    if (options?.id) {
      const result = await this.db.run(
        'DELETE FROM user_memories WHERE user_id = ? AND id = ?',
        [userId, options.id]
      );
      return result.changes || 0;
    }

    let sql = `DELETE FROM user_memories WHERE user_id = ? AND tier IN ${tiers}`;
    const params: (string | number)[] = [userId];

    if (options?.before) {
      sql += ' AND timestamp < ?';
      params.push(options.before.getTime());
    }

    const result = await this.db.run(sql, params);
    return result.changes || 0;
  }

  /**
   * v0.5: Consolidate user-scoped memories. Same mechanic as session consolidation.
   */
  async consolidateUser(
    userId: string,
    options: ConsolidateOptions = {}
  ): Promise<ConsolidationResult> {
    await this.init();

    const batch = options.batch ?? this.consolidateBatch;
    const keep = options.keep ?? this.consolidateKeep;
    const model = options.model ?? this.consolidateModel;

    const rows = await this.db.all(
      `SELECT * FROM user_memories WHERE user_id = ? AND tier = 'working' AND importance < ?
       ORDER BY timestamp ASC LIMIT ?`,
      [userId, this.importanceThreshold, batch + keep]
    );

    const candidates = rows.slice(0, Math.max(0, rows.length - keep));
    if (candidates.length === 0) return { summarized: 0, created: 0, archived: 0 };

    const entries: MemoryEntry[] = candidates.map((row: any) => ({
      id: row.id,
      sessionId: row.user_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: row.tier as MemoryTier,
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
    }));

    const summaries = await this.summarizeMemories(entries, model);
    if (summaries.length === 0) return { summarized: entries.length, created: 0, archived: 0 };

    if (options.dryRun) {
      return { summarized: entries.length, created: 0, archived: 0, previews: summaries };
    }

    const sourceIds = entries.map(e => e.id);
    const consolidatedFromJson = JSON.stringify(sourceIds);

    for (const summary of summaries) {
      const id = createHash('sha256')
        .update(`${userId}:lt:${summary}:${Date.now()}`)
        .digest('hex').slice(0, 16);
      const contentHash = createHash('sha256').update(summary).digest('hex').slice(0, 16);

      let embeddingJson: string | null = null;
      if (this.semanticSearch) {
        const vector = await this.embed(summary);
        if (vector) embeddingJson = JSON.stringify(vector);
      }

      await this.db.run(
        `INSERT INTO user_memories
         (id, user_id, content, role, timestamp, metadata, content_hash, embedding, tier, consolidated_from)
         VALUES (?, ?, ?, 'system', ?, NULL, ?, ?, 'long_term', ?)`,
        [id, userId, summary.slice(0, this.maxContextLength), Date.now(),
         contentHash, embeddingJson, consolidatedFromJson]
      );
    }

    const placeholders = sourceIds.map(() => '?').join(',');
    await this.db.run(
      `UPDATE user_memories SET tier = 'archived' WHERE id IN (${placeholders})`,
      sourceIds
    );

    return { summarized: entries.length, created: summaries.length, archived: entries.length };
  }

  /**
   * v0.5: Stats for user-scoped memories.
   */
  async userStats(userId: string): Promise<{
    total: number;
    byRole: Record<string, number>;
    byTier: Record<MemoryTier, number>;
    oldest: Date | null;
    newest: Date | null;
    withEmbeddings: number;
  }> {
    await this.init();

    const totalRow = await this.db.get(
      `SELECT COUNT(*) as count FROM user_memories WHERE user_id = ? AND tier != 'archived'`,
      [userId]
    );
    const roleRows = await this.db.all(
      `SELECT role, COUNT(*) as count FROM user_memories
       WHERE user_id = ? AND tier != 'archived' GROUP BY role`,
      [userId]
    );
    const tierRows = await this.db.all(
      `SELECT tier, COUNT(*) as count FROM user_memories WHERE user_id = ? GROUP BY tier`,
      [userId]
    );

    const byRole: Record<string, number> = {};
    roleRows.forEach((row: any) => { byRole[row.role] = row.count; });

    const byTier: Record<MemoryTier, number> = { working: 0, long_term: 0, archived: 0 };
    tierRows.forEach((row: any) => { byTier[row.tier as MemoryTier] = row.count; });

    const range = await this.db.get(
      `SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest
       FROM user_memories WHERE user_id = ? AND tier != 'archived'`,
      [userId]
    );
    const embRow = await this.db.get(
      `SELECT COUNT(*) as count FROM user_memories
       WHERE user_id = ? AND tier != 'archived' AND embedding IS NOT NULL`,
      [userId]
    );

    return {
      total: totalRow?.count || 0,
      byRole,
      byTier,
      oldest: range?.oldest ? new Date(range.oldest) : null,
      newest: range?.newest ? new Date(range.newest) : null,
      withEmbeddings: embRow?.count || 0,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.initialized = false;
    }
  }
}

export default Engram;

// v0.6: Cogito lifecycle integration helpers
export { buildWakeBriefing, handleSleep } from './integrations/cogito.js';

// v0.7: Remote HTTP client
export { EngramClient } from './client.js';
export type { EngramClientConfig } from './client.js';
