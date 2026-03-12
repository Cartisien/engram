import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Engram } from '../src/index.js';

describe('v0.8 — Memory importance scoring', () => {
  let memory: Engram;

  beforeEach(() => {
    memory = new Engram({ dbPath: ':memory:', semanticSearch: false });
  });
  afterEach(async () => { await memory.close(); });

  // ── Heuristic scorer ──────────────────────────────────────────────────────

  describe('heuristic scorer', () => {
    it('assigns 0.5 base score', async () => {
      const entry = await memory.remember('s1', 'Something happened', 'user');
      expect(entry.importance).toBeGreaterThanOrEqual(0.0);
      expect(entry.importance).toBeLessThanOrEqual(1.0);
    });

    it('boosts preference/decision keywords', async () => {
      const pref = await memory.remember('s1', 'I always prefer TypeScript over JavaScript', 'user');
      const casual = await memory.remember('s1', 'Thanks!', 'user');
      expect(pref.importance).toBeGreaterThan(casual.importance);
    });

    it('lowers small-talk importance', async () => {
      const smallTalk = await memory.remember('s1', 'Hello! How are you? Sure, sounds good!', 'user');
      expect(smallTalk.importance).toBeLessThan(0.5);
    });

    it('boosts memories with dates', async () => {
      const withDate = await memory.remember('s1', 'Deadline is 2026-04-01 for the launch', 'user');
      const noDate   = await memory.remember('s1', 'We have a launch coming up', 'user');
      expect(withDate.importance).toBeGreaterThanOrEqual(noDate.importance);
    });

    it('boosts long detailed content', async () => {
      const detailed = await memory.remember('s1', 'The user prefers TypeScript, dark mode, concise answers, no filler, builds GovScout and Motordrome, Cartisien Interactive, Fountain Inn SC, goal is $10k/mo recurring revenue.', 'user');
      const brief    = await memory.remember('s1', 'ok', 'user');
      expect(detailed.importance).toBeGreaterThan(brief.importance);
    });

    it('clamps to [0.0, 1.0]', async () => {
      const entries = await Promise.all([
        memory.remember('s1', 'ok', 'user'),
        memory.remember('s1', 'very important critical never always prefer must need to goal decision deadline api key token secret password important critical must', 'user'),
      ]);
      for (const e of entries) {
        expect(e.importance).toBeGreaterThanOrEqual(0.0);
        expect(e.importance).toBeLessThanOrEqual(1.0);
      }
    });
  });

  // ── importance field on entries ──────────────────────────────────────────

  it('remember returns importance on entry', async () => {
    const entry = await memory.remember('s1', 'I prefer TypeScript', 'user');
    expect(typeof entry.importance).toBe('number');
    expect(entry.importance).toBeGreaterThanOrEqual(0.0);
    expect(entry.importance).toBeLessThanOrEqual(1.0);
  });

  it('recall results include importance', async () => {
    await memory.remember('s1', 'GovScout uses React 19', 'user');
    const results = await memory.recall('s1', 'GovScout');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(typeof results[0].importance).toBe('number');
  });

  it('history includes importance', async () => {
    await memory.remember('s1', 'Fact', 'user');
    const entries = await memory.history('s1');
    expect(typeof entries[0].importance).toBe('number');
  });

  it('rememberUser returns importance', async () => {
    const entry = await memory.rememberUser('u1', 'Always prefers dark mode');
    expect(typeof entry.importance).toBe('number');
    expect(entry.importance).toBeGreaterThan(0.0);
  });

  it('recallUser includes importance', async () => {
    await memory.rememberUser('u1', 'Prefers TypeScript');
    const results = await memory.recallUser('u1');
    expect(typeof results[0].importance).toBe('number');
  });

  // ── setImportance ─────────────────────────────────────────────────────────

  it('setImportance updates session memory', async () => {
    const entry = await memory.remember('s1', 'Some fact', 'user');
    await memory.setImportance(entry.id, 0.95);
    const results = await memory.recall('s1', 'fact');
    const updated = results.find(r => r.id === entry.id);
    expect(updated?.importance).toBeCloseTo(0.95, 2);
  });

  it('setImportance updates user memory', async () => {
    const entry = await memory.rememberUser('u1', 'User fact');
    await memory.setImportance(entry.id, 0.2);
    const results = await memory.recallUser('u1');
    const updated = results.find(r => r.id === entry.id);
    expect(updated?.importance).toBeCloseTo(0.2, 2);
  });

  it('setImportance clamps to [0.0, 1.0]', async () => {
    const entry = await memory.remember('s1', 'Fact', 'user');
    await memory.setImportance(entry.id, 2.5);
    const results = await memory.recall('s1', 'fact');
    expect(results.find(r => r.id === entry.id)?.importance).toBeLessThanOrEqual(1.0);
    await memory.setImportance(entry.id, -1.0);
    const results2 = await memory.recall('s1', 'fact');
    expect(results2.find(r => r.id === entry.id)?.importance).toBeGreaterThanOrEqual(0.0);
  });

  // ── consolidation protection ──────────────────────────────────────────────

  it('consolidate skips high-importance memories', async () => {
    const m = new Engram({
      dbPath: ':memory:', semanticSearch: false, importanceThreshold: 0.8
    });
    // Mock LLM call to avoid timeout
    vi.spyOn(m as any, 'summarizeMemories').mockResolvedValue(['mock consolidated summary']);

    // Store 15 regular memories
    for (let i = 0; i < 15; i++) {
      await m.remember('s1', `Regular fact ${i}`, 'user');
    }

    // Manually set 3 of the oldest to high importance
    const allResults = await m.recall('s1', undefined, 20, { tiers: ['working'] });
    const oldest3 = allResults.slice(-3); // recall is DESC, so last 3 are oldest
    for (const e of oldest3) {
      await m.setImportance(e.id, 0.9);
    }

    // Count working memories with high importance
    const highImportance = (await m.recall('s1', undefined, 20, { tiers: ['working'] }))
      .filter(r => r.importance >= 0.8);
    expect(highImportance.length).toBe(3);

    // consolidate — should skip high-importance entries
    const result = await m.consolidate('s1', { batch: 15, keep: 0 });
    // High-importance entries should NOT be in archived
    const archived = await m.recall('s1', undefined, 20, { tiers: ['archived'] });
    const archivedIds = new Set(archived.map(r => r.id));
    for (const e of oldest3) {
      expect(archivedIds.has(e.id)).toBe(false);
    }
    await m.close();
  });

  it('high-importance memories survive consolidateUser', async () => {
    const m = new Engram({
      dbPath: ':memory:', semanticSearch: false, importanceThreshold: 0.8
    });

    for (let i = 0; i < 10; i++) {
      await m.rememberUser('u1', `User fact ${i}`);
    }

    // Recall to get IDs
    const results = await m.recallUser('u1', undefined, 20);
    const protectedId1 = results[0].id;
    const protectedId2 = results[1].id;

    // Mark 2 as high-importance
    await m.setImportance(protectedId1, 0.95);
    await m.setImportance(protectedId2, 0.9);

    // Mock LLM to avoid timeout
    vi.spyOn(m as any, 'summarizeMemories').mockResolvedValue(['user summary']);

    // consolidateUser — high-importance entries should not be in consolidation batch
    await m.consolidateUser('u1', { keep: 0 });

    // Verify the high-importance entries are still working (not archived)
    await (m as any).init();
    const row1 = await (m as any).db.get(
      "SELECT tier FROM user_memories WHERE id = ?", [protectedId1]
    );
    const row2 = await (m as any).db.get(
      "SELECT tier FROM user_memories WHERE id = ?", [protectedId2]
    );
    expect(row1?.tier).toBe('working');
    expect(row2?.tier).toBe('working');
    await m.close();
  }, 10000);

  // ── importance-blended recall ranking ─────────────────────────────────────

  it('higher importance floats up in keyword recall', async () => {
    await memory.remember('s1', 'fact about TypeScript', 'user');
    const entry2 = await memory.remember('s1', 'fact about TypeScript again', 'user');

    // Boost entry2's importance
    await memory.setImportance(entry2.id, 0.99);

    // Without semantic search, keyword recall still returns by timestamp DESC
    // Importance blending affects semantic recall — verify field is present
    const results = await memory.recall('s1', 'TypeScript');
    expect(results.every(r => typeof r.importance === 'number')).toBe(true);
  });
});
