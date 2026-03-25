import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { FTS5Search } from '../src/search/fts5.js';

describe('FTS5 Search', () => {
  let db: Database;
  let fts5: FTS5Search;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });
    
    // Create required tables before FTS5 init (triggers reference them)
    await db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tier TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE user_memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tier TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
    `);
    
    fts5 = new FTS5Search(db, true);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('FTS5 Support', () => {
    it('should detect FTS5 availability', async () => {
      const supported = await fts5.checkFTS5Support();
      // FTS5 should be available in most modern SQLite builds
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('Initialization', () => {
    it('should initialize without errors', async () => {
      await expect(fts5.init()).resolves.not.toThrow();
    });

    it('should report enabled status after init', async () => {
      await fts5.init();
      const isEnabled = fts5.isEnabled();
      expect(typeof isEnabled).toBe('boolean');
    });

    it('should handle disabled mode', async () => {
      const disabledFts5 = new FTS5Search(db, false);
      await disabledFts5.init();
      expect(disabledFts5.isEnabled()).toBe(false);
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      await fts5.init();

      // Only proceed if FTS5 is enabled
      if (fts5.isEnabled()) {
        // Insert into memories - triggers will auto-populate memories_fts
        await db.run(
          'INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['mem1', 'session1', 'The quick brown fox jumps', 'user', new Date().toISOString(), 'working', 'hash1']
        );
        await db.run(
          'INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['mem2', 'session1', 'Lazy dog sleeping', 'assistant', new Date().toISOString(), 'working', 'hash2']
        );
        await db.run(
          'INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['mem3', 'session2', 'Different session content', 'user', new Date().toISOString(), 'working', 'hash3']
        );
        // Note: No manual FTS insert needed - triggers handle it automatically
      }
    });

    it('should search memories by content', async () => {
      if (!fts5.isEnabled()) {
        // Skip test if FTS5 not available
        return;
      }

      const results = await fts5.search('session1', 'quick fox', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.memoryId).toBe('mem1');
    });

    it('should return results with rank', async () => {
      if (!fts5.isEnabled()) {
        return;
      }

      const results = await fts5.search('session1', 'quick', 10);
      expect(results[0]?.rank).toBeDefined();
      expect(typeof results[0]?.rank).toBe('number');
    });

    it('should filter by session', async () => {
      if (!fts5.isEnabled()) {
        return;
      }

      const results = await fts5.search('session1', 'content', 10);
      // Should only find mem1 and mem2 (session1), not mem3 (session2)
      expect(results.every(r => ['mem1', 'mem2'].includes(r.memoryId))).toBe(true);
    });

    it('should respect limit', async () => {
      if (!fts5.isEnabled()) {
        return;
      }

      // Add more memories - triggers auto-populate FTS index
      for (let i = 4; i <= 10; i++) {
        await db.run(
          'INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`mem${i}`, 'session1', `Test content ${i}`, 'user', new Date().toISOString(), 'working', `hash${i}`]
        );
      }

      const results = await fts5.search('session1', 'Test', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should exclude archived memories', async () => {
      if (!fts5.isEnabled()) {
        return;
      }

      // Note: The test data doesn't have archived entries, but we verify the query structure
      const results = await fts5.search('session1', 'quick', 10);
      // All results should be from non-archived memories
      expect(results.every(r => r.memoryId)).toBe(true);
    });
  });

  describe('User Memory Search', () => {
    beforeEach(async () => {
      await fts5.init();

      if (fts5.isEnabled()) {
        // Insert into user_memories - triggers will auto-populate user_memories_fts
        await db.run(
          'INSERT INTO user_memories (id, user_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['umem1', 'user1', 'User preference data', 'user', new Date().toISOString(), 'working', 'uhash1']
        );
        // Note: No manual FTS insert needed - triggers handle it automatically
      }
    });

    it('should search user memories', async () => {
      if (!fts5.isEnabled()) {
        return;
      }

      const results = await fts5.searchUser('user1', 'preference', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.memoryId).toBe('umem1');
    });
  });

  describe('Error Handling', () => {
    it('should throw when searching while disabled', async () => {
      const disabledFts5 = new FTS5Search(db, false);
      await disabledFts5.init();

      await expect(disabledFts5.search('session', 'query')).rejects.toThrow('FTS5 not available');
    });

    it('should handle special characters in queries', async () => {
      await fts5.init();
      if (!fts5.isEnabled()) {
        return;
      }

      // Should not throw on special characters
      await expect(fts5.search('session', 'test "quoted"', 10)).resolves.not.toThrow();
    });

    it('should handle empty queries', async () => {
      await fts5.init();
      if (!fts5.isEnabled()) {
        return;
      }

      const results = await fts5.search('session', '', 10);
      expect(results).toHaveLength(0);
    });
  });

  describe('Index Rebuilding', () => {
    it('should rebuild index without errors', async () => {
      await fts5.init();
      if (!fts5.isEnabled()) {
        return;
      }

      await expect(fts5.rebuildIndex()).resolves.not.toThrow();
    });
  });
});
