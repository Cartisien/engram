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
  certainty: number;            // v0.9: 0.0–1.0, confidence this belief is still true
  reinforcementCount: number;   // v0.9: how many times confirmed
  lastVerified: Date;           // v0.9: when certainty was last updated
  memoryType: 'episodic' | 'semantic'; // v0.9: event vs belief/fact
  status: 'active' | 'superseded' | 'contradicted'; // v0.9: lifecycle state
  contradicts?: string[];       // v0.9: IDs of memories this contradicts
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
  certainty: number;            // v0.9: confidence score
  reinforcementCount: number;   // v0.9: reinforcement count
  lastVerified: Date;           // v0.9: last certainty update
  memoryType: 'episodic' | 'semantic'; // v0.9: memory type
  status: 'active' | 'superseded' | 'contradicted'; // v0.9: lifecycle
  metadata?: Record<string, unknown>;
  similarity?: number;
}


// v0.9: Contradiction detection result
export interface ContradictionResult {
  detected: boolean;
  conflicting: Array<{
    id: string;
    content: string;
    certainty: number;
    similarity: number;
  }>;
}

// v0.9: Reinforcement result
export interface ReinforcementResult {
  id: string;
  certainty: number;
  reinforcementCount: number;
}

// v0.9: Timeline event
export interface TimelineEvent {
  timestamp: Date;
  event: 'created' | 'reinforced' | 'contradicted' | 'superseded' | 'consolidated';
  memoryId: string;
  content: string;
  certainty?: number;
  importance?: number;
  relatedId?: string;
}

// v0.9: reflect() result
export interface ReflectResult {
  query: string;
  insights: string[];           // LLM-generated synthesis
  memoriesUsed: MemoryEntry[];  // memories that informed the insights
  certaintyWeighted: boolean;   // whether high-certainty memories were prioritized
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
  // v0.9: belief revision
  contradictionDetection?: boolean; // detect contradictions on remember() via LLM (default: false)
  contradictionModel?: string;      // Ollama model for contradiction detection (default: same as graphModel)
  defaultMemoryType?: 'episodic' | 'semantic'; // default memory type (default: 'episodic')
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
  private contradictionDetection: boolean;
  private contradictionModel: string;
  private defaultMemoryType: 'episodic' | 'semantic';

  constructor(config: EngramConfig = {}) {
    this.dbPath = config.dbPath || './engram.db';
    this.maxContextLength = config.maxContextLength || 4000;
    this.embeddingUrl = config.embeddingUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
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
    this.contradictionDetection = config.contradictionDetection === true;
    this.contradictionModel = config.contradictionModel || config.graphModel || 'qwen2.5:32b';
    this.defaultMemoryType = config.defaultMemoryType ?? 'episodic';
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
      `ALTER TABLE memories ADD COLUMN certainty REAL NOT NULL DEFAULT 0.5`,
      `ALTER TABLE memories ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memories ADD COLUMN last_verified INTEGER`,
      `ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'episodic'`,
      `ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
      `ALTER TABLE memories ADD COLUMN contradicts TEXT`,
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
        importance REAL NOT NULL DEFAULT 0.5,
        certainty REAL NOT NULL DEFAULT 0.5,
        reinforcement_count INTEGER NOT NULL DEFAULT 0,
        last_verified INTEGER,
        memory_type TEXT NOT NULL DEFAULT 'episodic',
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_user_timestamp
        ON user_memories(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_user_tier
        ON user_memories(user_id, tier);
    `);

    // v0.9 migrations for user_memories
    const userMigrations = [
      `ALTER TABLE user_memories ADD COLUMN certainty REAL NOT NULL DEFAULT 0.5`,
      `ALTER TABLE user_memories ADD COLUMN reinforcement_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE user_memories ADD COLUMN last_verified INTEGER`,
      `ALTER TABLE user_memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'episodic'`,
      `ALTER TABLE user_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    ];
    for (const m of userMigrations) {
      try { await this.db.exec(m); } catch { /* column exists */ }
    }

    this.initialized = true;
  }

  private ollamaWarned = false;

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
      if (!this.ollamaWarned) {
        this.ollamaWarned = true;
        console.warn(
          `[engram] Ollama not found at ${this.embeddingUrl} — falling back to keyword search.\n` +
          `         For semantic search: install Ollama (https://ollama.ai) and run: ollama pull nomic-embed-text`
        );
      }
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

