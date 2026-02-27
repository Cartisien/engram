import type { IMemoryAdapter, Memory, SearchOptions, SearchResult } from '../types.js'

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
export class PostgresAdapter implements IMemoryAdapter {
  constructor(private readonly connectionString: string) {}

  async init(): Promise<void> {
    throw new Error('PostgresAdapter not yet implemented. Use MemoryAdapter for now.')
  }

  async store(_memory: Memory): Promise<Memory> {
    throw new Error('Not implemented')
  }

  async get(_id: string): Promise<Memory | null> {
    throw new Error('Not implemented')
  }

  async search(_embedding: number[], _options: Required<SearchOptions>): Promise<SearchResult[]> {
    throw new Error('Not implemented')
  }

  async forget(_id: string): Promise<void> {
    throw new Error('Not implemented')
  }

  async list(_agentId: string, _limit?: number): Promise<Memory[]> {
    throw new Error('Not implemented')
  }

  async close(): Promise<void> {
    // no-op until implemented
  }
}
