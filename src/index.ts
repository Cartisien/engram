export { Engram } from './engram.js'
export { MemoryAdapter } from './adapters/memory.js'
export { PostgresAdapter } from './adapters/postgres.js'
export { SqliteAdapter } from './adapters/sqlite.js'
export { embedText, embedBatch, DEFAULT_DIMENSIONS } from './utils/embeddings.js'
export { cosineSimilarity, euclideanDistance } from './utils/similarity.js'
export type {
  Memory,
  MemoryInput,
  SearchResult,
  SearchOptions,
  EngramConfig,
  AdapterType,
  IMemoryAdapter,
} from './types.js'