  /** v1.0: BM25-style keyword scoring (simplified: TF * IDF approximation via SQLite FTS) */
  private bm25Score(query: string, content: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (queryTerms.length === 0) return 0;
    const contentLower = content.toLowerCase();
    const words = contentLower.split(/\s+/);
    const totalWords = words.length || 1;
    let score = 0;
    for (const term of queryTerms) {
      const tf = words.filter(w => w.includes(term)).length / totalWords;
      // simplified IDF: longer matches get a small boost
      const idf = Math.log(1 + 10 / (1 + tf * 10));
      score += tf * idf;
    }
    return Math.min(1.0, score * 5);
  }

  /**
   * v1.0: Reciprocal Rank Fusion — merge multiple ranked lists.
   * k=60 is the standard constant from the RRF paper.
   */
  private rrfMerge(
    lists: Array<Array<{ id: string; entry: MemoryEntry }>>,
    k = 60
  ): MemoryEntry[] {
    const scores = new Map<string, { entry: MemoryEntry; score: number }>();
    for (const list of lists) {
      list.forEach(({ id, entry }, rank) => {
        const rrf = 1 / (k + rank + 1);
        const existing = scores.get(id);
        if (existing) {
          existing.score += rrf;
        } else {
          scores.set(id, { entry, score: rrf });
        }
      });
    }
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .map(v => v.entry);
  }

