# Engram

> **Persistent semantic memory for AI agents.**

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

Stuffing everything into the system prompt wastes tokens and still misses things. You need a retrieval layer — not a dump.

## The Solution

Engram gives your agents **persistent, semantically searchable memory** — SQLite-backed, TypeScript-first, zero config.

- **Semantic search:** Finds relevant memories by meaning, not just keywords (via local Ollama embeddings)
- **Zero config:** Works out of the box, falls back to keyword search without Ollama
- **Local-first:** Your data stays on your machine. No API keys, no cloud required
- **MCP-native:** Drop into Claude Desktop or Cursor via [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp)
- **Typed:** Full TypeScript support

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

### `stats(sessionId)`

```typescript
const stats = await memory.stats('session_abc');
// { total: 42, byRole: { user: 21, assistant: 21 }, withEmbeddings: 42, graphNodes: 18, graphEdges: 31 }
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
- **v0.4** 📋 Memory consolidation, long-term summarization

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
