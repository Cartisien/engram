import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  findSimilarInList,
  generateContentHash,
  isExactDuplicate,
  mergeDuplicates,
  deduplicateMemories,
} from '../src/utils/dedup.js';
import type { MemoryEntry } from '../src/types.js';

describe('Dedup Utilities', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const a = [1, 0, 0, 1];
      const b = [1, 0, 0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0];
      const b = [-1, 0];
      expect(cosineSimilarity(a, b)).toBe(-1);
    });

    it('should handle zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should calculate similarity for similar vectors', () => {
      const a = [1, 1, 0];
      const b = [1, 1, 0.1];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.95);
      expect(similarity).toBeLessThan(1);
    });

    it('should handle different length vectors', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      const similarity = cosineSimilarity(a, b);
      // Should handle by treating missing as 0
      expect(similarity).toBeGreaterThan(0);
    });
  });

  describe('generateContentHash', () => {
    it('should generate consistent hashes for same content', () => {
      const content = 'test content';
      const hash1 = generateContentHash(content);
      const hash2 = generateContentHash(content);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = generateContentHash('content A');
      const hash2 = generateContentHash('content B');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = generateContentHash('');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle long content', () => {
      const longContent = 'a'.repeat(10000);
      const hash = generateContentHash(longContent);
      expect(typeof hash).toBe('string');
    });

    it('should handle unicode content', () => {
      const unicodeContent = 'Hello 世界 🌍';
      const hash = generateContentHash(unicodeContent);
      expect(typeof hash).toBe('string');
    });
  });

  describe('isExactDuplicate', () => {
    it('should identify exact content duplicates', () => {
      const memory1: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'Same content',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'hash1',
      };
      const memory2: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'Same content',
        role: 'assistant',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'hash2',
      };
      expect(isExactDuplicate(memory1, memory2)).toBe(true);
    });

    it('should identify hash duplicates', () => {
      const memory1: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'Content A',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'same-hash',
      };
      const memory2: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'Content B',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'same-hash',
      };
      expect(isExactDuplicate(memory1, memory2)).toBe(true);
    });

    it('should not flag different content as duplicates', () => {
      const memory1: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'Content A',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'hash1',
      };
      const memory2: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'Content B',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'hash2',
      };
      expect(isExactDuplicate(memory1, memory2)).toBe(false);
    });
  });

  describe('findSimilarInList', () => {
    it('should find similar memories', () => {
      const embedding = [1, 0, 0];
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h1', embedding: [0.99, 0.01, 0] },
        { id: '2', sessionId: 's1', content: 'B', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h2', embedding: [0, 1, 0] },
        { id: '3', sessionId: 's1', content: 'C', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h3', embedding: [0.95, 0.05, 0] },
      ];

      const similar = findSimilarInList(embedding, memories, 0.9);
      expect(similar.length).toBe(2);
      expect(similar[0]?.memory.id).toBe('1');
    });

    it('should return empty array when no matches', () => {
      const embedding = [1, 0, 0];
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h1', embedding: [0, 1, 0] },
      ];

      const similar = findSimilarInList(embedding, memories, 0.9);
      expect(similar.length).toBe(0);
    });

    it('should skip memories without embeddings', () => {
      const embedding = [1, 0, 0];
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h1' },
        { id: '2', sessionId: 's1', content: 'B', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h2', embedding: [0.99, 0.01, 0] },
      ];

      const similar = findSimilarInList(embedding, memories, 0.9);
      expect(similar.length).toBe(1);
      expect(similar[0]?.memory.id).toBe('2');
    });

    it('should sort by similarity descending', () => {
      const embedding = [1, 0, 0];
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h1', embedding: [0.9, 0.1, 0] },
        { id: '2', sessionId: 's1', content: 'B', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h2', embedding: [0.99, 0.01, 0] },
      ];

      const similar = findSimilarInList(embedding, memories, 0.8);
      expect(similar[0]?.similarity).toBeGreaterThan(similar[1]?.similarity || 0);
    });
  });

  describe('mergeDuplicates', () => {
    it('should throw for empty list', () => {
      expect(() => mergeDuplicates([])).toThrow('Cannot merge empty list');
    });

    it('should return single memory as-is', () => {
      const memory: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'Test',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'h1',
      };
      expect(mergeDuplicates([memory])).toEqual(memory);
    });

    it('should keep most recent memory', () => {
      const oldMemory: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'Old',
        role: 'user',
        timestamp: new Date('2023-01-01'),
        tier: 'working',
        contentHash: 'h1',
      };
      const newMemory: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'New',
        role: 'assistant',
        timestamp: new Date('2024-01-01'),
        tier: 'long_term',
        contentHash: 'h2',
      };

      const merged = mergeDuplicates([oldMemory, newMemory]);
      expect(merged.id).toBe('2');
      expect(merged.timestamp).toEqual(newMemory.timestamp);
    });

    it('should merge metadata', () => {
      const memory1: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'A',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'h1',
        metadata: { key1: 'value1' },
      };
      const memory2: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'B',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'h2',
        metadata: { key2: 'value2' },
      };

      const merged = mergeDuplicates([memory1, memory2]);
      expect(merged.metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should take highest importance', () => {
      const memory1: MemoryEntry = {
        id: '1',
        sessionId: 's1',
        content: 'A',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'h1',
        importance: 0.3,
      };
      const memory2: MemoryEntry = {
        id: '2',
        sessionId: 's1',
        content: 'B',
        role: 'user',
        timestamp: new Date(),
        tier: 'working',
        contentHash: 'h2',
        importance: 0.8,
      };

      const merged = mergeDuplicates([memory1, memory2]);
      expect(merged.importance).toBe(0.8);
    });
  });

  describe('deduplicateMemories', () => {
    it('should group and merge similar memories', () => {
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A1', role: 'user', timestamp: new Date('2024-01-01'), tier: 'working', contentHash: 'h1', embedding: [1, 0, 0] },
        { id: '2', sessionId: 's1', content: 'B', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h2', embedding: [0, 1, 0] },
        { id: '3', sessionId: 's1', content: 'A2', role: 'user', timestamp: new Date('2024-01-02'), tier: 'working', contentHash: 'h3', embedding: [0.99, 0.01, 0] },
      ];

      const deduped = deduplicateMemories(memories, 0.95);
      expect(deduped.length).toBe(2); // A1+A2 merged, B stays separate
    });

    it('should handle memories without embeddings', () => {
      const memories: MemoryEntry[] = [
        { id: '1', sessionId: 's1', content: 'A', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h1' },
        { id: '2', sessionId: 's1', content: 'B', role: 'user', timestamp: new Date(), tier: 'working', contentHash: 'h2' },
      ];

      const deduped = deduplicateMemories(memories, 0.95);
      expect(deduped.length).toBe(2); // No embeddings to compare, each forms its own group
    });

    it('should return empty array for empty input', () => {
      const deduped = deduplicateMemories([], 0.95);
      expect(deduped.length).toBe(0);
    });
  });
});