  /** v0.9: Map a DB row to a full MemoryEntry */
  private rowToEntry(row: any, similarity?: number): MemoryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: (row.tier as MemoryTier) || 'working',
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
      certainty: typeof row.certainty === 'number' ? row.certainty : 0.5,
      reinforcementCount: row.reinforcement_count ?? 0,
      lastVerified: new Date(row.last_verified ?? row.timestamp),
      memoryType: (row.memory_type as 'episodic' | 'semantic') || 'episodic',
      status: (row.status as 'active' | 'superseded' | 'contradicted') || 'active',
      ...(row.contradicts ? { contradicts: JSON.parse(row.contradicts) } : {}),
      ...(row.consolidated_from ? { consolidatedFrom: JSON.parse(row.consolidated_from) } : {}),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      ...(similarity !== undefined ? { similarity } : {}),
    };
  }

  /** v0.9: Map a DB row to a full UserMemoryEntry */
  private rowToUserEntry(row: any, similarity?: number): UserMemoryEntry {
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      tier: (row.tier as MemoryTier) || 'working',
      importance: typeof row.importance === 'number' ? row.importance : 0.5,
      certainty: typeof row.certainty === 'number' ? row.certainty : 0.5,
      reinforcementCount: row.reinforcement_count ?? 0,
      lastVerified: new Date(row.last_verified ?? row.timestamp),
      memoryType: (row.memory_type as 'episodic' | 'semantic') || 'episodic',
      status: (row.status as 'active' | 'superseded' | 'contradicted') || 'active',
      ...(row.consolidated_from ? { consolidatedFrom: JSON.parse(row.consolidated_from) } : {}),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      ...(similarity !== undefined ? { similarity } : {}),
    };
  }

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

    const entries: MemoryEntry[] = candidates.map((row: any) => this.rowToEntry(row));

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

    const certainty = 0.5; // starts neutral; increases via reinforce()
    const memoryType = this.defaultMemoryType;
    const now = Date.now();
    const contradicts = metadata?.contradicts as string[] | undefined;

    const entry: MemoryEntry = {
      id, sessionId, content: truncated, role,
      timestamp: new Date(now), tier: 'working', importance,
      certainty, reinforcementCount: 0, lastVerified: new Date(now),
      memoryType, status: 'active',
      ...(contradicts !== undefined && { contradicts }),
      ...(metadata !== undefined && { metadata })
    };

    await this.db.run(
      `INSERT INTO memories
       (id, session_id, content, role, timestamp, metadata, content_hash, embedding, tier, importance,
        certainty, reinforcement_count, last_verified, memory_type, status, contradicts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?, 0, ?, ?, 'active', ?)`,
      [id, sessionId, truncated, role, now,
       metadata ? JSON.stringify(metadata) : null, contentHash, embeddingJson, importance,
       certainty, now, memoryType,
       contradicts ? JSON.stringify(contradicts) : null]
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
    const statusFilter = `AND status = 'active'`;
    const tierPlaceholders = tiers.map(() => '?').join(',');

    let sql = `
      SELECT id, session_id, content, role, timestamp, metadata, embedding, tier, consolidated_from,
             importance, certainty, reinforcement_count, last_verified, memory_type, status, contradicts
      FROM memories WHERE session_id = ? AND tier IN (${tierPlaceholders}) AND status = 'active'
    `;
    const params: (string | number)[] = [sessionId, ...tiers];

    if (options.role) { sql += ` AND role = ?`; params.push(options.role); }
    if (options.after) { sql += ` AND timestamp >= ?`; params.push(options.after.getTime()); }
    if (options.before) { sql += ` AND timestamp <= ?`; params.push(options.before.getTime()); }

    const mapRow = (row: any, similarity?: number): MemoryEntry => {
      return this.rowToEntry(row, similarity);
    };


    // v1.0: Multi-strategy retrieval with RRF merge
    if (query && query.trim()) {
      const allRows = await this.db.all(sql + ` ORDER BY timestamp DESC LIMIT ?`, [...params, limit * 3]);

      // Strategy 1: Semantic (if available)
      let semanticList: Array<{ id: string; entry: MemoryEntry }> = [];
      if (this.semanticSearch) {
        const queryVector = await this.embed(query);
        if (queryVector) {
          semanticList = allRows
            .map((row: any) => {
              let similarity = 0;
              if (row.embedding) {
                try { similarity = this.cosineSimilarity(queryVector, JSON.parse(row.embedding)); } catch { /* skip */ }
              }
              // blend: similarity * 0.6 + importance * 0.2 + certainty * 0.2
              const rankScore = similarity * 0.6 + (row.importance ?? 0.5) * 0.2 + (row.certainty ?? 0.5) * 0.2;
              return { id: row.id as string, entry: mapRow(row, similarity), rankScore };
            })
            .sort((a, b) => b.rankScore - a.rankScore)
            .slice(0, limit);
        }
      }

      // Strategy 2: BM25 keyword scoring
      const keywordList: Array<{ id: string; entry: MemoryEntry }> = allRows
        .map((row: any) => ({
          id: row.id as string,
          entry: mapRow(row),
          bm25: this.bm25Score(query, row.content),
        }))
        .filter(r => r.bm25 > 0)
        .sort((a, b) => b.bm25 - a.bm25)
        .slice(0, limit);

      // Strategy 3: Recency (temporal) — always included
      const recencyList: Array<{ id: string; entry: MemoryEntry }> = allRows
        .slice(0, limit)
        .map((row: any) => ({ id: row.id as string, entry: mapRow(row) }));

      // RRF merge — use all available lists
      const lists = [recencyList];
      if (semanticList.length > 0) lists.unshift(semanticList);
      if (keywordList.length > 0) lists.splice(1, 0, keywordList);

      const merged = this.rrfMerge(lists).slice(0, limit);

      if (this.graphMemory && options.includeGraph !== false) {
        const graphAugmented = await this.augmentWithGraph(sessionId, merged, limit);
        return this.blendUserMemories(graphAugmented, options.userId, query, limit);
      }
      return this.blendUserMemories(merged, options.userId, query, limit);
    }

    // No query — return by recency
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
          certainty: u.certainty,
          reinforcementCount: u.reinforcementCount,
          lastVerified: u.lastVerified,
          memoryType: u.memoryType,
          status: u.status,
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

    const connected: MemoryEntry[] = connectedRows.map((row: any) => this.rowToEntry(row, 0));

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
        `SELECT id, session_id, content, role, timestamp, metadata, tier, consolidated_from, importance,
              certainty, reinforcement_count, last_verified, memory_type, status, contradicts
         FROM memories WHERE id IN (${placeholders})`,
        memoryIds
      );
      relatedMemories = rows.map((row: any) => this.rowToEntry(row));
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
    return rows.map((row: any) => this.rowToEntry(row));
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


  // ── v0.9: Belief Revision ─────────────────────────────────────────────────

  /**
   * v0.9: Reinforce a memory — increase certainty and increment reinforcement count.
   * Use when a memory is confirmed by the user or repeated evidence.
   */
  async reinforce(id: string, boost = 0.15): Promise<ReinforcementResult> {
    await this.init();
    const now = Date.now();
    await this.db.run(
      `UPDATE memories
         SET certainty = MIN(1.0, certainty + ?),
             reinforcement_count = reinforcement_count + 1,
             last_verified = ?
       WHERE id = ?`,
      [boost, now, id]
    );
    await this.db.run(
      `UPDATE user_memories
         SET certainty = MIN(1.0, certainty + ?),
             reinforcement_count = reinforcement_count + 1,
             last_verified = ?
       WHERE id = ?`,
      [boost, now, id]
    );
    const row = await this.db.get(
      `SELECT id, certainty, reinforcement_count FROM memories WHERE id = ?
       UNION SELECT id, certainty, reinforcement_count FROM user_memories WHERE id = ?`,
      [id, id]
    );
    return {
      id,
      certainty: row?.certainty ?? 0.5,
      reinforcementCount: row?.reinforcement_count ?? 0,
    };
  }

  /**
   * v0.9: Mark a memory as contradicted — lower certainty and update status.
   * Optionally store the new contradicting content as a new memory.
   * Returns the ID of the new memory if created.
   */
  async contradict(
    sessionId: string,
    contradictedId: string,
    newContent: string,
    role: 'user' | 'assistant' | 'system' = 'user'
  ): Promise<{ contradictedId: string; newId?: string }> {
    await this.init();
    const now = Date.now();

    // Lower certainty on the old memory, mark contradicted
    await this.db.run(
      `UPDATE memories
         SET certainty = MAX(0.0, certainty - 0.25),
             status = 'contradicted',
             last_verified = ?
       WHERE id = ?`,
      [now, contradictedId]
    );

    if (!newContent.trim()) return { contradictedId };

    // Store new memory linking back to what it contradicts
    const entry = await this.remember(sessionId, newContent, role, {
      contradicts: [contradictedId],
    });
    return { contradictedId, newId: entry.id };
  }

  /**
   * v0.9: Detect contradictions between new content and existing memories.
   * Heuristic mode (default): keyword overlap + opposite polarity signals.
   * LLM mode (opt-in via contradictionDetection: true): asks the model.
   */
  async detectContradictions(
    sessionId: string,
    content: string,
    options: { limit?: number } = {}
  ): Promise<ContradictionResult> {
    await this.init();
    const limit = options.limit ?? 20;

    // Pull recent active memories
    const rows = await this.db.all(
      `SELECT id, content, certainty FROM memories
       WHERE session_id = ? AND tier IN ('working', 'long_term') AND status = 'active'
       ORDER BY timestamp DESC LIMIT ?`,
      [sessionId, limit]
    );

    if (rows.length === 0) return { detected: false, conflicting: [] };

    if (this.contradictionDetection) {
      return this.detectContradictionsLLM(content, rows);
    }
    return this.detectContradictionsHeuristic(content, rows);
  }

  private detectContradictionsHeuristic(
    content: string,
    rows: any[]
  ): ContradictionResult {
    const negators = ['not', "don't", "doesn't", "won't", 'never', 'no longer', 'stopped', 'switched', 'instead'];
    const preferenceWords = ['prefer', 'like', 'use', 'love', 'want', 'need', 'hate', 'dislike'];

    const contentLower = content.toLowerCase();
    const contentHasNegation = negators.some(n => contentLower.includes(n));
    const contentTokens = new Set(contentLower.split(/\W+/).filter(t => t.length > 3));

    const conflicting: ContradictionResult['conflicting'] = [];

    for (const row of rows) {
      const rowLower = row.content.toLowerCase();
      const rowTokens = new Set(rowLower.split(/\W+/).filter((t: string) => t.length > 3));
      const rowHasNegation = negators.some(n => rowLower.includes(n));

      // Overlap score
      let overlap = 0;
      for (const t of contentTokens) {
        if (rowTokens.has(t)) overlap++;
      }
      const similarity = overlap / Math.max(contentTokens.size, rowTokens.size, 1);

      // Check for shared preference words + negation polarity flip
      const bothHavePreference = preferenceWords.some(p =>
        contentLower.includes(p) && rowLower.includes(p)
      );

      const polarityFlip =
        (contentHasNegation && !rowHasNegation) ||
        (!contentHasNegation && rowHasNegation);

      if (similarity > 0.3 && bothHavePreference && polarityFlip) {
        conflicting.push({ id: row.id, content: row.content, certainty: row.certainty, similarity });
      }
    }

    return { detected: conflicting.length > 0, conflicting };
  }

  private async detectContradictionsLLM(
    content: string,
    rows: any[]
  ): Promise<ContradictionResult> {
    const numbered = rows
      .map((r, i) => `[${i + 1}] (id:${r.id}) ${r.content}`)
      .join('\n');

    const prompt =
      `Does the new statement contradict any of the existing memories? ` +
      `Reply with a JSON object: { "contradictions": [{ "index": N, "reason": "..." }] } or { "contradictions": [] }.\n\n` +
      `New statement: "${content}"\n\nExisting memories:
${numbered}

JSON:`;

    let llmResult: { response: string } | null = null;
    try {
      const resp = await fetch(`${this.embeddingUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.contradictionModel, prompt, stream: false, options: { temperature: 0, num_predict: 200 } }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) llmResult = await resp.json() as { response: string };
    } catch { /* timeout / network */ }

    if (!llmResult) return this.detectContradictionsHeuristic(content, rows);

    try {
      const match = llmResult.response.match(/\{[\s\S]*\}/);
      if (!match) return { detected: false, conflicting: [] };
      const parsed = JSON.parse(match[0]) as { contradictions: Array<{ index: number }> };
      const conflicting = parsed.contradictions
        .map((c: { index: number }) => {
          const row = rows[c.index - 1];
          return row ? { id: row.id, content: row.content, certainty: row.certainty, similarity: 0.8 } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return { detected: conflicting.length > 0, conflicting };
    } catch {
      return this.detectContradictionsHeuristic(content, rows);
    }
  }

  /**
   * v0.9: Invalidate a memory — mark it as superseded so it's excluded from recall.
   */
  async invalidate(id: string): Promise<void> {
    await this.init();
    await this.db.run(
      `UPDATE memories SET status = 'superseded', last_verified = ? WHERE id = ?`,
      [Date.now(), id]
    );
    await this.db.run(
      `UPDATE user_memories SET status = 'superseded', last_verified = ? WHERE id = ?`,
      [Date.now(), id]
    );
  }

  /**
   * v0.9: Get a chronological timeline of memory events for a session.
   * Shows belief formation, reinforcement, contradiction, and consolidation.
   */
  async timeline(sessionId: string, options: { limit?: number } = {}): Promise<TimelineEvent[]> {
    await this.init();
    const limit = options.limit ?? 50;

    const rows = await this.db.all(
      `SELECT id, content, timestamp, certainty, importance, status, tier, consolidated_from,
              reinforcement_count, last_verified
       FROM memories
       WHERE session_id = ?
       ORDER BY timestamp ASC LIMIT ?`,
      [sessionId, limit]
    );

    const events: TimelineEvent[] = [];

    for (const row of rows) {
      // Creation event
      events.push({
        timestamp: new Date(row.timestamp),
        event: row.tier === 'long_term' ? 'consolidated' : 'created',
        memoryId: row.id,
        content: row.content,
        certainty: row.certainty,
        importance: row.importance,
      });

      // Status change events
      if (row.status === 'contradicted') {
        events.push({
          timestamp: new Date(row.timestamp + 1),
          event: 'contradicted',
          memoryId: row.id,
          content: row.content,
          certainty: row.certainty,
        });
      } else if (row.status === 'superseded') {
        events.push({
          timestamp: new Date(row.timestamp + 1),
          event: 'superseded',
          memoryId: row.id,
          content: row.content,
          certainty: row.certainty,
        });
      }

      // Reinforcement indicator (certainty > 0.65)
      if (row.reinforcement_count > 0) {
        events.push({
          timestamp: new Date((row.last_verified ?? row.timestamp) as number),
          event: 'reinforced',
          memoryId: row.id,
          content: row.content,
          certainty: row.certainty,
        });
      }
    }

    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }


  /**
   * v0.9: Reflect — synthesize insights across memories for a given query.
   * 
   * Unlike recall() which retrieves raw memories, reflect() uses an LLM to
   * reason across them and generate new understanding. Use before starting
   * a task, when making decisions, or when you need a synthesis rather than
   * a lookup.
   *
   * @example
   * const result = await memory.reflect('session_jeff', 'What does this user care most about?');
   * // → { insights: ['User strongly prefers TypeScript...', 'Has a deadline sensitivity...'], ... }
   */
  async reflect(
    sessionId: string,
    query: string,
    options: {
      limit?: number;
      model?: string;
      userId?: string;           // also blend in user-scoped memories
      includeArchived?: boolean;
    } = {}
  ): Promise<ReflectResult> {
    await this.init();

    const limit = options.limit ?? 20;
    const model = options.model || this.consolidateModel;

    // Pull relevant memories — prioritize high-certainty ones
    const tiers: MemoryTier[] = options.includeArchived
      ? ['working', 'long_term', 'archived']
      : ['working', 'long_term'];

    const recallOpts: RecallOptions = { tiers, ...(options.userId !== undefined && { userId: options.userId }) };
    let memories = await this.recall(sessionId, query, limit, recallOpts);

    // Sort: blend similarity + certainty so high-confidence memories surface first
    memories = memories.sort((a, b) => {
      const scoreA = (a.similarity ?? 0.5) * 0.6 + a.certainty * 0.4;
      const scoreB = (b.similarity ?? 0.5) * 0.6 + b.certainty * 0.4;
      return scoreB - scoreA;
    });

    if (memories.length === 0) {
      return { query, insights: [], memoriesUsed: [], certaintyWeighted: true };
    }

    const numbered = memories
      .map((m, i) => `[${i + 1}] (certainty:${m.certainty.toFixed(2)}, importance:${m.importance.toFixed(2)}) ${m.content}`)
      .join('\n');

    const prompt =
      `You are a memory reflection system for an AI agent. ` +
      `Given the following memories and the query below, generate 3-5 concise insights ` +
      `that synthesize what is known, highlight patterns, note any contradictions, ` +
      `and surface what matters most for answering the query. ` +
      `Weight higher-certainty memories more heavily. ` +
      `Return ONLY a JSON array of insight strings.\n\n` +
      `Query: "${query}"\n\n` +
      `Memories (certainty and importance shown):\n${numbered}\n\n` +
      `JSON array of insight strings:`;

    let insights: string[] = [];

    try {
      const response = await fetch(`${this.embeddingUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 600 },
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const data = await response.json() as { response: string };
        const raw = data.response.trim();
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as unknown[];
          insights = parsed
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        }
      }
    } catch {
      // LLM unavailable — return memories without synthesis
      insights = memories.slice(0, 5).map(m => m.content);
    }

    return {
      query,
      insights,
      memoriesUsed: memories,
      certaintyWeighted: true,
    };
  }

  // ── v0.5: User-scoped memory (cross-session) ──────────────────────────────

  private mapUserRow(row: any, similarity?: number): UserMemoryEntry {
    return this.rowToUserEntry(row, similarity);
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

    const now = Date.now();
    await this.db.run(
      `INSERT INTO user_memories
       (id, user_id, content, role, timestamp, metadata, content_hash, embedding, tier, importance,
        certainty, reinforcement_count, last_verified, memory_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, 0.5, 0, ?, ?, 'active')`,
      [id, userId, truncated, role, now,
       metadata ? JSON.stringify(metadata) : null, contentHash, embeddingJson, importance,
       now, this.defaultMemoryType]
    );

    const entry: UserMemoryEntry = {
      id, userId, content: truncated, role,
      timestamp: new Date(now), tier: 'working', importance,
      certainty: 0.5, reinforcementCount: 0, lastVerified: new Date(now),
      memoryType: this.defaultMemoryType, status: 'active',
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
    const statusFilter = `AND status = 'active'`;
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
      ...this.rowToEntry(row),
      sessionId: row.user_id,
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

// v1.1: Search enhancements
export { rerank, rerankerAvailable } from './search/reranker.js';
export type { RerankerResult } from './search/reranker.js';
export { extractPropositions } from './search/propositions.js';
export type { Proposition } from './search/propositions.js';
export * from './search/hybrid.js';
export { FTS5Search } from './search/fts5.js';

// v1.1: Cache, batch, dedup, graph modules
export { EmbeddingCache } from './cache/embedding-cache.js';
export * from './utils/batch.js';
export * from './utils/dedup.js';
export * from './graph/traversal.js';
