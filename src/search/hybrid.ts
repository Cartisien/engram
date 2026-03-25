// @ts-nocheck
/**
 * Hybrid Search Scoring
 * 
 * v0.7 feature: Combines semantic similarity, keyword relevance, and recency
 * into a single ranking score.
 */

import type { Memory, SearchResult } from '../types.js';

export interface ScoringWeights {
  /** Weight for semantic similarity (0-1) */
  semantic: number;
  /** Weight for keyword relevance (0-1) */
  keyword: number;
  /** Weight for importance (0-1) */
  importance: number;
  /** Weight for recency (0-1) */
  recency: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  semantic: 0.5,
  keyword: 0.25,
  importance: 0.15,
  recency: 0.1,
};

/**
 * Calculate recency boost using exponential decay
 * 
 * @param timestamp - Memory timestamp
 * @param now - Current time
 * @param halfLifeDays - Half-life in days (default: 30)
 * @returns Boost factor (0-1, where 1 = now, 0.5 = half-life ago)
 */
export function calculateRecencyBoost(
  timestamp: Date,
  now: Date = new Date(),
  halfLifeDays: number = 30
): number {
  const ageMs = now.getTime() - timestamp.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  
  // Exponential decay: boost = 2^(-age/halfLife)
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Calculate combined score from multiple factors
 */
export function calculateHybridScore(
  semanticScore: number,
  keywordScore: number,
  importance: number,
  recencyBoost: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  // Normalize weights
  const totalWeight = weights.semantic + weights.keyword + weights.importance + weights.recency;
  const normSemantic = weights.semantic / totalWeight;
  const normKeyword = weights.keyword / totalWeight;
  const normImportance = weights.importance / totalWeight;
  const normRecency = weights.recency / totalWeight;

  // Calculate weighted sum
  const score = 
    semanticScore * normSemantic +
    keywordScore * normKeyword +
    importance * normImportance +
    recencyBoost * normRecency;

  return Math.max(0, Math.min(1, score));
}

/**
 * Rank and sort memories by hybrid score
 */
export function rankMemories(
  memories: Array<{
    memory: Memory;
    semanticScore: number;
    keywordScore: number;
  }>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
  halfLifeDays: number = 30
): SearchResult[] {
  const scored = memories.map(({ memory, semanticScore, keywordScore }) => {
    const recencyBoost = calculateRecencyBoost(memory.timestamp, now, halfLifeDays);
    const importance = memory.importance ?? 0.5;
    
    const combinedScore = calculateHybridScore(
      semanticScore,
      keywordScore,
      importance,
      recencyBoost,
      weights
    );

    return {
      memory,
      semanticScore,
      keywordScore,
      combinedScore,
      recencyBoost,
    };
  });

  // Sort by combined score descending
  return scored.sort((a, b) => b.combinedScore - a.combinedScore);
}

/**
 * Normalize BM25 rank to 0-1 score (higher is better)
 * BM25 returns negative values, lower is better
 */
export function normalizeBM25(rank: number): number {
  // Convert from (-inf, 0] to [0, 1]
  // Using sigmoid-like transformation
  return 1 / (1 + Math.exp(rank / 10));
}
