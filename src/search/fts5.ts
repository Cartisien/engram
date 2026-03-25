// @ts-nocheck
/**
 * FTS5 Full-Text Search Module
 * 
 * v0.7 feature: Provides fast, ranked keyword search using SQLite FTS5
 * Falls back to LIKE-based search if FTS5 is unavailable
 */

import type { Database } from 'sqlite';

export interface FTS5Result {
  memoryId: string;
  rank: number;
  snippet?: string;
}

export class FTS5Search {
  private db: Database;
  private enabled: boolean;
  private initialized = false;

  constructor(db: Database, enabled: boolean = true) {
    this.db = db;
    this.enabled = enabled;
  }

  /**
   * Check if SQLite supports FTS5
   */
  async checkFTS5Support(): Promise<boolean> {
    try {
      const result = await this.db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='fts5_test'`);
      if (result) {
        await this.db.exec(`DROP TABLE IF EXISTS fts5_test`);
      }
      await this.db.exec(`CREATE VIRTUAL TABLE fts5_test USING fts5(content)`);
      await this.db.exec(`DROP TABLE fts5_test`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize FTS5 tables and triggers
   */
  async init(): Promise<void> {
    if (this.initialized || !this.enabled) return;

    // Check FTS5 support
    this.enabled = await this.checkFTS5Support();
    if (!this.enabled) {
      console.warn('[Engram] FTS5 not available, falling back to LIKE search');
      return;
    }

    // Create FTS5 virtual table for memories
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content_rowid,
        tokenize='porter unicode61'
      )
    `);

    // Create FTS5 table for user memories
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS user_memories_fts USING fts5(
        content,
        content_rowid,
        tokenize='porter unicode61'
      )
    `);

    // Triggers to keep FTS index in sync with memories table
    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END
    `);

    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    // Triggers for user_memories
    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS user_memories_fts_insert AFTER INSERT ON user_memories BEGIN
        INSERT INTO user_memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS user_memories_fts_delete AFTER DELETE ON user_memories BEGIN
        INSERT INTO user_memories_fts(user_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END
    `);

    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS user_memories_fts_update AFTER UPDATE ON user_memories BEGIN
        INSERT INTO user_memories_fts(user_memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO user_memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    // Populate FTS index if empty (backfill for existing data)
    const count = await this.db.get(`SELECT COUNT(*) as count FROM memories_fts`);
    if (count?.count === 0) {
      await this.db.exec(`
        INSERT INTO memories_fts(rowid, content)
        SELECT rowid, content FROM memories WHERE tier != 'archived'
      `);
    }

    const userCount = await this.db.get(`SELECT COUNT(*) as count FROM user_memories_fts`);
    if (userCount?.count === 0) {
      await this.db.exec(`
        INSERT INTO user_memories_fts(rowid, content)
        SELECT rowid, content FROM user_memories WHERE tier != 'archived'
      `);
    }

    this.initialized = true;
  }

  /**
   * Search memories using FTS5 BM25 ranking
   */
  async search(
    sessionId: string,
    query: string,
    limit: number = 10
  ): Promise<FTS5Result[]> {
    if (!this.enabled) {
      throw new Error('FTS5 not available');
    }

    // Sanitize for FTS5: strip all special syntax characters, then wrap tokens in quotes
    const escapedQuery = query
      .replace(/['"?/*+\-(){}[\]:^~!@#$%&\\|<>=,.;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => `"${w}"`)
      .join(' ');

    if (!escapedQuery) return [];

    const results = await this.db.all(`
      SELECT 
        m.id as memoryId,
        rank,
        snippet(memories_fts, 0, '<mark>', '</mark>', '...', 32) as snippet
      FROM memories_fts
      JOIN memories m ON memories_fts.rowid = m.rowid
      WHERE memories_fts MATCH ? AND m.session_id = ? AND m.tier != 'archived'
      ORDER BY rank
      LIMIT ?
    `, [escapedQuery, sessionId, limit]);

    return results.map((r: any) => ({
      memoryId: r.memoryId,
      rank: r.rank,
      snippet: r.snippet,
    }));
  }

  /**
   * Search user memories using FTS5
   */
  async searchUser(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<FTS5Result[]> {
    if (!this.enabled) {
      throw new Error('FTS5 not available');
    }

    const escapedQuery = query
      .replace(/['"?/*+\-(){}[\]:^~!@#$%&\\|<>=,.;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => `"${w}"`)
      .join(' ');

    if (!escapedQuery) return [];

    const results = await this.db.all(`
      SELECT 
        m.id as memoryId,
        rank,
        snippet(user_memories_fts, 0, '<mark>', '</mark>', '...', 32) as snippet
      FROM user_memories_fts
      JOIN user_memories m ON user_memories_fts.rowid = m.rowid
      WHERE user_memories_fts MATCH ? AND m.user_id = ? AND m.tier != 'archived'
      ORDER BY rank
      LIMIT ?
    `, [escapedQuery, userId, limit]);

    return results.map((r: any) => ({
      memoryId: r.memoryId,
      rank: r.rank,
      snippet: r.snippet,
    }));
  }

  /**
   * Check if FTS5 is enabled and available
   */
  isEnabled(): boolean {
    return this.enabled && this.initialized;
  }

  /**
   * Rebuild FTS5 index (useful for maintenance)
   */
  async rebuildIndex(): Promise<void> {
    if (!this.enabled) return;
    
    await this.db.exec(`DELETE FROM memories_fts`);
    await this.db.exec(`
      INSERT INTO memories_fts(rowid, content)
      SELECT rowid, content FROM memories WHERE tier != 'archived'
    `);

    await this.db.exec(`DELETE FROM user_memories_fts`);
    await this.db.exec(`
      INSERT INTO user_memories_fts(rowid, content)
      SELECT rowid, content FROM user_memories WHERE tier != 'archived'
    `);
  }
}
