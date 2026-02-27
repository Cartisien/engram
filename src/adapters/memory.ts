import type { IMemoryAdapter, Memory, SearchOptions, SearchResult } from '../types.js'
import { cosineSimilarity } from '../utils/similarity.js'

/**
 * In-process MemoryAdapter — no persistence, ideal for testing and ephemeral agents.
 * The simplest possible trace: exists only as long as the process lives.
 */
export class MemoryAdapter implements IMemoryAdapter {
  private _cache = new Map<string, Memory>()

  async init(): Promise<void> {
    // nothing to set up
  }

  async store(memory: Memory): Promise<Memory> {
    this._cache.set(memory.id, memory)
    return memory
  }

  async get(id: string): Promise<Memory | null> {
    const memory = this._cache.get(id) ?? null
    if (memory) {
      const updated: Memory = {
        ...memory,
        accessedAt: new Date(),
        accessCount: memory.accessCount + 1,
      }
      this._cache.set(id, updated)
      return updated
    }
    return null
  }

  async search(
    embedding: number[],
    options: Required<SearchOptions>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = []

    for (const memory of this._cache.values()) {
      const score = cosineSimilarity(embedding, memory.embedding)
      if (score >= options.threshold) {
        results.push({ memory, score })
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit)
  }

  async forget(id: string): Promise<void> {
    this._cache.delete(id)
  }

  async list(agentId: string, limit = 50): Promise<Memory[]> {
    return [...this._cache.values()]
      .filter((m) => m.agentId === agentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  async close(): Promise<void> {
    this._cache.clear()
  }

  get size(): number {
    return this._cache.size
  }
}
