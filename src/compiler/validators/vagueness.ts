/**
 * Vagueness Validator
 *
 * Rejects claims that are too vague:
 * - canonical_text shorter than 10 characters
 * - predicate is empty
 * - object_text is a filler phrase
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

const FILLER_PHRASES = new Set([
  'stuff',
  'things',
  'something',
  'various things',
  'a lot',
])

export function validateVagueness(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    if (claim.canonical_text.length < 10) {
      rejections.push({
        claim,
        reason: 'vague_claim',
        detail: `canonical_text too short (${claim.canonical_text.length} chars, min 10)`,
      })
      continue
    }

    if (!claim.predicate || claim.predicate.trim() === '') {
      rejections.push({
        claim,
        reason: 'vague_claim',
        detail: 'predicate is empty',
      })
      continue
    }

    const normalizedObject = claim.object_text.trim().toLowerCase()
    if (FILLER_PHRASES.has(normalizedObject)) {
      rejections.push({
        claim,
        reason: 'vague_claim',
        detail: `object_text "${claim.object_text}" is a filler phrase`,
      })
      continue
    }

    valid.push(claim)
  }

  return { valid, rejections }
}
