import type { IMemoryAdapter, Memory, SearchOptions, SearchResult } from '../types.js'

/**
 * SqliteAdapter — local file-backed persistence with vector search.
 *
 * TODO: implement with `better-sqlite3` + manual cosine similarity
 * (sqlite-vss or sqlite-vec extension optional).
 */
export class SqliteAdapter implements IMemoryAdapter {
  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    throw new Error('SqliteAdapter not yet implemented. Use MemoryAdapter for now.')
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
