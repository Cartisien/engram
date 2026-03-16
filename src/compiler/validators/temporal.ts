/**
 * Temporal Validator
 *
 * Validates TemporalInfo constraints:
 * - normalized_end cannot precede normalized_start
 * - If relation_type is set, relation_to_event must be non-null
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

export function validateTemporal(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    const t = claim.temporal
    if (!t) {
      valid.push(claim)
      continue
    }

    // Check: normalized_end cannot precede normalized_start
    if (t.normalized_start && t.normalized_end) {
      const start = new Date(t.normalized_start)
      const end = new Date(t.normalized_end)
      if (end.getTime() < start.getTime()) {
        rejections.push({
          claim,
          reason: 'temporal_invalid',
          detail: `Temporal end (${t.normalized_end}) precedes start (${t.normalized_start})`,
        })
        continue
      }
    }

    // Check: relation_type requires relation_to_event
    if (t.relation_type && !t.relation_to_event) {
      rejections.push({
        claim,
        reason: 'temporal_invalid',
        detail: `Temporal relation_type "${t.relation_type}" set but relation_to_event is missing`,
      })
      continue
    }

    valid.push(claim)
  }

  return { valid, rejections }
}
