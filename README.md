# Engram

> **Persistent semantic memory for AI agents — local-first, zero cloud required.**

![Engram demo](assets/demo.gif)

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram({ dbPath: './memory.db' });

// Store
await memory.remember('user_123', 'User prefers TypeScript and dark mode', 'user');

// Recall semantically — finds the right memory even without exact keyword match
const context = await memory.recall('user_123', 'what are the user\'s preferences?', 5);
// [{ content: 'User prefers TypeScript and dark mode', similarity: 0.82, ... }]
```

---

## The Problem

AI assistants are amnesiacs. Every conversation starts fresh. Context windows fill up. Important details get lost.

Most memory systems fix retrieval but ignore the harder problem: **memories go stale, contradict each other, and vary in confidence.** Your agent ends up recalling outdated facts with the same certainty as confirmed ones.

And most send your memory content to OpenAI or another cloud LLM to process it — which means your agent's private context leaves your machine.

## The Solution

Engram gives your agents **persistent, evolving memory** — SQLite-backed, local-first, TypeScript and Python SDKs.

Memories aren't just stored. They're beliefs that evolve.

- **Local-first:** Memory never leaves your machine. All LLM processing uses local Ollama by default — no cloud, no API keys, no data leaving your infrastructure
- **Belief revision:** Every memory has a `certainty` score. `reinforce()` to confirm, `contradict()` to challenge, `invalidate()` to supersede. Outdated beliefs don't haunt your agent.
- **reflect():** Synthesize insights across memories before a task — not just retrieval, actual reasoning
- **Multi-strategy recall:** Semantic + BM25 keyword + temporal recency, merged via Reciprocal Rank Fusion
- **Importance scoring:** Heuristic scoring at write time. High-importance memories are protected from consolidation.
- **Graph memory:** Entity-relationship extraction — recall connected context automatically
- **Consolidation:** LLM summarizes old working memories into long-term entries. High-certainty memories are never compressed.
- **MCP-native:** Drop into Claude Desktop or Cursor via [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp)
- **Typed:** Full TypeScript + Python SDK at feature parity

> **Privacy note:** Engram defaults to local Ollama for all LLM operations (graph extraction, consolidation, importance scoring, reflection). Cloud is opt-in via `EngramClient`. Your agent's memory stays on your infrastructure.

## Installation

```bash
npm install @cartisien/engram
```

### Optional: Local Embeddings (Recommended)

For semantic search, install [Ollama](https://ollama.ai) and pull the embedding model:

```bash
ollama pull nomic-embed-text
```

Without Ollama, Engram falls back to keyword search automatically.

## Quick Start

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram({
  dbPath: './bot-memory.db',
  embeddingUrl: 'http://localhost:11434', // Ollama default
});

// In your agent/chat handler
async function handleMessage(sessionId: string, message: string) {
  // 1. Recall relevant context semantically
  const context = await memory.recall(sessionId, message, 5);

  // 2. Build prompt with memory
  const prompt = buildPrompt(context, message);

  // 3. Get AI response
  const response = await llm.chat(prompt);

  // 4. Store both sides
  await memory.remember(sessionId, message, 'user');
  await memory.remember(sessionId, response, 'assistant');

  return response;
}
```

## API

### `new Engram(config?)`

```typescript
const memory = new Engram({
  dbPath: './memory.db',           // SQLite file path (default: ':memory:')
  maxContextLength: 4000,          // Max chars per entry (default: 4000)
  embeddingUrl: 'http://localhost:11434',  // Ollama base URL
  embeddingModel: 'nomic-embed-text',     // Embedding model
  semanticSearch: true,            // Enable semantic search (default: true)
});
```

### `remember(sessionId, content, role?, metadata?)`

Store a memory. Embedding is generated automatically.

```typescript
await memory.remember('session_abc', 'User loves Thai food', 'user');
```

### `recall(sessionId, query?, limit?, options?)`

Retrieve relevant memories. Uses semantic search when available, keyword fallback otherwise. Returns entries sorted by similarity score.

```typescript
const results = await memory.recall('session_abc', 'food preferences', 5);
// [{ content: '...', similarity: 0.84, ... }]
```

### `history(sessionId, limit?)`

Chronological conversation history.

```typescript
const chat = await memory.history('session_abc', 20);
```

