/**
 * Core types for @cartisien/engram
 *
 * A memory is a trace — not a static record, but a living artifact
 * that shifts meaning based on what comes after it. (Derrida, Of Grammatology)
 */
interface Memory {
    id: string;
    agentId: string;
    content: string;
    embedding: number[];
    importance: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
    accessedAt: Date;
    accessCount: number;
}
interface MemoryInput {
    content: string;
    metadata?: Record<string, unknown>;
    importance?: number;
}
interface SearchResult {
    memory: Memory;
    score: number;
}
interface SearchOptions {
    limit?: number;
    threshold?: number;
    filter?: Partial<Memory['metadata']>;
}
type AdapterType = 'memory' | 'postgres' | 'sqlite';
interface EngramConfig {
    adapter: AdapterType;
    agentId: string;
    connectionString?: string;
    embeddingDimensions?: number;
}
interface IMemoryAdapter {
    init(): Promise<void>;
    store(memory: Memory): Promise<Memory>;
    get(id: string): Promise<Memory | null>;
    search(embedding: number[], options: Required<SearchOptions>): Promise<SearchResult[]>;
    forget(id: string): Promise<void>;
    list(agentId: string, limit?: number): Promise<Memory[]>;
    close(): Promise<void>;
}

/**
 * Engram — persistent semantic memory for AI agents.
 *
 * "We no longer live in the age of cogito. We live in the age of the trace."
 * — Derrida (via Orlo Rodriguez, "I Compute, Therefore Am I?")
 *
 * Usage:
 *   const mem = new Engram({ adapter: 'memory', agentId: 'my-agent' })
 *   await mem.wake()
 *   await mem.store({ content: 'The user prefers dark mode' })
 *   const results = await mem.search('user preferences')
 *   await mem.sleep()
 */
declare class Engram {
    private adapter;
    private readonly config;
    private initialized;
    private sessionStart;
    constructor(config: EngramConfig);
    /**
     * Initialize the adapter and record session start.
     * Call this at agent startup.
     */
    wake(): Promise<void>;
    /**
     * Persist state and close connections.
     * Call this at agent shutdown.
     */
    sleep(): Promise<void>;
    /**
     * Store a memory. Embeds content automatically.
     */
    store(input: MemoryInput): Promise<Memory>;
    /**
     * Store multiple memories in parallel.
     */
    storeMany(inputs: MemoryInput[]): Promise<Memory[]>;
    /**
     * Semantic search over stored memories.
     */
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Retrieve a memory by ID.
     */
    get(id: string): Promise<Memory | null>;
    /**
     * Delete a memory permanently.
     */
    forget(id: string): Promise<void>;
    /**
     * List recent memories for this agent.
     */
    list(limit?: number): Promise<Memory[]>;
    private ensureReady;
}

/**
 * In-process MemoryAdapter — no persistence, ideal for testing and ephemeral agents.
 * The simplest possible trace: exists only as long as the process lives.
 */
declare class MemoryAdapter implements IMemoryAdapter {
    private _cache;
    init(): Promise<void>;
    store(memory: Memory): Promise<Memory>;
    get(id: string): Promise<Memory | null>;
    search(embedding: number[], options: Required<SearchOptions>): Promise<SearchResult[]>;
    forget(id: string): Promise<void>;
    list(agentId: string, limit?: number): Promise<Memory[]>;
    close(): Promise<void>;
    get size(): number;
}

/**
 * PostgresAdapter — uses pgvector for semantic similarity search.
 *
 * TODO: implement with `pg` + pgvector extension.
 * Requires: CREATE EXTENSION IF NOT EXISTS vector;
 *
 * Schema:
 *   CREATE TABLE engram_memories (
 *     id          TEXT PRIMARY KEY,
 *     agent_id    TEXT NOT NULL,
 *     content     TEXT NOT NULL,
 *     embedding   vector(1536),
 *     importance  FLOAT NOT NULL DEFAULT 0.5,
 *     metadata    JSONB NOT NULL DEFAULT '{}',
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     access_count INT NOT NULL DEFAULT 0
 *   );
 *   CREATE INDEX ON engram_memories USING ivfflat (embedding vector_cosine_ops);
 */
declare class PostgresAdapter implements IMemoryAdapter {
    private readonly connectionString;
    constructor(connectionString: string);
    init(): Promise<void>;
    store(_memory: Memory): Promise<Memory>;
    get(_id: string): Promise<Memory | null>;
    search(_embedding: number[], _options: Required<SearchOptions>): Promise<SearchResult[]>;
    forget(_id: string): Promise<void>;
    list(_agentId: string, _limit?: number): Promise<Memory[]>;
    close(): Promise<void>;
}

/**
 * SqliteAdapter — local file-backed persistence with vector search.
 *
 * TODO: implement with `better-sqlite3` + manual cosine similarity
 * (sqlite-vss or sqlite-vec extension optional).
 */
declare class SqliteAdapter implements IMemoryAdapter {
    private readonly filePath;
    constructor(filePath: string);
    init(): Promise<void>;
    store(_memory: Memory): Promise<Memory>;
    get(_id: string): Promise<Memory | null>;
    search(_embedding: number[], _options: Required<SearchOptions>): Promise<SearchResult[]>;
    forget(_id: string): Promise<void>;
    list(_agentId: string, _limit?: number): Promise<Memory[]>;
    close(): Promise<void>;
}

/**
 * Embedding generation utilities.
 *
 * The placeholder implementation returns a random unit vector.
 * Replace embedText() with a real model call before production:
 *   - OpenAI: text-embedding-3-small (1536 dims)
 *   - Ollama: nomic-embed-text (768 dims)
 *   - Local: @xenova/transformers all-MiniLM-L6-v2 (384 dims)
 */
declare const DEFAULT_DIMENSIONS = 1536;
/**
 * TODO: replace with real embedding model.
 * Currently returns a random unit vector of the specified dimensionality.
 */
declare function embedText(text: string, dimensions?: number): Promise<number[]>;
/**
 * Batch embed multiple texts.
 */
declare function embedBatch(texts: string[], dimensions?: number): Promise<number[][]>;

/**
 * Cosine similarity between two vectors.
 * Returns a value in [-1, 1]. Higher = more similar.
 */
declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Euclidean distance between two vectors.
 */
declare function euclideanDistance(a: number[], b: number[]): number;

export { type AdapterType, DEFAULT_DIMENSIONS, Engram, type EngramConfig, type IMemoryAdapter, type Memory, MemoryAdapter, type MemoryInput, PostgresAdapter, type SearchOptions, type SearchResult, SqliteAdapter, cosineSimilarity, embedBatch, embedText, euclideanDistance };
