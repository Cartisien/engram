/**
 * Entity Reference Validator
 *
 * Verifies every subject_entity_id and object_entity_id in each claim
 * exists in the provided entities array. Rejects claims with dangling
 * entity references.
 */

import type { Entity, MemoryClaim, Rejection } from '../schemas.js'

export function validateEntityReferences(
  claims: MemoryClaim[],
  entities: Entity[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const entityIds = new Set(entities.map((e) => e.id))
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    if (!entityIds.has(claim.subject_entity_id)) {
      rejections.push({
        claim,
        reason: 'dangling_entity',
        detail: `subject_entity_id "${claim.subject_entity_id}" not found in entities`,
      })
      continue
    }

    if (
      claim.object_entity_id !== undefined &&
      claim.object_entity_id !== null &&
      !entityIds.has(claim.object_entity_id)
    ) {
      rejections.push({
        claim,
        reason: 'dangling_entity',
        detail: `object_entity_id "${claim.object_entity_id}" not found in entities`,
      })
      continue
    }

    valid.push(claim)
  }

  return { valid, rejections }
}
