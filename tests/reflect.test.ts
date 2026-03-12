/**
 * @cartisien/engram v1.0: reflect() + multi-strategy retrieval tests
 */
import { describe, it, expect, vi } from 'vitest';
import { Engram } from '../src/index.js';

// ── reflect() ─────────────────────────────────────────────────────────────────

describe('reflect()', () => {
  it('returns ReflectResult shape', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');

    // Mock LLM to avoid timeout
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '["User strongly prefers TypeScript for all projects"]' }),
    } as Response);

    const result = await m.reflect('s1', 'What does the user prefer?');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('insights');
    expect(result).toHaveProperty('memoriesUsed');
    expect(result).toHaveProperty('certaintyWeighted');
    expect(result.certaintyWeighted).toBe(true);
    await m.close();
  });

  it('returns insights array', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');
    await m.remember('s1', 'User builds CLI tools', 'user');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '["TypeScript is the primary language", "CLI tooling is important to this user"]' }),
    } as Response);

    const result = await m.reflect('s1', 'preferences');
    expect(Array.isArray(result.insights)).toBe(true);
    expect(result.insights.length).toBeGreaterThan(0);
    await m.close();
  });

  it('includes memoriesUsed', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '["TypeScript preference noted"]' }),
    } as Response);

    const result = await m.reflect('s1', 'preferences');
    expect(Array.isArray(result.memoriesUsed)).toBe(true);
    await m.close();
  });

  it('returns empty insights on empty session', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const result = await m.reflect('empty-session', 'anything');
    expect(result.insights).toHaveLength(0);
    expect(result.memoriesUsed).toHaveLength(0);
    await m.close();
  });

  it('falls back to memory content when LLM fails', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');

    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));

    const result = await m.reflect('s1', 'preferences');
    // Fallback: returns raw memory content as insights
    expect(result.insights.length).toBeGreaterThan(0);
    await m.close();
  });

  it('prioritizes high-certainty memories', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const low = await m.remember('s1', 'User might like Python', 'user');
    const high = await m.remember('s1', 'User definitely prefers TypeScript', 'user');
    await m.reinforce(high.id, 0.4); // boost certainty

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '["TypeScript is the primary preference"]' }),
    } as Response);

    const result = await m.reflect('s1', 'language preference');
    // High-certainty memory should appear first in memoriesUsed
    if (result.memoriesUsed.length > 1) {
      expect(result.memoriesUsed[0].certainty).toBeGreaterThanOrEqual(
        result.memoriesUsed[result.memoriesUsed.length - 1].certainty
      );
    }
    await m.close();
  });

  it('query is preserved in result', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User likes dark mode', 'user');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '["Dark mode preference confirmed"]' }),
    } as Response);

    const result = await m.reflect('s1', 'UI preferences');
    expect(result.query).toBe('UI preferences');
    await m.close();
  });
});

// ── BM25 keyword scoring ──────────────────────────────────────────────────────

describe('bm25Score()', () => {
  it('returns 0 for unrelated content', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const score = (m as any).bm25Score('typescript', 'the weather is nice today');
    expect(score).toBe(0);
  });

  it('returns > 0 for matching content', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const score = (m as any).bm25Score('typescript', 'user prefers typescript for all projects');
    expect(score).toBeGreaterThan(0);
  });

  it('higher score for more keyword density', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const high = (m as any).bm25Score('typescript', 'user uses typescript');
    const low = (m as any).bm25Score('typescript', 'the user occasionally mentions a language called typescript but mostly uses other things');
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('clamps at 1.0', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const score = (m as any).bm25Score('typescript', 'typescript typescript typescript typescript typescript');
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

// ── RRF merge ─────────────────────────────────────────────────────────────────

describe('rrfMerge()', () => {
  const makeList = (ids: string[]): Array<{ id: string; entry: any }> =>
    ids.map(id => ({ id, entry: { id, content: `Memory ${id}` } }));

  it('merges two lists', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const list1 = makeList(['a', 'b', 'c']);
    const list2 = makeList(['b', 'a', 'd']);
    const merged = (m as any).rrfMerge([list1, list2]);
    expect(merged.length).toBeGreaterThan(0);
    // 'a' and 'b' appear in both lists — should rank higher than 'c' and 'd'
    const ids = merged.map((e: any) => e.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('d'));
  });

  it('returns unique entries', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const list1 = makeList(['a', 'b']);
    const list2 = makeList(['a', 'c']);
    const merged = (m as any).rrfMerge([list1, list2]);
    const ids = merged.map((e: any) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('single list returns same order', () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const list = makeList(['x', 'y', 'z']);
    const merged = (m as any).rrfMerge([list]);
    expect(merged.map((e: any) => e.id)).toEqual(['x', 'y', 'z']);
  });
});

// ── multi-strategy recall ─────────────────────────────────────────────────────

describe('recall() multi-strategy (no semantic)', () => {
  it('finds memories via keyword match', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript over JavaScript', 'user');
    await m.remember('s1', 'User likes cooking pasta', 'user');
    const results = await m.recall('s1', 'TypeScript');
    expect(results.some(r => r.content.includes('TypeScript'))).toBe(true);
  });

  it('returns results sorted by relevance', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User loves TypeScript and uses it every day for TypeScript projects', 'user');
    await m.remember('s1', 'User occasionally uses TypeScript', 'user');
    await m.remember('s1', 'User likes cooking', 'user');
    const results = await m.recall('s1', 'TypeScript');
    expect(results[0].content.includes('TypeScript')).toBe(true);
  });
});
