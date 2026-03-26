/**
 * Embedding Cache - LRU cache for embeddings to avoid recomputation
 * 
 * v0.7 feature: Caches embeddings by content hash to reduce API calls
 */

import { LRUCache } from 'lru-cache';

export interface EmbeddingCacheOptions {
  maxSize: number;
  ttl?: number; // Time to live in milliseconds
}

export class EmbeddingCache {
  private cache: LRUCache<string, number[]>;
  private hits = 0;
  private misses = 0;

  constructor(options: EmbeddingCacheOptions) {
    this.cache = new LRUCache<string, number[]>({
      max: options.maxSize,
      ...(options.ttl != null ? { ttl: options.ttl } : {}),
      updateAgeOnGet: true,
    });
  }

  /**
   * Get embedding from cache
   */
  get(contentHash: string): number[] | undefined {
    const cached = this.cache.get(contentHash);
    if (cached) {
      this.hits++;
      return cached;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Store embedding in cache
   */
  set(contentHash: string, embedding: number[]): void {
    this.cache.set(contentHash, embedding);
  }

  /**
   * Check if embedding is cached
   */
  has(contentHash: string): boolean {
    return this.cache.has(contentHash);
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }
}
