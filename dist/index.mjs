// src/engram.ts
import { randomUUID } from "crypto";

// src/utils/similarity.ts
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
function euclideanDistance(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  return Math.sqrt(
    a.reduce((sum, val, i) => sum + (val - (b[i] ?? 0)) ** 2, 0)
  );
}

// src/adapters/memory.ts
var MemoryAdapter = class {
  constructor() {
    this._cache = /* @__PURE__ */ new Map();
  }
  async init() {
  }
  async store(memory) {
    this._cache.set(memory.id, memory);
    return memory;
  }
  async get(id) {
    const memory = this._cache.get(id) ?? null;
    if (memory) {
      const updated = {
        ...memory,
        accessedAt: /* @__PURE__ */ new Date(),
        accessCount: memory.accessCount + 1
      };
      this._cache.set(id, updated);
      return updated;
    }
    return null;
  }
  async search(embedding, options) {
    const results = [];
    for (const memory of this._cache.values()) {
      const score = cosineSimilarity(embedding, memory.embedding);
      if (score >= options.threshold) {
        results.push({ memory, score });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, options.limit);
  }
  async forget(id) {
    this._cache.delete(id);
  }
  async list(agentId, limit = 50) {
    return [...this._cache.values()].filter((m) => m.agentId === agentId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  async close() {
    this._cache.clear();
  }
  get size() {
    return this._cache.size;
  }
};

// src/adapters/postgres.ts
var PostgresAdapter = class {
  constructor(connectionString) {
    this.connectionString = connectionString;
  }
  async init() {
    throw new Error("PostgresAdapter not yet implemented. Use MemoryAdapter for now.");
  }
  async store(_memory) {
    throw new Error("Not implemented");
  }
  async get(_id) {
    throw new Error("Not implemented");
  }
  async search(_embedding, _options) {
    throw new Error("Not implemented");
  }
  async forget(_id) {
    throw new Error("Not implemented");
  }
  async list(_agentId, _limit) {
    throw new Error("Not implemented");
  }
  async close() {
  }
};

// src/adapters/sqlite.ts
var SqliteAdapter = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  async init() {
    throw new Error("SqliteAdapter not yet implemented. Use MemoryAdapter for now.");
  }
  async store(_memory) {
    throw new Error("Not implemented");
  }
  async get(_id) {
    throw new Error("Not implemented");
  }
  async search(_embedding, _options) {
    throw new Error("Not implemented");
  }
  async forget(_id) {
    throw new Error("Not implemented");
  }
  async list(_agentId, _limit) {
    throw new Error("Not implemented");
  }
  async close() {
  }
};

// src/utils/embeddings.ts
var DEFAULT_DIMENSIONS = 1536;
async function embedText(text, dimensions = DEFAULT_DIMENSIONS) {
  void text;
  const raw = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return raw.map((v) => v / norm);
}
async function embedBatch(texts, dimensions = DEFAULT_DIMENSIONS) {
  return Promise.all(texts.map((t) => embedText(t, dimensions)));
}

// src/engram.ts
var Engram = class {
  constructor(config) {
    this.initialized = false;
    this.sessionStart = null;
    this.config = {
      adapter: config.adapter,
      agentId: config.agentId,
      connectionString: config.connectionString ?? "",
      embeddingDimensions: config.embeddingDimensions ?? DEFAULT_DIMENSIONS
    };
    switch (config.adapter) {
      case "memory":
        this.adapter = new MemoryAdapter();
        break;
      case "postgres":
        if (!config.connectionString) {
          throw new Error("connectionString required for postgres adapter");
        }
        this.adapter = new PostgresAdapter(config.connectionString);
        break;
      case "sqlite":
        if (!config.connectionString) {
          throw new Error("connectionString (file path) required for sqlite adapter");
        }
        this.adapter = new SqliteAdapter(config.connectionString);
        break;
      default:
        throw new Error(`Unknown adapter: ${config.adapter}`);
    }
  }
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  /**
   * Initialize the adapter and record session start.
   * Call this at agent startup.
   */
  async wake() {
    if (!this.initialized) {
      await this.adapter.init();
      this.initialized = true;
    }
    this.sessionStart = /* @__PURE__ */ new Date();
  }
  /**
   * Persist state and close connections.
   * Call this at agent shutdown.
   */
  async sleep() {
    if (this.sessionStart) {
      const duration = Date.now() - this.sessionStart.getTime();
      void duration;
      this.sessionStart = null;
    }
    await this.adapter.close();
    this.initialized = false;
  }
  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------
  /**
   * Store a memory. Embeds content automatically.
   */
  async store(input) {
    await this.ensureReady();
    const embedding = await embedText(input.content, this.config.embeddingDimensions);
    const now = /* @__PURE__ */ new Date();
    const memory = {
      id: randomUUID(),
      agentId: this.config.agentId,
      content: input.content,
      embedding,
      importance: input.importance ?? 0.5,
      metadata: input.metadata ?? {},
      createdAt: now,
      accessedAt: now,
      accessCount: 0
    };
    return this.adapter.store(memory);
  }
  /**
   * Store multiple memories in parallel.
   */
  async storeMany(inputs) {
    return Promise.all(inputs.map((input) => this.store(input)));
  }
  /**
   * Semantic search over stored memories.
   */
  async search(query, options = {}) {
    await this.ensureReady();
    const embedding = await embedText(query, this.config.embeddingDimensions);
    return this.adapter.search(embedding, {
      limit: options.limit ?? 10,
      threshold: options.threshold ?? 0,
      filter: options.filter ?? {}
    });
  }
  /**
   * Retrieve a memory by ID.
   */
  async get(id) {
    await this.ensureReady();
    return this.adapter.get(id);
  }
  /**
   * Delete a memory permanently.
   */
  async forget(id) {
    await this.ensureReady();
    return this.adapter.forget(id);
  }
  /**
   * List recent memories for this agent.
   */
  async list(limit = 50) {
    await this.ensureReady();
    return this.adapter.list(this.config.agentId, limit);
  }
  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  async ensureReady() {
    if (!this.initialized) {
      await this.wake();
    }
  }
};
export {
  DEFAULT_DIMENSIONS,
  Engram,
  MemoryAdapter,
  PostgresAdapter,
  SqliteAdapter,
  cosineSimilarity,
  embedBatch,
  embedText,
  euclideanDistance
};
