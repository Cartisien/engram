/**
 * @cartisien/engram v0.9: Belief Revision Tests
 * - certainty field on all memories
 * - reinforce() — increases certainty, increments count
 * - contradict() — lowers old certainty, stores new memory
 * - detectContradictions() — heuristic conflict detection
 * - invalidate() — marks memory superseded (excluded from recall)
 * - timeline() — chronological belief events
 */
import { describe, it, expect } from 'vitest';
import { Engram } from '../src/index.js';

// ── certainty field ───────────────────────────────────────────────────────────

describe('certainty field', () => {
  it('remember() returns certainty 0.5 by default', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User prefers TypeScript', 'user');
    expect(entry.certainty).toBe(0.5);
    await m.close();
  });

  it('certainty persists through recall()', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User loves CLI tools', 'user');
    const results = await m.recall('s1', 'CLI');
    const found = results.find(r => r.id === entry.id);
    expect(found).toBeDefined();
    expect(found!.certainty).toBe(0.5);
    await m.close();
  });

  it('remember() populates all v0.9 fields', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'Some memory', 'user');
    expect(typeof entry.certainty).toBe('number');
    expect(typeof entry.reinforcementCount).toBe('number');
    expect(entry.lastVerified).toBeInstanceOf(Date);
    expect(entry.memoryType).toMatch(/^(episodic|semantic)$/);
    expect(entry.status).toBe('active');
    await m.close();
  });
});

// ── reinforce() ───────────────────────────────────────────────────────────────

describe('reinforce()', () => {
  it('increases certainty by default boost (0.15)', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User prefers dark mode', 'user');
    const result = await m.reinforce(entry.id);
    expect(result.certainty).toBeCloseTo(0.65, 2);
    expect(result.reinforcementCount).toBe(1);
    await m.close();
  });

  it('accepts custom boost amount', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User prefers Tailwind', 'user');
    const result = await m.reinforce(entry.id, 0.3);
    expect(result.certainty).toBeCloseTo(0.8, 2);
    await m.close();
  });

  it('clamps certainty at 1.0', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'Confirmed preference', 'user');
    await m.reinforce(entry.id, 0.9);
    const result = await m.reinforce(entry.id, 0.9);
    expect(result.certainty).toBeLessThanOrEqual(1.0);
    await m.close();
  });

  it('increments reinforcementCount per call', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User builds in TypeScript', 'user');
    await m.reinforce(entry.id);
    await m.reinforce(entry.id);
    const result = await m.reinforce(entry.id);
    expect(result.reinforcementCount).toBe(3);
    await m.close();
  });

  it('certainty update persists through recall()', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'TypeScript preference confirmed', 'user');
    await m.reinforce(entry.id, 0.2);
    const results = await m.recall('s1', 'TypeScript');
    const found = results.find(r => r.id === entry.id);
    expect(found).toBeDefined();
    expect(found!.certainty).toBeGreaterThan(0.5);
    await m.close();
  });
});

// ── contradict() ──────────────────────────────────────────────────────────────

describe('contradict()', () => {
  it('lowers certainty on the contradicted memory', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const old = await m.remember('s1', 'User prefers TypeScript', 'user');
    await m.contradict('s1', old.id, 'User switched to Python full-time');
    const results = await m.recall('s1', 'TypeScript Python');
    const oldEntry = results.find(r => r.id === old.id);
    // old entry should be excluded (status='contradicted') OR have lower certainty
    if (oldEntry) {
      expect(oldEntry.certainty).toBeLessThan(0.5);
    }
    await m.close();
  });

  it('stores the new contradicting memory', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const old = await m.remember('s1', 'User prefers TypeScript', 'user');
    const result = await m.contradict('s1', old.id, 'User now uses Python exclusively');
    expect(result.newId).toBeDefined();
    await m.close();
  });

  it('new memory links back to contradictedId', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const old = await m.remember('s1', 'User prefers TypeScript', 'user');
    const result = await m.contradict('s1', old.id, 'User uses Python now');
    expect(result.contradictedId).toBe(old.id);
    await m.close();
  });

  it('handles empty newContent gracefully', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const old = await m.remember('s1', 'User prefers TypeScript', 'user');
    const result = await m.contradict('s1', old.id, '');
    expect(result.contradictedId).toBe(old.id);
    expect(result.newId).toBeUndefined();
    await m.close();
  });
});

