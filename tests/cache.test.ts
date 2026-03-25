import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingCache } from '../src/cache/embedding-cache.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache({ maxSize: 100 });
  });

  describe('Basic Operations', () => {
    it('should store and retrieve embeddings', () => {
      const hash = 'test-hash-1';
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      cache.set(hash, embedding);
      const retrieved = cache.get(hash);

      expect(retrieved).toEqual(embedding);
    });

    it('should return undefined for missing embeddings', () => {
      const retrieved = cache.get('non-existent-hash');
      expect(retrieved).toBeUndefined();
    });

    it('should check if embedding exists', () => {
      const hash = 'test-hash-2';
      const embedding = [0.1, 0.2, 0.3];

      expect(cache.has(hash)).toBe(false);
      cache.set(hash, embedding);
      expect(cache.has(hash)).toBe(true);
    });

    it('should return correct size', () => {
      expect(cache.size()).toBe(0);
      
      cache.set('hash1', [0.1, 0.2]);
      expect(cache.size()).toBe(1);
      
      cache.set('hash2', [0.3, 0.4]);
      expect(cache.size()).toBe(2);
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits', () => {
      const hash = 'test-hash-3';
      const embedding = [0.1, 0.2, 0.3];

      cache.set(hash, embedding);
      cache.get(hash);
      cache.get(hash);

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(1);
    });

    it('should track cache misses', () => {
      cache.get('non-existent-1');
      cache.get('non-existent-2');

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0);
    });

    it('should calculate hit rate correctly', () => {
      const hash = 'test-hash-4';
      cache.set(hash, [0.1, 0.2]);

      cache.get('non-existent'); // miss
      cache.get(hash); // hit
      cache.get('another-non-existent'); // miss
      cache.get(hash); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe('Cache Eviction (LRU)', () => {
    it('should evict least recently used when exceeding max size', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });

      smallCache.set('hash1', [0.1]);
      smallCache.set('hash2', [0.2]);
      smallCache.set('hash3', [0.3]); // Should evict hash1

      expect(smallCache.has('hash1')).toBe(false);
      expect(smallCache.has('hash2')).toBe(true);
      expect(smallCache.has('hash3')).toBe(true);
    });

    it('should update recency on get', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });

      smallCache.set('hash1', [0.1]);
      smallCache.set('hash2', [0.2]);
      
      smallCache.get('hash1'); // Access hash1, making it recently used
      smallCache.set('hash3', [0.3]); // Should evict hash2, not hash1

      expect(smallCache.has('hash1')).toBe(true);
      expect(smallCache.has('hash2')).toBe(false);
      expect(smallCache.has('hash3')).toBe(true);
    });
  });

  describe('Clear Operation', () => {
    it('should clear all entries', () => {
      cache.set('hash1', [0.1]);
      cache.set('hash2', [0.2]);
      
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('hash1')).toBe(false);
      expect(cache.has('hash2')).toBe(false);
    });

    it('should reset statistics on clear', () => {
      cache.set('hash1', [0.1]);
      cache.get('hash1');
      cache.get('non-existent');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty embedding arrays', () => {
      cache.set('empty-hash', []);
      const retrieved = cache.get('empty-hash');
      expect(retrieved).toEqual([]);
    });

    it('should handle large embedding vectors', () => {
      const largeEmbedding = new Array(768).fill(0.1);
      cache.set('large-hash', largeEmbedding);
      const retrieved = cache.get('large-hash');
      expect(retrieved).toEqual(largeEmbedding);
    });

    it('should handle special characters in hash', () => {
      const specialHash = 'hash-with-special-chars-!@#$%^&*()_+';
      const embedding = [0.1, 0.2];

      cache.set(specialHash, embedding);
      expect(cache.get(specialHash)).toEqual(embedding);
    });
  });
});
