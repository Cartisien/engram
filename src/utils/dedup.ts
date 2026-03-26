/**
 * Memory Deduplication Utilities
 * 
 * v0.7 feature: Detect and handle duplicate or near-duplicate memories
 */

import type { MemoryEntry } from '../types.js';

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) * (a[i] ?? 0);
    magB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find similar memories in a list
 */
export function findSimilarInList(
  embedding: number[],
  memories: MemoryEntry[],
  threshold: number = 0.95
): Array<{ memory: MemoryEntry; similarity: number }> {
  const similar: Array<{ memory: MemoryEntry; similarity: number }> = [];
  
  for (const memory of memories) {
    if (!memory.embedding || memory.embedding.length !== embedding.length) {
      continue;
    }
    
    const similarity = cosineSimilarity(embedding, memory.embedding);
    if (similarity >= threshold) {
      similar.push({ memory, similarity });
    }
  }
  
  // Sort by similarity descending
  return similar.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if two memories are exact duplicates
 */
export function isExactDuplicate(a: MemoryEntry, b: MemoryEntry): boolean {
  return a.contentHash === b.contentHash || a.content === b.content;
}

/**
 * Merge duplicate memories, keeping the most recent and highest importance
 */
export function mergeDuplicates(
  memories: MemoryEntry[]
): MemoryEntry {
  if (memories.length === 0) {
    throw new Error('Cannot merge empty list');
  }
  if (memories.length === 1) {
    return memories[0]!;
  }
  
  // Sort by timestamp descending (most recent first)
  const sorted = [...memories].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );
  
  const newest = sorted[0]!;
  
  // Merge metadata
  const mergedMetadata: Record<string, unknown> = {};
  for (const memory of sorted) {
    if (memory.metadata) {
      Object.assign(mergedMetadata, memory.metadata);
    }
  }
  
  // Take highest importance
  const maxImportance = Math.max(
    ...sorted.map(m => m.importance ?? 0.5)
  );
  
  const result = {
    ...newest,
    importance: maxImportance,
  } as MemoryEntry;
  if (Object.keys(mergedMetadata).length > 0) {
    result.metadata = mergedMetadata;
  }
  return result;
}

/**
 * Deduplicate a list of memories, keeping the best version of each
 */
export function deduplicateMemories(
  memories: MemoryEntry[],
  threshold: number = 0.95
): MemoryEntry[] {
  const groups: MemoryEntry[][] = [];
  const processed = new Set<string>();
  
  for (const memory of memories) {
    if (processed.has(memory.id)) continue;
    
    // Find all similar memories
    const group = [memory];
    processed.add(memory.id);
    
    if (memory.embedding) {
      for (const other of memories) {
        if (processed.has(other.id) || !other.embedding) continue;
        
        const similarity = cosineSimilarity(memory.embedding, other.embedding);
        if (similarity >= threshold) {
          group.push(other);
          processed.add(other.id);
        }
      }
    }
    
    groups.push(group);
  }
  
  // Merge each group
  return groups.map(group => mergeDuplicates(group));
}

/**
 * Generate content hash for deduplication
 * Simple hash - in production use crypto.createHash
 */
export function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}
