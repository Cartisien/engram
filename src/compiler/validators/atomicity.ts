/**
 * Atomicity Validator
 *
 * Rejects claims whose canonical_text contains multiple predicates
 * joined by compound connectors. These should have been split during
 * extraction but sometimes slip through.
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

const COMPOUND_CONNECTORS = [
  ' and ',
  ' but also ',
  ' as well as ',
  ' while also ',
]

export function validateAtomicity(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    const lower = claim.canonical_text.toLowerCase()
    const found = COMPOUND_CONNECTORS.find((c) => lower.includes(c))
    if (found) {
      rejections.push({
        claim,
        reason: 'compound_claim',
        detail: `canonical_text contains compound connector "${found.trim()}"`,
      })
    } else {
      valid.push(claim)
    }
  }

  return { valid, rejections }
}
