import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Engram } from '../src/engram.js'
import { MemoryAdapter } from '../src/adapters/memory.js'
import { cosineSimilarity } from '../src/utils/similarity.js'

describe('Engram (MemoryAdapter)', () => {
  let engram: Engram

  beforeEach(async () => {
    engram = new Engram({ adapter: 'memory', agentId: 'test-agent' })
    await engram.wake()
  })

  afterEach(async () => {
    await engram.sleep()
  })

  // ---------------------------------------------------------------------------
  // store / get
  // ---------------------------------------------------------------------------

  it('stores and retrieves a memory by id', async () => {
    const stored = await engram.store({ content: 'The user prefers dark mode' })
    expect(stored.id).toBeTruthy()
    expect(stored.content).toBe('The user prefers dark mode')
    expect(stored.agentId).toBe('test-agent')
    expect(stored.embedding).toHaveLength(1536)
    expect(stored.importance).toBe(0.5)

    const retrieved = await engram.get(stored.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.content).toBe('The user prefers dark mode')
  })

  it('returns null for unknown id', async () => {
    const result = await engram.get('does-not-exist')
    expect(result).toBeNull()
  })

  it('respects custom importance and metadata', async () => {
    const stored = await engram.store({
      content: 'Critical system alert',
      importance: 0.9,
      metadata: { source: 'system', priority: 'high' },
    })
    expect(stored.importance).toBe(0.9)
    expect(stored.metadata).toEqual({ source: 'system', priority: 'high' })
  })

  // ---------------------------------------------------------------------------
  // storeMany
  // ---------------------------------------------------------------------------

  it('stores multiple memories in parallel', async () => {
    const memories = await engram.storeMany([
      { content: 'First memory' },
      { content: 'Second memory' },
      { content: 'Third memory' },
    ])
    expect(memories).toHaveLength(3)
    expect(new Set(memories.map((m) => m.id)).size).toBe(3) // all unique ids
  })

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------

  it('returns search results with scores', async () => {
    await engram.store({ content: 'Dark mode is preferred' })
    await engram.store({ content: 'The user lives in New York' })

    const results = await engram.search('user preferences')
    expect(results.length).toBeGreaterThan(0)
    results.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
      expect(r.memory.content).toBeTruthy()
    })
  })

  it('respects limit option', async () => {
    await engram.storeMany([
      { content: 'A' },
      { content: 'B' },
      { content: 'C' },
      { content: 'D' },
      { content: 'E' },
    ])
    const results = await engram.search('query', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('respects threshold option', async () => {
    await engram.store({ content: 'Something relevant' })
    // threshold of 1.0 should return nothing (random embeddings won't be identical)
    const results = await engram.search('query', { threshold: 1.0 })
    expect(results).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // forget
  // ---------------------------------------------------------------------------

  it('forgets a memory', async () => {
    const stored = await engram.store({ content: 'To be forgotten' })
    await engram.forget(stored.id)
    const retrieved = await engram.get(stored.id)
    expect(retrieved).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  it('lists memories for the agent', async () => {
    await engram.storeMany([
      { content: 'Memory 1' },
      { content: 'Memory 2' },
    ])
    const list = await engram.list()
    expect(list.length).toBeGreaterThanOrEqual(2)
    list.forEach((m) => expect(m.agentId).toBe('test-agent'))
  })

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  it('auto-wakes on first operation without explicit wake()', async () => {
    const fresh = new Engram({ adapter: 'memory', agentId: 'lazy-agent' })
    // no wake() call
    const stored = await fresh.store({ content: 'lazy init test' })
    expect(stored.id).toBeTruthy()
    await fresh.sleep()
  })
})

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 0, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch')
  })
})
