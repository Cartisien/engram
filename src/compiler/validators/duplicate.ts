/**
 * Duplicate Validator
 *
 * Hashes canonical_text + subject_entity_id + predicate.
 * Rejects if hash exists in provided existingHashes Set.
 */

import { createHash } from 'node:crypto'
import type { MemoryClaim, Rejection } from '../schemas.js'

export function claimHash(claim: MemoryClaim): string {
  const input = `${claim.canonical_text}|${claim.subject_entity_id}|${claim.predicate}`
  return createHash('sha256').update(input).digest('hex')
}

export function validateDuplicates(
  claims: MemoryClaim[],
  existingHashes: Set<string> = new Set(),
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []
  const seen = new Set<string>(existingHashes)

  for (const claim of claims) {
    const hash = claimHash(claim)
    if (seen.has(hash)) {
      rejections.push({
        claim,
        reason: 'duplicate',
        detail: `Duplicate claim (hash: ${hash.slice(0, 12)}…)`,
      })
    } else {
      seen.add(hash)
      valid.push(claim)
    }
  }

  return { valid, rejections }
}
