# Engram

> Persistent semantic memory for AI agents — local-first, zero cloud, zero config.

[![npm](https://img.shields.io/npm/v/@cartisien/engram)](https://www.npmjs.com/package/@cartisien/engram)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18988892.svg)](https://doi.org/10.5281/zenodo.18988892)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Quickstart — 30 seconds

### Claude Desktop / Cursor (MCP)

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

That's it. Engram gives Claude persistent memory across conversations — stored locally in a SQLite file, no API key required.

→ Full MCP docs: [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp)

---

### TypeScript / Node.js SDK

```bash
npm install @cartisien/engram
```

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram(); // zero config — saves to ./engram.db

await memory.remember('user_123', 'Prefers TypeScript and dark mode');
const context = await memory.recall('user_123', 'what does this user prefer?');
// → [{ content: 'Prefers TypeScript and dark mode', similarity: 0.91 }]
```

No Ollama? It falls back to keyword search automatically and tells you:
```
[engram] Ollama not found — falling back to keyword search.
         For semantic search: install Ollama and run: ollama pull nomic-embed-text
```

---

### Python SDK

```bash
pip install cartisien-engram
```

```python
from cartisien_engram import Engram

memory = Engram()  # saves to ./engram.db

memory.remember("user_123", "Prefers dark mode and async Python")
context = memory.recall("user_123", "user preferences")
```

---

## Drop into your agent

Paste this into any LLM chat handler:

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram();

async function chat(sessionId: string, userMessage: string, llm: any) {
  // 1. Pull relevant context before calling LLM
  const context = await memory.recall(sessionId, userMessage, 5);
  const contextStr = context.map(m => m.content).join('\n');

  // 2. Call your LLM with memory in the system prompt
  const response = await llm.chat({
    system: `Relevant context from memory:\n${contextStr}`,
    user: userMessage,
  });

  // 3. Store both sides
  await memory.remember(sessionId, userMessage, 'user');
  await memory.remember(sessionId, response, 'assistant');

  return response;
}
```

**Vercel AI SDK:**
```typescript
import { Engram } from '@cartisien/engram';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const memory = new Engram();

export async function POST(req: Request) {
  const { messages, sessionId } = await req.json();
  const lastMessage = messages.at(-1)?.content ?? '';

  const context = await memory.recall(sessionId, lastMessage, 5);
  const contextStr = context.map(m => m.content).join('\n');

  // Store user message
  await memory.remember(sessionId, lastMessage, 'user');

  const result = streamText({
    model: openai('gpt-4o'),
    system: context.length ? `Memory:\n${contextStr}` : undefined,
    messages,
    onFinish: async ({ text }) => {
      await memory.remember(sessionId, text, 'assistant');
    },
  });

  return result.toDataStreamResponse();
}
```

---

## Why Engram

AI assistants forget everything between conversations. Most memory solutions either:
- Require cloud accounts and send your data to their servers
- Store raw chunks that go stale and contradict each other

Engram stores memories as **evolving beliefs** — locally, in SQLite, with no cloud dependency.

| | Engram | Mem0 | Zep |
|---|---|---|---|
| Local-first | ✅ | ⚠️ self-host option | ⚠️ self-host option |
| Zero API key | ✅ | ❌ | ❌ |
| Zero config | ✅ | ❌ | ❌ |
| TypeScript-first | ✅ | ❌ Python-first | ❌ Python-first |
| MCP native | ✅ | ❌ | ❌ |
| Belief revision | ✅ | ⚠️ | ❌ |
| Open source | ✅ MIT | ✅ | ✅ |

---

## Semantic search setup (optional)

Engram uses Ollama for local embeddings. Without it, keyword search works automatically.

```bash
# Install Ollama: https://ollama.ai
ollama pull nomic-embed-text
```

That's the only setup step. Engram detects it automatically.

---

## API

### Core

```typescript
const memory = new Engram(config?)
```

Config defaults (all optional):

| Option | Default | Description |
|--------|---------|-------------|
| `dbPath` | `./engram.db` | SQLite file path |
| `embeddingUrl` | `$OLLAMA_URL` or `http://localhost:11434` | Ollama base URL |
| `embeddingModel` | `nomic-embed-text` | Embedding model |
| `semanticSearch` | `true` | Enable semantic search |
| `graphMemory` | `false` | Entity relationship extraction |
| `autoConsolidate` | `false` | Auto-summarize old memories |

### `remember(sessionId, content, role?, metadata?)`
Store a memory. Embedding generated automatically.

```typescript
await memory.remember('session_1', 'User is vegetarian', 'user');
```

### `recall(sessionId, query?, limit?, options?)`
Retrieve relevant memories. Semantic + keyword + recency, merged via RRF.

```typescript
const results = await memory.recall('session_1', 'dietary preferences', 5);
// [{ content: 'User is vegetarian', similarity: 0.91, certainty: 0.5, ... }]
```

### `history(sessionId, limit?)`
Chronological conversation history.

```typescript
const chat = await memory.history('session_1', 20);
```

### `forget(sessionId, options?)`
Delete memories.

```typescript
await memory.forget('session_1');                           // all
await memory.forget('session_1', { id: 'entry_id' });      // one
await memory.forget('session_1', { before: new Date() });  // old
```

### `stats(sessionId)`
Memory counts by tier, role, embeddings.

```typescript
const s = await memory.stats('session_1');
// { total: 42, byTier: { working: 30, long_term: 12 }, withEmbeddings: 42 }
```

---

## Belief revision

Every memory has a `certainty` score (0–1). Stale or contradicted memories fade naturally.

```typescript
// Confirm a memory
await memory.reinforce(entryId);               // certainty += 0.15

// Flag a contradiction — old memory marked contradicted, new one stored
await memory.contradict('session_1', oldId, 'User switched to dark mode');

// Remove a memory from recall
await memory.invalidate(entryId);

// Detect contradictions before storing
const result = await memory.detectContradictions('session_1', newContent);
if (result.detected) { /* handle */ }
```

---

## Consolidation

Summarize old working memories into dense long-term entries via local LLM.

```typescript
const memory = new Engram({
  autoConsolidate: true,
  consolidateThreshold: 100,  // trigger when working memories exceed this
  consolidateModel: 'qwen2.5:32b',
});

// Or manually
const result = await memory.consolidate('session_1');
// → { summarized: 50, created: 4, archived: 50 }

// Preview without writing
const preview = await memory.consolidate('session_1', { dryRun: true });
```

---

## Graph memory

Entity-relationship extraction for connected context.

```typescript
const memory = new Engram({ graphMemory: true });

// After remembering "Jeff is building GovScout with MUI and React"
const graph = await memory.graph('session_1', 'GovScout');
// {
//   entity: 'govscout',
//   relationships: [
//     { type: 'outgoing', relation: 'uses', target: 'mui' },
//     { type: 'outgoing', relation: 'built_by', target: 'jeff' },
//   ]
// }

// Auto-augment recall with graph-connected memories
const results = await memory.recall('session_1', 'what is GovScout?', 5, {
  includeGraph: true,
});
```

---

## reflect()

Synthesize insights across memories — actual reasoning, not just retrieval.

```typescript
const result = await memory.reflect('session_1', 'What does this user care most about?');
// → {
//   insights: [
//     'User strongly prefers TypeScript over JavaScript',
//     'Has a recurring deadline sensitivity around Fridays',
//   ],
//   memoriesUsed: [...],
// }
```

---

## User-scoped memory

Persist facts about a user across all sessions.

```typescript
await memory.rememberUser('user_jeff', 'Prefers TypeScript');
await memory.rememberUser('user_jeff', 'Timezone: America/New_York');

// Blend into any session recall
const results = await memory.recall('any_session', 'preferences', 10, {
  userId: 'user_jeff',
});
```

---

## Remote client

Connect to a self-hosted Engram server.

```typescript
import { EngramClient } from '@cartisien/engram';

const memory = new EngramClient({ baseUrl: 'http://your-server:3470' });
// Same API as Engram
```

---

## The Cartisien Memory Suite

| Package | Purpose |
|---------|---------|
| [`@cartisien/engram`](https://github.com/Cartisien/engram) | Memory SDK — **this package** |
| [`@cartisien/engram-mcp`](https://github.com/Cartisien/engram-mcp) | MCP server for Claude Desktop / Cursor |
| `@cartisien/extensa` | Vector infrastructure |
| `@cartisien/cogito` | Agent identity & lifecycle |

---

## License

MIT © [Cartisien Interactive](https://cartisien.com)
