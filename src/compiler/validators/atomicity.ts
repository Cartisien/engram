/**
 * Atomicity Validator / Splitter
 *
 * Instead of rejecting compound claims, splits them into atomic ones.
 *
 * Strategy:
 *   1. If compound connector appears only in object_text → split the object,
 *      clone the claim once per fragment (preserves subject + predicate).
 *   2. If connector appears in the full canonical_text but not the object →
 *      try to split canonical_text on the connector and produce two claims
 *      each with their own canonical_text (subject/predicate/object_text will
 *      be best-effort — the original subject is preserved).
 *   3. If splitting produces a fragment that is blank or < 2 chars → reject
 *      instead of producing a degenerate claim.
 *
 * Examples:
 *   object "dinosaurs and nature"
 *     → claim("User likes dinosaurs") + claim("User likes nature")
 *
 *   canonical "Alice works at Acme and lives in Boston"
 *     → claim("Alice works at Acme") + claim("Alice lives in Boston")
 */

import type { MemoryClaim, Rejection } from '../schemas.js'

const COMPOUND_CONNECTORS = [
  ' and ',
  ' but also ',
  ' as well as ',
  ' while also ',
]

function newId(base: string, n: number): string {
  return `${base}_split${n}`
}

function trimFrag(s: string): string {
  return s.replace(/^[\s,;]+|[\s,;]+$/g, '')
}

function splitOnFirst(text: string, connector: string): [string, string] | null {
  const idx = text.toLowerCase().indexOf(connector)
  if (idx === -1) return null
  return [text.slice(0, idx), text.slice(idx + connector.length)]
}

export function validateAtomicity(
  claims: MemoryClaim[],
): { valid: MemoryClaim[]; rejections: Rejection[] } {
  const valid: MemoryClaim[] = []
  const rejections: Rejection[] = []

  for (const claim of claims) {
    const lower = claim.canonical_text.toLowerCase()
    const connector = COMPOUND_CONNECTORS.find((c) => lower.includes(c))

    if (!connector) {
      valid.push(claim)
      continue
    }

    // ── Case 1: compound is in the object_text only ────────────────────────
    const objLower = (claim.object_text ?? '').toLowerCase()
    if (objLower.includes(connector)) {
      const parts: string[] = claim.object_text!.split(new RegExp(connector, 'i')).map(trimFrag).filter((f): f is string => f.length >= 2)
      if (parts.length < 2) {
        // Can't meaningfully split — keep original
        valid.push(claim)
        continue
      }
      for (let i = 0; i < parts.length; i++) {
        const obj: string = parts[i] as string
        // Rebuild a readable canonical_text
        const escapedObj = (claim.object_text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const canon: string = escapedObj
          ? claim.canonical_text.replace(new RegExp(escapedObj, 'i'), obj as string)
          : `${claim.subject_text} ${claim.predicate} ${obj}`
        valid.push({
          ...claim,
          id: newId(claim.id, i),
          object_text: obj as string,
          canonical_text: canon,
          linked_claim_ids: [...(claim.linked_claim_ids ?? [])],
        })
      }
      continue
    }

    // ── Case 2: compound in canonical_text (predicate boundary) ───────────
    const halves = splitOnFirst(claim.canonical_text, connector)
    if (!halves) {
      valid.push(claim)
      continue
    }
    const [left, right] = [trimFrag(halves[0]), trimFrag(halves[1])]
    if (left.length < 2 || right.length < 2) {
      rejections.push({
        claim,
        reason: 'compound_claim',
        detail: `Cannot split "${claim.canonical_text}" — fragments too short after splitting on "${connector.trim()}"`,
      })
      continue
    }

    // Heuristic: right fragment often drops the subject. Prepend it.
    const subjectPrefix = claim.subject_text ? `${claim.subject_text} ` : ''
    const rightCanon = right.toLowerCase().startsWith(claim.subject_text?.toLowerCase() ?? '\x00')
      ? right
      : `${subjectPrefix}${right}`

    valid.push({ ...claim, id: newId(claim.id, 0), canonical_text: left, object_text: left ?? '', linked_claim_ids: [...(claim.linked_claim_ids ?? [])] })
    valid.push({ ...claim, id: newId(claim.id, 1), canonical_text: rightCanon, object_text: right ?? '', linked_claim_ids: [...(claim.linked_claim_ids ?? [])] })
  }

  return { valid, rejections }
}
