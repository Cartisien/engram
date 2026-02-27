/**
 * Core types for @cartisien/engram
 *
 * A memory is a trace — not a static record, but a living artifact
 * that shifts meaning based on what comes after it. (Derrida, Of Grammatology)
 */

export interface Memory {
  id: string
  agentId: string
  content: string
  embedding: number[]
  importance: number
  metadata: Record<string, unknown>
  createdAt: Date
  accessedAt: Date
  accessCount: number
}

export interface MemoryInput {
  content: string
  metadata?: Record<string, unknown>
  importance?: number // 0.0 – 1.0, default 0.5
}

export interface SearchResult {
  memory: Memory
  score: number // cosine similarity 0.0 – 1.0
}

export interface SearchOptions {
  limit?: number      // default 10
  threshold?: number  // minimum similarity score, default 0.0
  filter?: Partial<Memory['metadata']>
}

export type AdapterType = 'memory' | 'postgres' | 'sqlite'

export interface EngramConfig {
  adapter: AdapterType
  agentId: string
  connectionString?: string // required for postgres / sqlite
  embeddingDimensions?: number // default 1536
}

export interface IMemoryAdapter {
  init(): Promise<void>
  store(memory: Memory): Promise<Memory>
  get(id: string): Promise<Memory | null>
  search(embedding: number[], options: Required<SearchOptions>): Promise<SearchResult[]>
  forget(id: string): Promise<void>
  list(agentId: string, limit?: number): Promise<Memory[]>
  close(): Promise<void>
}
