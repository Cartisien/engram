/**
 * Inference Validator
 *
 * Rejects claims where explicitness === 'inferred' AND
 * extraction_confidence < 0.6. These are low-confidence inferences
 * that are too unreliable to store.
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

const MIN_INFERENCE_CONFIDENCE = 0.6

export function validateInference(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    if (
      claim.explicitness === 'inferred' &&
      claim.extraction_confidence < MIN_INFERENCE_CONFIDENCE
    ) {
      rejections.push({
        claim,
        reason: 'low_confidence_inference',
        detail: `Inferred claim with extraction_confidence ${claim.extraction_confidence} < ${MIN_INFERENCE_CONFIDENCE}`,
      })
    } else {
      valid.push(claim)
    }
  }

  return { valid, rejections }
}
