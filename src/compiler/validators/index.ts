/**
 * Validator Pipeline
 *
 * Chains all validators in order:
 *   pronoun-ban → temporal → duplicate → vagueness → atomicity → entity-reference → inference
 */

import type {
  ExtractionResult,
  MemoryClaim,
  Rejection,
  ValidationResult,
} from '../schemas.js'
import { validatePronounBan } from './pronoun-ban.js'
import { validateTemporal } from './temporal.js'
import { validateDuplicates } from './duplicate.js'
import { validateVagueness } from './vagueness.js'
import { validateAtomicity } from './atomicity.js'
import { validateEntityReferences } from './entity-reference.js'
import { validateInference } from './inference.js'

export { validatePronounBan } from './pronoun-ban.js'
export { validateTemporal } from './temporal.js'
export { validateDuplicates, claimHash } from './duplicate.js'
export { validateVagueness } from './vagueness.js'
export { validateAtomicity } from './atomicity.js'
export { validateEntityReferences } from './entity-reference.js'
export { validateInference } from './inference.js'

/**
 * Run all validators in sequence. Each validator receives only the claims
 * that passed the previous stage.
 */
export async function runAllValidators(
  result: ExtractionResult,
  existingHashes: Set<string> = new Set(),
): Promise<ValidationResult> {
  let claims: MemoryClaim[] = result.claims
  const allRejections: Rejection[] = []

  // 1. Pronoun ban
  const pronounResult = validatePronounBan(claims)
  allRejections.push(...pronounResult.rejections)
  claims = pronounResult.valid

  // 2. Temporal validation
  const temporalResult = validateTemporal(claims)
  allRejections.push(...temporalResult.rejections)
  claims = temporalResult.valid

  // 3. Duplicate detection
  const dupResult = validateDuplicates(claims, existingHashes)
  allRejections.push(...dupResult.rejections)
  claims = dupResult.valid

  // 4. Vagueness check
  const vagueResult = validateVagueness(claims)
  allRejections.push(...vagueResult.rejections)
  claims = vagueResult.valid

  // 5. Atomicity check
  const atomicityResult = validateAtomicity(claims)
  allRejections.push(...atomicityResult.rejections)
  claims = atomicityResult.valid

  // 6. Entity reference check
  const entityRefResult = validateEntityReferences(claims, result.entities)
  allRejections.push(...entityRefResult.rejections)
  claims = entityRefResult.valid

  // 7. Inference confidence check
  const inferenceResult = validateInference(claims)
  allRejections.push(...inferenceResult.rejections)
  claims = inferenceResult.valid

  return { valid: claims, rejections: allRejections }
}
