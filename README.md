# Engram

> **Persistent memory for AI assistants.**

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram({ dbPath: './memory.db' });

// Store
await memory.remember('user_123', 'I ride a Triumph Bonneville', 'user');

// Recall
const context = await memory.recall('user_123', 'What motorcycle?', 5);
// [{ role: 'user', content: 'I ride a Triumph Bonneville', ... }]
```

---

## The Problem

AI assistants are amnesiacs. Every conversation starts fresh. Context windows fill up. Important details get lost.

You wouldn't hire an employee who forgot every meeting. Why accept it from your AI?

## The Solution

Engram gives your assistants **persistent, queryable memory** — backed by SQLite, designed for simplicity.

- **Zero config:** Works out of the box
- **Fast:** SQLite with proper indexes
- **Portable:** Single file database
- **Typed:** Full TypeScript support

## Installation

```bash
npm install @cartisien/engram
```

## Quick Start

```typescript
import { Engram } from '@cartisien/engram';

const memory = new Engram({
  dbPath: './bot-memory.db'  // or ':memory:' for ephemeral
});

// In your chat handler
async function handleChat(sessionId: string, message: string) {
  // 1. Store the user's message
  await memory.remember(sessionId, message, 'user');
  
  // 2. Retrieve relevant context
  const context = await memory.recall(sessionId, message, 5);
  
  // 3. Build prompt with memory
  const prompt = buildPrompt(context, message);
  
  // 4. Get AI response
  const response = await openai.chat.completions.create({ messages: prompt });
  
  // 5. Store the response
  await memory.remember(sessionId, response.choices[0].message.content, 'assistant');
  
  return response;
}
```

## API

### `new Engram(config?)`

Create a memory instance.

```typescript
const memory = new Engram({
  dbPath: './memory.db',        // Database file path
  maxContextLength: 4000        // Max characters per entry
});
```

### `remember(sessionId, content, role?, metadata?)`

Store a memory entry.

```typescript
await memory.remember('session_abc', 'User loves Thai food', 'user', {
  source: 'preference_extraction'
});
```

### `recall(sessionId, query?, limit?, options?)`

Retrieve memories for a session.

```typescript
// Recent memories
const recent = await memory.recall('session_abc', undefined, 10);

// Keyword search
const relevant = await memory.recall('session_abc', 'food preferences', 5);

// Filtered
const userOnly = await memory.recall('session_abc', undefined, 10, { role: 'user' });
```

### `history(sessionId, limit?)`

Get chronological conversation history.

```typescript
const chat = await memory.history('session_abc', 20);
```

### `forget(sessionId, options?)`

Delete memories.

```typescript
// Delete all for session
await memory.forget('session_abc');

// Delete specific entry
await memory.forget('session_abc', { id: 'entry_id' });

// Delete old entries
await memory.forget('session_abc', { before: new Date('2024-01-01') });
```

### `stats(sessionId)`

Get memory statistics.

```typescript
const stats = await memory.stats('session_abc');
// { total: 42, byRole: { user: 21, assistant: 21 }, ... }
```

## Philosophy

> *"The trace precedes presence."* — Derrida

Memory isn't storage. It's the substrate of self.

Engram doesn't just persist data. It gives your assistants **continuity** — the ability to learn, reference, and grow across conversations. The Cartesian cogito assumed memory was given. We're making it so.

## Roadmap

- **v0.1** ✅ SQLite persistence, keyword search
- **v0.2** 🚧 Semantic search with embeddings
- **v0.3** 📋 Multi-session context, memory consolidation
- **v0.4** 📋 Cloud sync, distributed memory

## The Trilogy

Engram is part of the **Cartisien Memory Suite**:

| Package | Purpose |
|---------|---------|
| `@cartisien/engram` | **This package** — persistent memory SDK |
| `@cartisien/extensa` | Vector infrastructure (coming soon) |
| `@cartisien/cogito` | Identity & state management (coming soon) |

*Res cogitans meets res extensa.*

## License

MIT © Cartisien Interactive

---

**Built with 🖤 by people who think forgetting is a bug.**