// ── detectContradictions() ────────────────────────────────────────────────────

describe('detectContradictions() heuristic', () => {
  it('returns no contradictions on empty session', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const result = await m.detectContradictions('s1', 'User prefers TypeScript');
    expect(result.detected).toBe(false);
    expect(result.conflicting).toHaveLength(0);
    await m.close();
  });

  it('detects polarity flip for preference statements', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');
    const result = await m.detectContradictions('s1', "User doesn't prefer TypeScript anymore");
    expect(result.detected).toBe(true);
    expect(result.conflicting.length).toBeGreaterThan(0);
    await m.close();
  });

  it('no false positive for unrelated content', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');
    const result = await m.detectContradictions('s1', 'The weather is nice today');
    expect(result.detected).toBe(false);
    await m.close();
  });

  it('conflicting entries include id, content, certainty, similarity', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript for all projects', 'user');
    const result = await m.detectContradictions('s1', "User doesn't prefer TypeScript anymore, switched to Python");
    if (result.detected) {
      const c = result.conflicting[0];
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('content');
      expect(c).toHaveProperty('certainty');
      expect(c).toHaveProperty('similarity');
    }
    await m.close();
  });
});

// ── invalidate() ──────────────────────────────────────────────────────────────

describe('invalidate()', () => {
  it('invalidated memory is excluded from recall()', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User uses TypeScript exclusively', 'user');
    await m.invalidate(entry.id);
    const results = await m.recall('s1', 'TypeScript');
    const found = results.find(r => r.id === entry.id);
    expect(found).toBeUndefined();
    await m.close();
  });

  it('other memories are unaffected', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const a = await m.remember('s1', 'User prefers TypeScript', 'user');
    const b = await m.remember('s1', 'User builds CLI tools', 'user');
    await m.invalidate(a.id);
    const results = await m.recall('s1', 'CLI');
    expect(results.find(r => r.id === b.id)).toBeDefined();
    await m.close();
  });
});

// ── timeline() ────────────────────────────────────────────────────────────────

describe('timeline()', () => {
  it('returns events for a session', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'User prefers TypeScript', 'user');
    const events = await m.timeline('s1');
    expect(events.length).toBeGreaterThan(0);
    await m.close();
  });

  it('each event has required fields', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'TypeScript fact', 'user');
    const events = await m.timeline('s1');
    for (const ev of events) {
      expect(ev.timestamp).toBeInstanceOf(Date);
      expect(ev.event).toMatch(/^(created|reinforced|contradicted|superseded|consolidated)$/);
      expect(typeof ev.memoryId).toBe('string');
      expect(typeof ev.content).toBe('string');
    }
    await m.close();
  });

  it('reinforced event appears after reinforce()', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const entry = await m.remember('s1', 'User prefers dark mode', 'user');
    await m.reinforce(entry.id);
    const events = await m.timeline('s1');
    const reinforced = events.filter(e => e.event === 'reinforced');
    expect(reinforced.length).toBeGreaterThan(0);
    await m.close();
  });

  it('events are sorted chronologically', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    await m.remember('s1', 'Memory A', 'user');
    await m.remember('s1', 'Memory B', 'user');
    const events = await m.timeline('s1');
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(events[i - 1].timestamp.getTime());
    }
    await m.close();
  });

  it('returns empty array for unknown session', async () => {
    const m = new Engram({ dbPath: ':memory:', semanticSearch: false });
    const events = await m.timeline('unknown-session');
    expect(events).toHaveLength(0);
    await m.close();
  });
});
