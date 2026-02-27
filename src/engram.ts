import { randomUUID } from 'node:crypto'
import type {
  EngramConfig,
  IMemoryAdapter,
  Memory,
  MemoryInput,
  SearchOptions,
  SearchResult,
} from './types.js'
import { MemoryAdapter } from './adapters/memory.js'
import { PostgresAdapter } from './adapters/postgres.js'
import { SqliteAdapter } from './adapters/sqlite.js'
import { embedText, DEFAULT_DIMENSIONS } from './utils/embeddings.js'

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
export class Engram {
  private adapter: IMemoryAdapter
  private readonly config: Required<EngramConfig>
  private initialized = false
  private sessionStart: Date | null = null

  constructor(config: EngramConfig) {
    this.config = {
      adapter: config.adapter,
      agentId: config.agentId,
      connectionString: config.connectionString ?? '',
      embeddingDimensions: config.embeddingDimensions ?? DEFAULT_DIMENSIONS,
    }

    switch (config.adapter) {
      case 'memory':
        this.adapter = new MemoryAdapter()
        break
      case 'postgres':
        if (!config.connectionString) {
          throw new Error('connectionString required for postgres adapter')
        }
        this.adapter = new PostgresAdapter(config.connectionString)
        break
      case 'sqlite':
        if (!config.connectionString) {
          throw new Error('connectionString (file path) required for sqlite adapter')
        }
        this.adapter = new SqliteAdapter(config.connectionString)
        break
      default:
        throw new Error(`Unknown adapter: ${config.adapter as string}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the adapter and record session start.
   * Call this at agent startup.
   */
  async wake(): Promise<void> {
    if (!this.initialized) {
      await this.adapter.init()
      this.initialized = true
    }
    this.sessionStart = new Date()
  }

  /**
   * Persist state and close connections.
   * Call this at agent shutdown.
   */
  async sleep(): Promise<void> {
    if (this.sessionStart) {
      const duration = Date.now() - this.sessionStart.getTime()
      // TODO: emit session summary to a "session" memory
      void duration
      this.sessionStart = null
    }
    await this.adapter.close()
    this.initialized = false
  }

  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------

  /**
   * Store a memory. Embeds content automatically.
   */
  async store(input: MemoryInput): Promise<Memory> {
    await this.ensureReady()

    const embedding = await embedText(input.content, this.config.embeddingDimensions)
    const now = new Date()

    const memory: Memory = {
      id: randomUUID(),
      agentId: this.config.agentId,
      content: input.content,
      embedding,
      importance: input.importance ?? 0.5,
      metadata: input.metadata ?? {},
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
    }

    return this.adapter.store(memory)
  }

  /**
   * Store multiple memories in parallel.
   */
  async storeMany(inputs: MemoryInput[]): Promise<Memory[]> {
    return Promise.all(inputs.map((input) => this.store(input)))
  }

  /**
   * Semantic search over stored memories.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.ensureReady()

    const embedding = await embedText(query, this.config.embeddingDimensions)
    return this.adapter.search(embedding, {
      limit: options.limit ?? 10,
      threshold: options.threshold ?? 0.0,
      filter: options.filter ?? {},
    })
  }

  /**
   * Retrieve a memory by ID.
   */
  async get(id: string): Promise<Memory | null> {
    await this.ensureReady()
    return this.adapter.get(id)
  }

  /**
   * Delete a memory permanently.
   */
  async forget(id: string): Promise<void> {
    await this.ensureReady()
    return this.adapter.forget(id)
  }

  /**
   * List recent memories for this agent.
   */
  async list(limit = 50): Promise<Memory[]> {
    await this.ensureReady()
    return this.adapter.list(this.config.agentId, limit)
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.wake()
    }
  }
}
