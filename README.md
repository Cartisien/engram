# @cartisien/engram

> Persistent semantic memory for AI agents.

*Memory is not a static record. It is a trace — context-dependent, deferred, and always open to reinterpretation. Every recall is a rewriting.*
— Inspired by Derrida, *Of Grammatology*

---

## Install

```bash
npm install @cartisien/engram
```

## Quick Start

```ts
import { Engram } from '@cartisien/engram'

const mem = new Engram({
  adapter: 'memory',    // 'memory' | 'postgres' | 'sqlite'
  agentId: 'my-agent',
})

await mem.wake()

// Store a memory
const m = await mem.store({
  content: 'The user prefers dark mode and works late at night',
  metadata: { source: 'observation', confidence: 0.9 },
  importance: 0.7,
})

// Semantic search
const results = await mem.search('user interface preferences', { limit: 5 })
results.forEach(({ memory, score }) => {
  console.log(score.toFixed(3), memory.content)
})

// Retrieve by ID
const fetched = await mem.get(m.id)

// Forget
await mem.forget(m.id)

await mem.sleep()
```

---

## API

### `new Engram(config)`

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `'memory' \| 'postgres' \| 'sqlite'` | Storage backend |
| `agentId` | `string` | Unique agent identifier |
| `connectionString` | `string?` | Required for `postgres` and `sqlite` |
| `embeddingDimensions` | `number?` | Vector size (default `1536`) |

### Methods

| Method | Description |
|--------|-------------|
| `wake()` | Initialize adapter, record session start |
| `sleep()` | Persist state, close connections |
| `store(input)` | Embed and store a memory |
| `storeMany(inputs[])` | Batch store |
| `search(query, options?)` | Semantic search — returns `SearchResult[]` |
| `get(id)` | Retrieve by ID |
| `forget(id)` | Delete permanently |
| `list(limit?)` | List recent memories for this agent |

---

## Adapters

| Adapter | Status | Notes |
|---------|--------|-------|
| `memory` | ✅ Ready | In-process, no persistence. Ideal for tests. |
| `postgres` | 🔜 Planned | pgvector, ivfflat index |
| `sqlite` | 🔜 Planned | Local file, cosine similarity in-process |

---

## The Philosophy

Engram sits between **Cogito** (agent identity) and **Extensa** (vector infrastructure) in the Cartisien memory stack.

```
Cogito  ←→  Engram  ←→  Extensa
identity    memory      vectors
```

Where Descartes separated mind (*res cogitans*) from body (*res extensa*), Engram is the bridge — the thinking substance that persists across sessions, the trace that makes continuity possible without claiming a fixed self.

---

## License

MIT © Cartisien Interactive
