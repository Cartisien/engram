/**
 * EngramClient tests — runs against an in-process engram-server.
 * No external services needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EngramClient } from '../src/index.js';
import { createApp } from '../../engram-server/src/app.js';
import { issueJwt, generateApiKey } from '../../engram-server/src/auth.js';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const DATA_DIR = path.join(os.tmpdir(), `engram-client-test-${Date.now()}`);
const { app, store } = createApp({ dataDir: DATA_DIR });

let server: http.Server;
let BASE_URL: string;
const USER = 'client_test_user';
let client: EngramClient;

beforeAll(async () => {
  server = await new Promise<http.Server>(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  BASE_URL = `http://localhost:${port}`;
  const apiKey = generateApiKey(USER);
  client = new EngramClient({ remoteUrl: BASE_URL, apiKey });
});

afterAll(async () => {
  await store.closeAll();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

// ── remember / recall ────────────────────────────────────────────────────────

describe('EngramClient — session memory', () => {
  it('remember returns entry with id and tier', async () => {
    const entry = await client.remember('sess1', 'TypeScript is great', 'user');
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('TypeScript is great');
    expect(entry.tier).toBe('working');
  });

  it('recall returns stored memories', async () => {
    await client.remember('sess2', 'GovScout uses React 19', 'user');
    const results = await client.recall('sess2', 'GovScout');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('GovScout');
  });

  it('recall empty session returns []', async () => {
    const results = await client.recall('empty_session_xyz', 'anything');
    expect(results).toEqual([]);
  });

  it('history returns chronological entries', async () => {
    const sess = `hist_${Date.now()}`;
    await client.remember(sess, 'First entry', 'user');
    await new Promise(r => setTimeout(r, 5));
    await client.remember(sess, 'Second entry', 'assistant');
    const entries = await client.history(sess);
    expect(entries[0].content).toBe('First entry');
    expect(entries[1].content).toBe('Second entry');
  });

  it('forget deletes memories and returns count', async () => {
    const sess = `forget_${Date.now()}`;
    await client.remember(sess, 'To delete', 'user');
    const deleted = await client.forget(sess);
    expect(deleted).toBe(1);
    const results = await client.recall(sess, 'delete');
    expect(results).toEqual([]);
  });

  it('stats returns total and byTier', async () => {
    const sess = `stats_${Date.now()}`;
    await client.remember(sess, 'Fact', 'user');
    const stats = await client.stats(sess);
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.byTier).toBeDefined();
    expect(stats.byTier.working).toBeGreaterThanOrEqual(1);
  });

  it('consolidate dry run returns counts', async () => {
    const result = await client.consolidate('some_sess', { dryRun: true });
    expect(typeof result.summarized).toBe('number');
    expect(result.created).toBe(0);
  });
});

// ── user memory ───────────────────────────────────────────────────────────────

describe('EngramClient — user memory', () => {
  it('rememberUser stores and returns entry', async () => {
    const entry = await client.rememberUser(USER, 'Prefers TypeScript');
    expect(entry.content).toBe('Prefers TypeScript');
  });

  it('recallUser retrieves stored entry', async () => {
    await client.rememberUser(USER, 'Loves dark mode');
    const results = await client.recallUser(USER);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('forgetUser deletes entries', async () => {
    const u2 = 'client_user_b';
    const key2 = generateApiKey(u2);
    const c2 = new EngramClient({ remoteUrl: BASE_URL, apiKey: key2 });
    await c2.rememberUser(u2, 'Temp fact');
    const deleted = await c2.forgetUser(u2);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });

  it('userStats returns counts', async () => {
    const stats = await client.userStats(USER);
    expect(typeof stats.total).toBe('number');
    expect(stats.byTier).toBeDefined();
  });
});

// ── auth errors ───────────────────────────────────────────────────────────────

describe('EngramClient — auth', () => {
  it('throws on bad API key', async () => {
    const bad = new EngramClient({ remoteUrl: BASE_URL, apiKey: 'eng_badkey' });
    await expect(bad.recall('s', 'q')).rejects.toThrow();
  });

  it('accepts JWT token', async () => {
    const token = issueJwt(USER, 'jwt_session');
    const jwtClient = new EngramClient({ remoteUrl: BASE_URL, jwtToken: token });
    const results = await jwtClient.recall('jwt_session', 'test');
    expect(Array.isArray(results)).toBe(true);
  });

  it('throws without auth', () => {
    expect(() => new EngramClient({ remoteUrl: BASE_URL })).toThrow();
  });
});
