/**
 * Memory Compiler — Phase 1 Schemas
 *
 * Structured types for claim extraction, entity resolution,
 * temporal grounding, and validation.
 */

// ---------------------------------------------------------------------------
// Conversation input
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string // ISO-8601
  speaker?: string   // Named entity e.g. "Alice", "user", "assistant"
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'event'
  | 'product'
  | 'concept'
  | 'unknown'

export interface Entity {
  id: string
  name: string
  type: EntityType
  aliases: string[]
}

// ---------------------------------------------------------------------------
// Temporal
// ---------------------------------------------------------------------------

export type TemporalGranularity =
  | 'exact'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'vague'

export type TemporalRelation =
  | 'before'
  | 'after'
  | 'during'
  | 'simultaneous'
  | 'overlaps'

export interface TemporalInfo {
  raw_text: string
  normalized_start?: string  // ISO-8601
  normalized_end?: string    // ISO-8601
  granularity: TemporalGranularity
  relation_type?: TemporalRelation
  relation_to_event?: string // event id or description
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export type MemoryType =
  | 'episodic'   // event that happened
  | 'semantic'   // fact or belief
  | 'procedural' // how-to knowledge
  | 'preference' // user preference

export type Explicitness =
  | 'stated'     // directly said
  | 'implied'    // strongly implied
  | 'inferred'   // derived by reasoning

export type Polarity = 'positive' | 'negative' | 'neutral'

export type ClaimStatus =
  | 'active'
  | 'superseded'
  | 'contradicted'
  | 'cancelled'

export interface MemoryClaim {
  id: string
  canonical_text: string
  subject_entity_id: string
  subject_text: string
  predicate: string
  object_text: string
  object_entity_id?: string
  memory_type: MemoryType
  explicitness: Explicitness
  polarity: Polarity
  status: ClaimStatus
  confidence: number          // 0.0–1.0, computed from CONFIDENCE_WEIGHTS
  temporal?: TemporalInfo
  source_turn_index: number
  linked_claim_ids: string[]
  extraction_confidence: number
  entity_resolution_confidence: number
  temporal_resolution_confidence: number
  support_count: number
  source_directness: number   // 0.0–1.0
}

// ---------------------------------------------------------------------------
// Rejection / Validation
// ---------------------------------------------------------------------------

export type RejectionReason =
  | 'pronoun_subject'
  | 'pronoun_object'
  | 'temporal_invalid'
  | 'duplicate'
  | 'vague_claim'
  | 'compound_claim'
  | 'dangling_entity'
  | 'low_confidence_inference'

export interface Rejection {
  claim: MemoryClaim
  reason: RejectionReason
  detail: string
}

export interface ValidationResult {
  valid: MemoryClaim[]
  rejections: Rejection[]
}

// ---------------------------------------------------------------------------
// Extraction result (LLM output)
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  entities: Entity[]
  claims: MemoryClaim[]
  anchor_conversation_time?: string // ISO-8601
}

// ---------------------------------------------------------------------------
// Extractor config
// ---------------------------------------------------------------------------

export interface ExtractorConfig {
  model?: string        // default: 'gpt-4o-mini'
  baseUrl?: string      // default: 'https://api.openai.com/v1'
  apiKey?: string       // default: process.env.OPENAI_API_KEY
  temperature?: number  // default: 0
  anchorTime?: string   // ISO-8601, injected into prompt
}

// ---------------------------------------------------------------------------
// Confidence weights
// ---------------------------------------------------------------------------

/**
 * claim_confidence =
 *   0.25 * extraction +
 *   0.25 * entity_resolution +
 *   0.20 * temporal_resolution +
 *   0.15 * explicitness +
 *   0.10 * support +
 *   0.05 * source_directness
 */
export const CONFIDENCE_WEIGHTS = {
  extraction: 0.25,
  entity_resolution: 0.25,
  temporal_resolution: 0.20,
  explicitness: 0.15,
  support: 0.10,
  source_directness: 0.05,
} as const

export const EXPLICITNESS_SCORES: Record<Explicitness, number> = {
  stated: 1.0,
  implied: 0.7,
  inferred: 0.4,
}

/**
 * Compute claim confidence from component scores.
 */
export function computeClaimConfidence(claim: MemoryClaim): number {
  const w = CONFIDENCE_WEIGHTS
  const explicitnessScore = EXPLICITNESS_SCORES[claim.explicitness]
  const supportScore = Math.min(claim.support_count / 5, 1.0) // cap at 5

  return (
    w.extraction * claim.extraction_confidence +
    w.entity_resolution * claim.entity_resolution_confidence +
    w.temporal_resolution * claim.temporal_resolution_confidence +
    w.explicitness * explicitnessScore +
    w.support * supportScore +
    w.source_directness * claim.source_directness
  )
}
