import { createHash } from 'crypto';
import { open, Database as SQLiteDatabase } from 'sqlite';

export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
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
  includeGraph?: boolean; // v0.3: also traverse graph for related context
}

export interface EngramConfig {
  dbPath?: string;
  maxContextLength?: number;
  embeddingUrl?: string;
  embeddingModel?: string;
  semanticSearch?: boolean;
  graphMemory?: boolean; // v0.3: enable graph extraction
  graphModel?: string;   // Ollama model for entity extraction (default: qwen2.5:32b)
}

/**
 * Engram - Persistent semantic memory for AI agents
 *
 * v0.3 adds graph memory — entity relationships extracted from memories
 * using a local LLM, enabling richer contextual recall.
 *
 * @example
 * ```typescript
 * import { Engram } from '@cartisien/engram';
 *
 * const memory = new Engram({ dbPath: './memory.db', graphMemory: true });
 *
 * await memory.remember('session_1', 'Jeff is building GovScout in React 19', 'user');
 * const context = await memory.recall('session_1', 'what is Jeff building?', 5);
 * const graph = await memory.graph('session_1', 'GovScout');
 * // → { entity: 'GovScout', relationships: [{ relation: 'built_with', target: 'React 19' }], ... }
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

  constructor(config: EngramConfig = {}) {
    this.dbPath = config.dbPath || ':memory:';
    this.maxContextLength = config.maxContextLength || 4000;
    this.embeddingUrl = config.embeddingUrl || 'http://192.168.68.73:11434';
    this.embeddingModel = config.embeddingModel || 'nomic-embed-text';
    this.semanticSearch = config.semanticSearch !== false;
    this.graphMemory = config.graphMemory === true;
    this.graphModel = config.graphModel || 'qwen2.5:32b';
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
        embedding TEXT
      );
    `);

    // Add embedding column if upgrading from v0.1
    try {
      await this.db.exec(`ALTER TABLE memories ADD COLUMN embedding TEXT`);
    } catch { /* already exists */ }

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

    this.initialized = true;
  }

  /**
   * Fetch embedding vector from Ollama
   */
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

  /**
   * Extract entity-relationship triples from text using a local LLM
   */
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

      // Extract JSON array from response
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

  /**
   * Upsert a graph node
   */
  private async upsertNode(sessionId: string, entity: string, type?: string): Promise<void> {
    const id = createHash('sha256').update(`${sessionId}:${entity}`).digest('hex').slice(0, 16);
    await this.db.run(
      `INSERT OR IGNORE INTO graph_nodes (id, session_id, entity, type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, entity, type || null, Date.now()]
    );
  }

  /**
   * Store a graph edge
   */
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
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Store a memory entry
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

    // Fetch embedding
    let embeddingJson: string | null = null;
    if (this.semanticSearch) {
      const vector = await this.embed(truncated);
      if (vector) embeddingJson = JSON.stringify(vector);
    }

    const entry: MemoryEntry = {
      id, sessionId, content: truncated, role,
      timestamp: new Date(), metadata
    };

    await this.db.run(
      `INSERT INTO memories (id, session_id, content, role, timestamp, metadata, content_hash, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, truncated, role, entry.timestamp.getTime(),
       metadata ? JSON.stringify(metadata) : null, contentHash, embeddingJson]
    );

    // v0.3: Extract graph relationships
    if (this.graphMemory) {
      const edges = await this.extractGraph(truncated);
      for (const edge of edges) {
        await this.storeEdge(sessionId, edge, id);
      }
    }

    return entry;
  }

  /**
   * Recall memories with optional graph traversal
   */
  async recall(
    sessionId: string,
    query?: string,
    limit: number = 10,
    options: RecallOptions = {}
  ): Promise<MemoryEntry[]> {
    await this.init();

    let sql = `
      SELECT id, session_id, content, role, timestamp, metadata, embedding
      FROM memories WHERE session_id = ?
    `;
    const params: (string | number)[] = [sessionId];

    if (options.role) { sql += ` AND role = ?`; params.push(options.role); }
    if (options.after) { sql += ` AND timestamp >= ?`; params.push(options.after.getTime()); }
    if (options.before) { sql += ` AND timestamp <= ?`; params.push(options.before.getTime()); }

    // Semantic search
    if (query && query.trim() && this.semanticSearch) {
      const queryVector = await this.embed(query);
      if (queryVector) {
        sql += ` ORDER BY timestamp DESC`;
        const rows = await this.db.all(sql, params);

        const scored = rows
          .map((row: any) => {
            let similarity = 0;
            if (row.embedding) {
              try {
                const vec: number[] = JSON.parse(row.embedding);
                similarity = this.cosineSimilarity(queryVector, vec);
              } catch { /* skip */ }
            }
            return { row, similarity };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        const results = scored.map(({ row, similarity }) => ({
          id: row.id,
          sessionId: row.session_id,
          content: row.content,
          role: row.role,
          timestamp: new Date(row.timestamp),
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          similarity
        }));

        // v0.3: Augment with graph-connected memories
        if (this.graphMemory && options.includeGraph !== false) {
          return this.augmentWithGraph(sessionId, results, limit);
        }

        return results;
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
    return rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Augment recall results with graph-connected memories
   */
  private async augmentWithGraph(
    sessionId: string,
    results: MemoryEntry[],
    limit: number
  ): Promise<MemoryEntry[]> {
    // Collect memory IDs that appear in graph edges
    const seenIds = new Set(results.map(r => r.id));
    const graphMemoryIds = new Set<string>();

    for (const result of results.slice(0, 3)) { // Only expand top 3
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

    // Fetch connected memories
    const placeholders = Array.from(graphMemoryIds).map(() => '?').join(',');
    const connectedRows = await this.db.all(
      `SELECT id, session_id, content, role, timestamp, metadata FROM memories
       WHERE id IN (${placeholders})`,
      Array.from(graphMemoryIds)
    );

    const connected: MemoryEntry[] = connectedRows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      role: row.role,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      similarity: 0 // Graph-connected, not vector-matched
    }));

    return [...results, ...connected].slice(0, limit);
  }

  /**
   * v0.3: Query the knowledge graph for an entity
   */
  async graph(sessionId: string, entity: string): Promise<GraphResult> {
    await this.init();
    const ent = entity.toLowerCase().trim();

    // Outgoing edges
    const outgoing = await this.db.all(
      `SELECT relation, to_entity, confidence, memory_id FROM graph_edges
       WHERE session_id = ? AND from_entity = ?`,
      [sessionId, ent]
    );

    // Incoming edges
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

    // Get source memories
    const memoryIds = [
      ...outgoing.map((e: any) => e.memory_id),
      ...incoming.map((e: any) => e.memory_id)
    ].filter(Boolean);

    let relatedMemories: MemoryEntry[] = [];
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = await this.db.all(
        `SELECT id, session_id, content, role, timestamp, metadata
         FROM memories WHERE id IN (${placeholders})`,
        memoryIds
      );
      relatedMemories = rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        role: row.role,
        timestamp: new Date(row.timestamp),
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));
    }

    return { entity: ent, relationships, relatedMemories };
  }

  /**
   * Get recent conversation history
   */
  async history(sessionId: string, limit: number = 20): Promise<MemoryEntry[]> {
    return this.recall(sessionId, undefined, limit, {});
  }

  /**
   * Delete memories
   */
  async forget(
    sessionId: string,
    options?: { before?: Date; id?: string }
  ): Promise<number> {
    await this.init();

    if (options?.id) {
      const result = await this.db.run(
        'DELETE FROM memories WHERE session_id = ? AND id = ?',
        [sessionId, options.id]
      );
      return result.changes || 0;
    }

    let sql = 'DELETE FROM memories WHERE session_id = ?';
    const params: (string | number)[] = [sessionId];

    if (options?.before) {
      sql += ' AND timestamp < ?';
      params.push(options.before.getTime());
    }

    const result = await this.db.run(sql, params);
    return result.changes || 0;
  }

  /**
   * Memory statistics
   */
  async stats(sessionId: string): Promise<{
    total: number;
    byRole: Record<string, number>;
    oldest: Date | null;
    newest: Date | null;
    withEmbeddings: number;
    graphNodes?: number;
    graphEdges?: number;
  }> {
    await this.init();

    const totalRow = await this.db.get(
      'SELECT COUNT(*) as count FROM memories WHERE session_id = ?', [sessionId]
    );
    const roleRows = await this.db.all(
      'SELECT role, COUNT(*) as count FROM memories WHERE session_id = ? GROUP BY role', [sessionId]
    );
    const byRole: Record<string, number> = {};
    roleRows.forEach((row: any) => { byRole[row.role] = row.count; });

    const range = await this.db.get(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM memories WHERE session_id = ?',
      [sessionId]
    );
    const embRow = await this.db.get(
      'SELECT COUNT(*) as count FROM memories WHERE session_id = ? AND embedding IS NOT NULL',
      [sessionId]
    );

    const stats: ReturnType<typeof this.stats> extends Promise<infer T> ? T : never = {
      total: totalRow?.count || 0,
      byRole,
      oldest: range?.oldest ? new Date(range.oldest) : null,
      newest: range?.newest ? new Date(range.newest) : null,
      withEmbeddings: embRow?.count || 0
    };

    if (this.graphMemory) {
      const nodeRow = await this.db.get(
        'SELECT COUNT(*) as count FROM graph_nodes WHERE session_id = ?', [sessionId]
      );
      const edgeRow = await this.db.get(
        'SELECT COUNT(*) as count FROM graph_edges WHERE session_id = ?', [sessionId]
      );
      stats.graphNodes = nodeRow?.count || 0;
      stats.graphEdges = edgeRow?.count || 0;
    }

    return stats;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.initialized = false;
    }
  }
}

export default Engram;
