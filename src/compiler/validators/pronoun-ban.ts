/**
 * Pronoun Ban Validator
 *
 * Rejects claims whose canonical_text subject or object is a pronoun.
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

const PRONOUNS = new Set([
  // personal
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  // demonstrative
  'this', 'that', 'these', 'those',
  // relative / interrogative
  'who', 'whom', 'whose', 'which',
  // indefinite
  'someone', 'somebody', 'anyone', 'anybody',
  'everyone', 'everybody', 'no one', 'nobody',
])

function isPronoun(text: string): boolean {
  return PRONOUNS.has(text.trim().toLowerCase())
}

export function validatePronounBan(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    if (isPronoun(claim.subject_text)) {
      rejections.push({
        claim,
        reason: 'pronoun_subject',
        detail: `Subject "${claim.subject_text}" is a pronoun`,
      })
    } else if (isPronoun(claim.object_text)) {
      rejections.push({
        claim,
        reason: 'pronoun_object',
        detail: `Object "${claim.object_text}" is a pronoun`,
      })
    } else {
      valid.push(claim)
    }
  }

  return { valid, rejections }
}
