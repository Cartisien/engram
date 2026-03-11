import { Engram } from '../src/index.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('v0.5 User-scoped cross-session memory', () => {
  let memory: Engram;

  beforeEach(() => {
    memory = new Engram({ dbPath: ':memory:', semanticSearch: false });
  });

  afterEach(async () => {
    await memory.close();
  });

  // ── rememberUser / recallUser ──────────────────────────────────────────

  it('stores and retrieves user-scoped memories', async () => {
    await memory.rememberUser('user_jeff', 'Prefers TypeScript over JavaScript');
    const results = await memory.recallUser('user_jeff');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Prefers TypeScript over JavaScript');
    expect(results[0].userId).toBe('user_jeff');
    expect(results[0].tier).toBe('working');
  });

  it('user memories are isolated by userId', async () => {
    await memory.rememberUser('user_a', 'A fact about user A');
    await memory.rememberUser('user_b', 'A fact about user B');

    const a = await memory.recallUser('user_a');
    const b = await memory.recallUser('user_b');

    expect(a).toHaveLength(1);
    expect(a[0].content).toContain('user A');
    expect(b).toHaveLength(1);
    expect(b[0].content).toContain('user B');
  });

  it('user memories are isolated from session memories', async () => {
    await memory.remember('session_1', 'Session-only content', 'user');
    await memory.rememberUser('user_jeff', 'User-scoped content');

    const sessionResults = await memory.recall('session_1');
    const userResults = await memory.recallUser('user_jeff');

    expect(sessionResults).toHaveLength(1);
    expect(sessionResults[0].content).toBe('Session-only content');
    expect(userResults).toHaveLength(1);
    expect(userResults[0].content).toBe('User-scoped content');
  });

  it('user memories persist across session changes', async () => {
    // Store once with session A
    await memory.rememberUser('user_jeff', 'Prefers concise answers');

    // Retrieve from any session context
    const fromSession1 = await memory.recallUser('user_jeff');
    const fromSession2 = await memory.recallUser('user_jeff');

    expect(fromSession1).toHaveLength(1);
    expect(fromSession2).toHaveLength(1);
    expect(fromSession1[0].id).toBe(fromSession2[0].id);
  });

  it('keyword recall works for user memories', async () => {
    await memory.rememberUser('user_jeff', 'Prefers TypeScript');
    await memory.rememberUser('user_jeff', 'Works on GovScout');

    const results = await memory.recallUser('user_jeff', 'TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
  });

  // ── recall() with userId blending ──────────────────────────────────────

  it('recall() blends user memories when userId provided', async () => {
    await memory.remember('session_1', 'Session fact: we discussed deployment', 'user');
    await memory.rememberUser('user_jeff', 'User fact: prefers TypeScript');

    const results = await memory.recall('session_1', undefined, 10, { userId: 'user_jeff' });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const contents = results.map(r => r.content);
    expect(contents).toContain('Session fact: we discussed deployment');
    expect(contents).toContain('User fact: prefers TypeScript');
  });

  it('recall() without userId excludes user memories', async () => {
    await memory.remember('session_1', 'Session content', 'user');
    await memory.rememberUser('user_jeff', 'User content');

    const results = await memory.recall('session_1');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Session content');
  });

  it('blended user memories are marked with _userMemory flag', async () => {
    await memory.remember('session_1', 'Session content', 'user');
    await memory.rememberUser('user_jeff', 'User content');

    const results = await memory.recall('session_1', undefined, 10, { userId: 'user_jeff' });
    const userEntry = results.find(r => r.content === 'User content');

    expect(userEntry).toBeDefined();
    expect(userEntry?.metadata?._userMemory).toBe(true);
    expect(userEntry?.metadata?.userId).toBe('user_jeff');
    expect(userEntry?.sessionId).toBe('user:user_jeff');
  });

  it('blended recall deduplicates by content', async () => {
    const sharedContent = 'Shared fact that exists in both scopes';
    await memory.remember('session_1', sharedContent, 'user');
    await memory.rememberUser('user_jeff', sharedContent);

    const results = await memory.recall('session_1', undefined, 10, { userId: 'user_jeff' });
    const matches = results.filter(r => r.content === sharedContent);
    expect(matches).toHaveLength(1); // deduped
  });

  // ── forgetUser ──────────────────────────────────────────────────────────

  it('forgetUser deletes all user memories', async () => {
    await memory.rememberUser('user_jeff', 'Fact 1');
    await memory.rememberUser('user_jeff', 'Fact 2');

    const deleted = await memory.forgetUser('user_jeff');
    expect(deleted).toBe(2);

    const results = await memory.recallUser('user_jeff');
    expect(results).toHaveLength(0);
  });

  it('forgetUser by id deletes one entry', async () => {
    const entry = await memory.rememberUser('user_jeff', 'To delete');
    await memory.rememberUser('user_jeff', 'To keep');

    const deleted = await memory.forgetUser('user_jeff', { id: entry.id });
    expect(deleted).toBe(1);

    const results = await memory.recallUser('user_jeff');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('To keep');
  });

  it('forgetUser does not affect other users', async () => {
    await memory.rememberUser('user_a', 'A fact');
    await memory.rememberUser('user_b', 'B fact');

    await memory.forgetUser('user_a');

    const bResults = await memory.recallUser('user_b');
    expect(bResults).toHaveLength(1);
  });

  // ── userStats ────────────────────────────────────────────────────────────

  it('userStats returns counts and tier breakdown', async () => {
    await memory.rememberUser('user_jeff', 'Fact 1', 'user');
    await memory.rememberUser('user_jeff', 'Fact 2', 'assistant');
    await memory.rememberUser('user_jeff', 'Fact 3', 'user');

    const stats = await memory.userStats('user_jeff');
    expect(stats.total).toBe(3);
    expect(stats.byRole['user']).toBe(2);
    expect(stats.byRole['assistant']).toBe(1);
    expect(stats.byTier.working).toBe(3);
    expect(stats.byTier.long_term).toBe(0);
    expect(stats.oldest).toBeDefined();
    expect(stats.newest).toBeDefined();
  });

  it('userStats empty for unknown user', async () => {
    const stats = await memory.userStats('unknown');
    expect(stats.total).toBe(0);
    expect(stats.byTier.working).toBe(0);
  });

  // ── consolidateUser ──────────────────────────────────────────────────────

  it('consolidateUser empty returns zeros', async () => {
    const result = await memory.consolidateUser('unknown');
    expect(result.summarized).toBe(0);
    expect(result.created).toBe(0);
  });

  it('consolidateUser with fewer than keep returns zeros', async () => {
    await memory.rememberUser('user_jeff', 'Only fact');
    const result = await memory.consolidateUser('user_jeff', { keep: 5 });
    expect(result.summarized).toBe(0);
  });
});
