import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Engram } from '../src/index.js';
import { buildWakeBriefing, handleSleep } from '../src/integrations/cogito.js';

describe('Cogito integration helpers', () => {
  let memory: Engram;

  beforeEach(() => {
    memory = new Engram({ dbPath: ':memory:', semanticSearch: false });
  });

  afterEach(async () => {
    await memory.close();
  });

  // ── buildWakeBriefing ──────────────────────────────────────────────────

  it('returns empty string when no user memories', async () => {
    const briefing = await buildWakeBriefing(memory, 'user_jeff');
    expect(briefing).toBe('');
  });

  it('returns formatted briefing from user memories', async () => {
    await memory.rememberUser('user_jeff', 'Prefers TypeScript');
    await memory.rememberUser('user_jeff', 'Building GovScout');
    await memory.rememberUser('user_jeff', 'Goal: $10k/mo recurring');

    const briefing = await buildWakeBriefing(memory, 'user_jeff');

    expect(briefing).toContain('Briefing');
    expect(briefing).toContain('Prefers TypeScript');
    expect(briefing).toContain('Building GovScout');
    expect(briefing).toContain('Goal: $10k/mo recurring');
    expect(briefing.split('\n').length).toBeGreaterThan(1);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await memory.rememberUser('user_jeff', `Fact ${i}`);
    }
    const briefing = await buildWakeBriefing(memory, 'user_jeff', 3);
    const lines = briefing.split('\n').filter(l => l.startsWith('-'));
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('works with a different userId', async () => {
    await memory.rememberUser('user_a', 'User A fact');
    await memory.rememberUser('user_b', 'User B fact');

    const briefingA = await buildWakeBriefing(memory, 'user_a');
    const briefingB = await buildWakeBriefing(memory, 'user_b');

    expect(briefingA).toContain('User A fact');
    expect(briefingA).not.toContain('User B fact');
    expect(briefingB).toContain('User B fact');
    expect(briefingB).not.toContain('User A fact');
  });

  it('does not throw on invalid engram object', async () => {
    const result = await buildWakeBriefing({}, 'user_jeff');
    expect(result).toBe('');
  });

  // ── handleSleep ──────────────────────────────────────────────────────────

  it('calls consolidate for session when sessionId provided', async () => {
    const consolidateSpy = vi.spyOn(memory, 'consolidate').mockResolvedValue({
      summarized: 5, created: 1, archived: 5
    });

    await handleSleep(memory, 'session_123');
    expect(consolidateSpy).toHaveBeenCalledWith('session_123');
  });

  it('calls consolidateUser when userId provided', async () => {
    const consolidateUserSpy = vi.spyOn(memory, 'consolidateUser').mockResolvedValue({
      summarized: 3, created: 1, archived: 3
    });

    await handleSleep(memory, undefined, 'user_jeff');
    expect(consolidateUserSpy).toHaveBeenCalledWith('user_jeff');
  });

  it('calls both when both provided', async () => {
    const consolidateSpy = vi.spyOn(memory, 'consolidate').mockResolvedValue({
      summarized: 0, created: 0, archived: 0
    });
    const consolidateUserSpy = vi.spyOn(memory, 'consolidateUser').mockResolvedValue({
      summarized: 0, created: 0, archived: 0
    });

    await handleSleep(memory, 'session_abc', 'user_jeff');
    expect(consolidateSpy).toHaveBeenCalledWith('session_abc');
    expect(consolidateUserSpy).toHaveBeenCalledWith('user_jeff');
  });

  it('calls neither when nothing provided', async () => {
    const consolidateSpy = vi.spyOn(memory, 'consolidate');
    const consolidateUserSpy = vi.spyOn(memory, 'consolidateUser');

    await handleSleep(memory);
    expect(consolidateSpy).not.toHaveBeenCalled();
    expect(consolidateUserSpy).not.toHaveBeenCalled();
  });

  it('does not throw if consolidate rejects', async () => {
    vi.spyOn(memory, 'consolidate').mockRejectedValue(new Error('LLM offline'));
    await expect(handleSleep(memory, 'session_123')).resolves.toBeUndefined();
  });

  it('does not throw if consolidateUser rejects', async () => {
    vi.spyOn(memory, 'consolidateUser').mockRejectedValue(new Error('LLM offline'));
    await expect(handleSleep(memory, undefined, 'user_jeff')).resolves.toBeUndefined();
  });

  // ── integration: wake → work → sleep cycle ────────────────────────────────

  it('full wake/sleep cycle with real data', async () => {
    // Seed user memories (simulates prior sessions)
    await memory.rememberUser('user_jeff', 'Prefers TypeScript');
    await memory.rememberUser('user_jeff', 'Building GovScout');

    // Wake: build briefing
    const briefing = await buildWakeBriefing(memory, 'user_jeff');
    expect(briefing).toContain('Prefers TypeScript');
    expect(briefing).toContain('Building GovScout');

    // Work: add session memories
    await memory.remember('session_morning', 'Fixed the deployment bug', 'user');
    await memory.remember('session_morning', 'Opened PR #42', 'user');

    // Sleep: consolidate (no LLM available, so summarized=2, created=0)
    await handleSleep(memory, 'session_morning', 'user_jeff');
    // Just verify it doesn't throw — consolidation silently no-ops without LLM
  });
});