### `forget(sessionId, options?)`

Delete memories.

```typescript
await memory.forget('session_abc');                          // all
await memory.forget('session_abc', { id: 'entry_id' });     // one
await memory.forget('session_abc', { before: new Date() }); // old entries
```

### `graph(sessionId, entity)`

Returns a one-hop relationship map for a named entity — all connected entities and the memories that link them.

Requires `graphMemory: true` in config and a running Ollama instance with `qwen2.5:32b` (or override via `graphModel`).

```typescript
const memory = new Engram({
  dbPath: './memory.db',
  graphMemory: true,
  graphModel: 'qwen2.5:32b', // default
});

const graph = await memory.graph('session_abc', 'GovScout');
// {
//   entity: 'GovScout',
//   edges: [
//     { relation: 'uses', target: 'MUI', sourceMemoryId: '...' },
//     { relation: 'built_by', target: 'Jeff', sourceMemoryId: '...' },
//   ],
//   memories: [ { content: '...', ... } ]
// }
```

### `recall()` with graph augmentation

```typescript
const results = await memory.recall('session_abc', 'what is GovScout?', 5, {
  includeGraph: true, // augment top results with graph-connected memories
});
```

### `consolidate(sessionId, options?)` *(v0.4)*

Summarizes old working memories into dense long-term entries via a local LLM. Originals are archived (hidden from recall but not deleted).

```typescript
const memory = new Engram({
  dbPath: './memory.db',
  autoConsolidate: true,       // auto-trigger on remember() (default: false)
  consolidateThreshold: 100,   // trigger when working memories exceed this (default: 100)
  consolidateKeep: 20,         // keep N most recent working memories untouched (default: 20)
  consolidateBatch: 50,        // memories to process per run (default: 50)
  consolidateModel: 'qwen2.5:32b', // LLM for summarization
});

// Manual consolidation
const result = await memory.consolidate('session_abc');
// → { summarized: 50, created: 4, archived: 50 }

// Preview without writing
const preview = await memory.consolidate('session_abc', { dryRun: true });
// → { summarized: 50, created: 0, archived: 0, previews: ['User prefers TypeScript...', ...] }
```

**Memory tiers:**
- `working` — recent, granular memories (default)
- `long_term` — LLM-generated summaries of consolidated batches
- `archived` — original memories after consolidation (excluded from recall)

`recall()` searches `working` and `long_term` by default. Pass `tiers` to override:

```typescript
// Search all tiers including archived
const results = await memory.recall('session_abc', 'preferences', 10, {
  tiers: ['working', 'long_term', 'archived'],
});
```

### `stats(sessionId)`

```typescript
const stats = await memory.stats('session_abc');
// {
//   total: 42,
//   byRole: { user: 21, assistant: 21 },
//   byTier: { working: 30, long_term: 12, archived: 50 },
//   withEmbeddings: 42,
//   graphNodes: 18,
//   graphEdges: 31
// }
```

## MCP Server

Use Engram directly in Claude Desktop, Cursor, or any MCP client:

```bash
npx -y @cartisien/engram-mcp
```

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@cartisien/engram-mcp"]
    }
  }
}
```

→ [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp) on GitHub

## Philosophy

> *"The trace precedes presence."*

Memory isn't storage. It's the substrate of self.

Engram doesn't just persist data — it gives your agents **continuity**. The ability to learn, reference, and grow across conversations.

## Roadmap

- **v0.1** ✅ SQLite persistence, keyword search
- **v0.2** ✅ Semantic search via local Ollama embeddings
- **v0.3** ✅ Graph memory — entity relationships, connected context
- **v0.4** ✅ Memory consolidation, long-term summarization

## The Cartisien Memory Suite

| Package | Purpose |
|---------|---------|
| [`@cartisien/engram`](https://github.com/Cartisien/engram) | Persistent memory SDK — **this package** |
| [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp) | MCP server for Claude Desktop / Cursor |
| `@cartisien/extensa` | Vector infrastructure *(coming soon)* |
| `@cartisien/cogito` | Agent identity & lifecycle *(coming soon)* |

*Res cogitans meets res extensa.*

## License

MIT © [Cartisien Interactive](https://cartisien.com)

---

**Built for people who think forgetting is a bug.**
