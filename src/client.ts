/**
 * EngramClient — remote HTTP client for @cartisien/engram-server.
 *
 * Drop-in replacement for the local Engram class.
 * Switch from local SQLite to the hosted API with one config change:
 *
 * @example
 * ```typescript
 * // Local (dev)
 * import { Engram } from '@cartisien/engram';
 * const memory = new Engram({ dbPath: './memory.db' });
 *
 * // Hosted (prod) — same API, no code changes
 * import { EngramClient } from '@cartisien/engram';
 * const memory = new EngramClient({
 *   remoteUrl: 'https://memory.cartisien.com',
 *   apiKey: 'eng_...',
 * });
 * ```
 */

import type {
  MemoryEntry, MemoryTier, RecallOptions, ConsolidateOptions, ConsolidationResult,
  GraphResult, UserMemoryEntry,
} from './index.js';

export interface EngramClientConfig {
  remoteUrl: string;
  apiKey?: string;
  jwtToken?: string;
  /** Default session to use when no sessionId is passed */
  defaultSession?: string;
  /** Request timeout in ms (default 10000) */
  timeoutMs?: number;
}

export class EngramClient {
  private baseUrl: string;
  private authHeader: string;
  private defaultSession: string;
  private timeoutMs: number;

  constructor(config: EngramClientConfig) {
    this.baseUrl = config.remoteUrl.replace(/\/$/, '') + '/api/v1';
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.defaultSession = config.defaultSession ?? 'default';

    if (config.apiKey) {
      this.authHeader = `ApiKey ${config.apiKey}`;
    } else if (config.jwtToken) {
      this.authHeader = `Bearer ${config.jwtToken}`;
    } else {
      throw new Error('EngramClient requires apiKey or jwtToken');
    }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);

    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const init: RequestInit = {
      method,
      headers: { 'Authorization': this.authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(url.toString(), init);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
      throw new Error(`EngramClient ${method} ${path}: ${err.error ?? res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Session memory ──────────────────────────────────────────────────────

  async remember(
    sessionId: string,
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    return this.request<MemoryEntry>('POST', '/memories', { sessionId, content, role, metadata });
  }

  async recall(
    sessionId: string,
    query?: string,
    limit = 10,
    options: RecallOptions = {}
  ): Promise<MemoryEntry[]> {
    const res = await this.request<{ results: MemoryEntry[] }>('GET', '/memories', undefined, {
      sessionId,
      query,
      limit,
      tiers: options.tiers?.join(','),
      userId: options.userId,
    });
    return res.results;
  }

  async history(sessionId: string, limit = 20): Promise<MemoryEntry[]> {
    const res = await this.request<{ entries: MemoryEntry[] }>('GET', '/memories/history', undefined, {
      sessionId, limit,
    });
    return res.entries;
  }

  async forget(
    sessionId: string,
    options?: { id?: string; before?: Date; includeLongTerm?: boolean }
  ): Promise<number> {
    const res = await this.request<{ deleted: number }>('DELETE', '/memories', undefined, {
      sessionId,
      id: options?.id,
      before: options?.before?.toISOString(),
    });
    return res.deleted;
  }

  async stats(sessionId: string): Promise<{
    total: number;
    byRole: Record<string, number>;
    byTier: Record<MemoryTier, number>;
    oldest: Date | null;
    newest: Date | null;
    withEmbeddings: number;
    graphNodes?: number;
    graphEdges?: number;
  }> {
    return this.request('GET', '/memories/stats', undefined, { sessionId });
  }

  async consolidate(sessionId: string, options: ConsolidateOptions = {}): Promise<ConsolidationResult> {
    return this.request<ConsolidationResult>('POST', '/memories/consolidate', {
      sessionId,
      batch: options.batch,
      keep: options.keep,
      dryRun: options.dryRun,
    });
  }

  async graph(sessionId: string, entity: string): Promise<GraphResult> {
    const res = await this.request<{ results: MemoryEntry[] }>('GET', '/memories', undefined, {
      sessionId,
    });
    // graph isn't exposed as a REST route yet — stub returns empty until v0.2 server
    return { entity, relationships: [], relatedMemories: res.results.slice(0, 3) };
  }

  // ── User-scoped memory ───────────────────────────────────────────────────

  async rememberUser(
    userId: string,
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<UserMemoryEntry> {
    return this.request<UserMemoryEntry>('POST', '/user/memories', { content, role, metadata });
  }

  async recallUser(
    userId: string,
    query?: string,
    limit = 10,
    options: { tiers?: MemoryTier[]; role?: string } = {}
  ): Promise<UserMemoryEntry[]> {
    const res = await this.request<{ results: UserMemoryEntry[] }>('GET', '/user/memories', undefined, {
      query, limit, tiers: options.tiers?.join(','),
    });
    return res.results;
  }

  async forgetUser(userId: string, options?: { id?: string; before?: Date }): Promise<number> {
    const res = await this.request<{ deleted: number }>('DELETE', '/user/memories', undefined, {
      id: options?.id,
      before: options?.before?.toISOString(),
    });
    return res.deleted;
  }

  async consolidateUser(userId: string, options: ConsolidateOptions = {}): Promise<ConsolidationResult> {
    return this.request<ConsolidationResult>('POST', '/user/memories/consolidate', {
      batch: options.batch, keep: options.keep, dryRun: options.dryRun,
    });
  }

  async userStats(userId: string): Promise<{
    total: number; byRole: Record<string, number>;
    byTier: Record<MemoryTier, number>;
    oldest: Date | null; newest: Date | null; withEmbeddings: number;
  }> {
    return this.request('GET', '/user/memories/stats');
  }

  /** No-op — remote connections don't need explicit closing */
  async close(): Promise<void> {}
}
