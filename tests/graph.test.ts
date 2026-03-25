import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { findPath, findNearbyEntities } from '../src/graph/traversal.js';

describe('Graph Traversal', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    // Create graph_edges table
    await db.exec(`
      CREATE TABLE graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        from_entity TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        memory_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('findPath', () => {
    it('should find direct path between connected entities', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity, confidence) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob', 1.0]
      );

      const result = await findPath(db, sessionId, 'alice', 'bob', 3);

      expect(result.found).toBe(true);
      expect(result.hops).toBe(1);
      expect(result.path).toHaveLength(1);
      expect(result.path?.[0]?.from).toBe('alice');
      expect(result.path?.[0]?.to).toBe('bob');
      expect(result.path?.[0]?.relation).toBe('knows');
    });

    it('should find indirect path with multiple hops', async () => {
      const sessionId = 'test-session';
      // alice -> bob -> charlie
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'charlie']
      );

      const result = await findPath(db, sessionId, 'alice', 'charlie', 3);

      expect(result.found).toBe(true);
      expect(result.hops).toBe(2);
      expect(result.path).toHaveLength(2);
    });

    it('should handle reverse direction edges', async () => {
      const sessionId = 'test-session';
      // bob is known by alice (reverse traversal needed)
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'alice']
      );

      const result = await findPath(db, sessionId, 'alice', 'bob', 3);

      expect(result.found).toBe(true);
      expect(result.hops).toBe(1);
      // Note: The actual relation stored is 'knows', path shows the traversal direction
      expect(result.path?.[0]?.relation).toBeDefined();
    });

    it('should return not found for disconnected entities', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'charlie', 'knows', 'dave']
      );

      const result = await findPath(db, sessionId, 'alice', 'dave', 3);

      expect(result.found).toBe(false);
      expect(result.path).toBeUndefined();
    });

    it('should respect max depth', async () => {
      const sessionId = 'test-session';
      // alice -> bob -> charlie -> dave (3 hops)
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'charlie']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'charlie', 'knows', 'dave']
      );

      const result = await findPath(db, sessionId, 'alice', 'dave', 2);

      expect(result.found).toBe(false); // Path exists but exceeds max depth
    });

    it('should handle case insensitivity', async () => {
      const sessionId = 'test-session';
      // Entities are normalized to lowercase in findPath
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );

      const result = await findPath(db, sessionId, 'ALICE', 'BOB', 3);

      expect(result.found).toBe(true);
    });

    it('should calculate average confidence', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity, confidence) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob', 0.8]
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity, confidence) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'charlie', 0.6]
      );

      const result = await findPath(db, sessionId, 'alice', 'charlie', 3);

      expect(result.found).toBe(true);
      expect(result.confidence).toBeCloseTo(0.7, 1);
    });

    it('should include related memories', async () => {
      const sessionId = 'test-session';
      // Create memories table for this test
      await db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          content TEXT NOT NULL,
          role TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          tier TEXT NOT NULL,
          content_hash TEXT NOT NULL
        )
      `);

      const memoryId = 'mem-1';
      await db.run(
        'INSERT INTO memories (id, session_id, content, role, timestamp, tier, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [memoryId, sessionId, 'Alice knows Bob', 'user', new Date().toISOString(), 'working', 'hash1']
      );

      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity, memory_id) VALUES (?, ?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob', memoryId]
      );

      const result = await findPath(db, sessionId, 'alice', 'bob', 3);

      expect(result.found).toBe(true);
      expect(result.relatedMemories).toHaveLength(1);
      expect(result.relatedMemories[0]?.id).toBe(memoryId);
    });
  });

  describe('findNearbyEntities', () => {
    it('should find entities within 1 hop', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'works_with', 'charlie']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 1);

      expect(nearby).toHaveLength(2);
      expect(nearby.map(n => n.entity)).toContain('bob');
      expect(nearby.map(n => n.entity)).toContain('charlie');
    });

    it('should find entities within 2 hops', async () => {
      const sessionId = 'test-session';
      // alice -> bob -> charlie
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'charlie']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 2);

      expect(nearby).toHaveLength(2);
      expect(nearby.some(n => n.entity === 'bob' && n.depth === 1)).toBe(true);
      expect(nearby.some(n => n.entity === 'charlie' && n.depth === 2)).toBe(true);
    });

    it('should include relation information', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 1);

      expect(nearby[0]?.relations).toContain('knows');
    });

    it('should not include starting entity', async () => {
      const sessionId = 'test-session';
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 1);

      expect(nearby.some(n => n.entity === 'alice')).toBe(false);
    });

    it('should handle bidirectional traversal', async () => {
      const sessionId = 'test-session';
      // alice is known by bob (incoming edge)
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'alice']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 1);

      expect(nearby).toHaveLength(1);
      expect(nearby[0]?.entity).toBe('bob');
      expect(nearby[0]?.relations[0]).toBe('~knows'); // Reverse relation
    });

    it('should return empty array for isolated entity', async () => {
      const sessionId = 'test-session';
      const nearby = await findNearbyEntities(db, sessionId, 'lonely', 2);
      expect(nearby).toHaveLength(0);
    });

    it('should avoid cycles', async () => {
      const sessionId = 'test-session';
      // alice -> bob -> alice (cycle)
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'alice', 'knows', 'bob']
      );
      await db.run(
        'INSERT INTO graph_edges (session_id, from_entity, relation, to_entity) VALUES (?, ?, ?, ?)',
        [sessionId, 'bob', 'knows', 'alice']
      );

      const nearby = await findNearbyEntities(db, sessionId, 'alice', 2);

      // Should only find bob once
      const bobEntries = nearby.filter(n => n.entity === 'bob');
      expect(bobEntries).toHaveLength(1);
    });
  });
});
