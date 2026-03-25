# @cartisien/engram

Persistent semantic memory for AI agents. Store, search, and retrieve conversational memory with embeddings, graph relationships, and hybrid search.

## Features

- **Persistent Storage**: SQLite-backed with WAL mode for reliability
- **Semantic Search**: Vector similarity using embeddings (Ollama-compatible)
- **FTS5 Keyword Search**: Full-text search with BM25 ranking
- **Hybrid Scoring**: Combines semantic, keyword, importance, and recency
- **Graph Memory**: Extract and query entity relationships
- **Multi-hop Traversal**: Find paths between entities
- **User-Scoped Memory**: Cross-session memory persistence
- **Embedding Cache**: LRU cache to reduce API calls
- **Batch Operations**: Efficient batch embedding
- **Deduplication**: Automatic duplicate detection and merging
- **Memory Tiers**: Working, long-term, and archived tiers
- **Consolidation**: Automatic summarization of old memories

## Installation

```bash
npm install @cartisien/engram
```

## Quick Start

```typescript
import { Engram } from '@cartisien/engram';

const engram = new Engram({
  dbPath: './memory.db',
  semanticSearch: true,
  embeddingUrl: 'http://localhost:11434', // Ollama
  embeddingModel: 'nomic-embed-text',
});

await engram.init();

// Store a memory
await engram.remember('session-123', 'The user prefers TypeScript', 'user');

// Recall memories
const memories = await engram.recall('session-123', 'programming preferences');
```

## Configuration

```typescript
const engram = new Engram({
  // Database
  dbPath: './memory.db',           // SQLite file path
  enableWAL: true,                 // Write-Ahead Logging
  
  // Embeddings
  embeddingUrl: 'http://localhost:11434',
  embeddingModel: 'nomic-embed-text',
  semanticSearch: true,
  embeddingCacheSize: 1000,        // LRU cache size
  embeddingBatchSize: 10,          // Batch size for embeddings
  
  // Search
  enableFTS5: true,                // Full-text search
  dedupThreshold: 0.95,            // Duplicate detection threshold
  
  // Scoring
  enableImportanceScoring: false,  // Auto-calculate importance
  recencyHalfLifeDays: 30,         // Recency decay half-life
  
  // Graph
  graphMemory: false,              // Extract graph relationships
  graphMaxDepth: 3,                // Max traversal depth
  
  // Consolidation
  autoConsolidate: false,
  consolidateThreshold: 100,
  consolidateKeep: 20,
});
```

## Core Operations

### Store Memories

```typescript
// Session-scoped memory
await engram.remember(
  'session-123',           // session ID
  'User mentioned they like hiking',
  'user',                  // role: 'user' | 'assistant' | 'system'
  { source: 'chat' }       // optional metadata
);

// User-scoped memory (cross-session)
await engram.rememberUser(
  'user-456',
  'Preferences: dark mode, notifications off',
  'system'
);
```

### Recall Memories

```typescript
// Basic recall (recent memories)
const recent = await engram.recall('session-123');

// Semantic search
const relevant = await engram.recall('session-123', 'outdoor activities', {
  limit: 5,
  threshold: 0.7,
});

// With filters
const filtered = await engram.recall('session-123', 'hiking', {
  role: 'user',
  tiers: ['working', 'long_term'],
  before: new Date('2024-01-01'),
});

// Iterator for large result sets
for await (const memory of engram.recallIter('session-123', 'query')) {
  console.log(memory.content);
}
```

### Graph Operations

```typescript
// Store relationship
await engram.storeEdge(
  'session-123',
  'Alice',           // from entity
  'knows',           // relation
  'Bob',             // to entity
  1.0,               // confidence
  memory.id          // optional source memory
);

// Query entity
const graph = await engram.graph('session-123', 'Alice');
console.log(graph.relationships);

// Find path between entities
const path = await engram.graphPath(
  'session-123',
  'Alice',
  'Charlie',
  3                  // max depth
);
if (path.found) {
  console.log(`Path found with ${path.hops} hops`);
}
```

### Memory Management

```typescript
// Get session stats
const stats = await engram.stats('session-123');
console.log(`${stats.total} memories, ${stats.graphNodes} entities`);

// Consolidate old memories
const result = await engram.consolidate('session-123', {
  keep: 20,          // preserve recent memories
  dryRun: true,      // preview only
});

// Delete specific memory
await engram.forget('session-123', { id: memoryId });

// Delete old memories
await engram.forget('session-123', {
  before: new Date('2024-01-01'),
  includeLongTerm: false,
});
```

## Hybrid Search

Engram combines multiple signals for ranking:

```typescript
// Default weights
const weights = {
  semantic: 0.5,    // Vector similarity
  keyword: 0.25,    // FTS5 BM25 score
  importance: 0.15, // Memory importance (0-1)
  recency: 0.1,     // Time decay
};

const memories = await engram.recall('session-123', 'machine learning', {
  applyDecay: true,
});
```

The `combinedScore` is normalized (0-1) and memories are sorted by this score.

## Caching

```typescript
// Embedding cache (LRU)
const cache = new EmbeddingCache({ maxSize: 1000 });
cache.set(contentHash, embedding);
const cached = cache.get(contentHash);

// Check stats
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
```

## Deduplication

```typescript
import { findSimilarInList, deduplicateMemories } from '@cartisien/engram';

// Find similar memories
const similar = findSimilarInList(queryEmbedding, memories, 0.95);

// Deduplicate a list
const unique = deduplicateMemories(memories, 0.95);
```

## Batch Operations

```typescript
// Batch embed multiple texts
const embeddings = await engram.embedBatch([
  'text 1',
  'text 2',
  'text 3',
]);

// Manual batch embedding
import { embedBatch } from '@cartisien/engram';
const results = await embedBatch(
  texts,
  embedFn,
  10  // batch size
);
```

## TypeScript Types

```typescript
import type {
  MemoryEntry,
  UserMemoryEntry,
  MemoryTier,
  MemoryRole,
  RecallOptions,
  GraphResult,
  GraphPathResult,
  SessionStats,
  EngramConfig,
} from '@cartisien/engram';
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Architecture

```
src/
├── index.ts              # Main Engram class
├── types.ts              # TypeScript types
├── cache/
│   └── embedding-cache.ts # LRU embedding cache
├── search/
│   ├── fts5.ts           # Full-text search
│   └── hybrid.ts         # Hybrid scoring
├── utils/
│   ├── batch.ts          # Batch embedding
│   └── dedup.ts          # Deduplication
└── graph/
    └── traversal.ts      # Graph operations
```

## Requirements

- Node.js 18+
- SQLite 3 with FTS5 support
- Ollama (optional, for embeddings)

## License

MIT

## Changelog

### v0.7.0
- Added embedding cache (LRU)
- Added batch embedding support
- Added FTS5 keyword search
- Added hybrid search with recency decay
- Added importance scoring
- Added graph memory and multi-hop traversal
- Added deduplication utilities
- Added user-scoped memory
- Added WAL mode for SQLite
- Improved consolidation
