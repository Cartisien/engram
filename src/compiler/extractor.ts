/**
 * Memory Compiler — Claim Extractor
 *
 * Single OpenAI-compatible API call to extract structured claims
 * from conversation turns. Uses fetch (no SDK dependency).
 */

import type {
  ConversationTurn,
  ExtractorConfig,
  ExtractionResult,
} from './schemas.js'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory claim extractor. Given a conversation, extract structured claims as JSON.

## Rules

1. **Never store pronouns as subject or object.** Resolve "he", "she", "they", "it", "I", "you", "we", etc. to the named entity they refer to. If the referent is truly unknown, use "unknown" as the entity name.

2. **Never fabricate exact dates from vague temporal language.** If someone says "last year" or "a few months ago", preserve the vagueness. Use granularity="vague" and keep raw_text. Only produce normalized_start/normalized_end when an exact or near-exact date is stated or can be computed from anchor_conversation_time.

3. **Split compound statements into atomic claims.** "Alice works at Acme and lives in Boston" → two separate claims.

4. **Resolve entities to named entities where possible.** Create entity records with aliases (e.g., Robert / Rob / Bobby → single entity). Use type "unknown" when the entity type is genuinely ambiguous.

5. **Normalize relative time expressions** using the provided anchor_conversation_time. "Yesterday" → anchor minus 1 day. "Last Tuesday" → compute the date. But "a while ago" → granularity="vague".

6. **Preserve contradictions as separate linked claims.** If a later statement contradicts an earlier one, emit both claims. Set the earlier claim's status to "superseded" and the later one to "active". Link them via linked_claim_ids.

7. **Assign confidence scores:**
   - extraction_confidence: how confident you are in the extraction (0.0–1.0)
   - entity_resolution_confidence: how confident the entity resolution is correct (0.0–1.0)
   - temporal_resolution_confidence: how confident the temporal grounding is (0.0–1.0, lower for vague times)
   - source_directness: 1.0 for directly stated facts, lower for implied/inferred
   - support_count: start at 1, increment if the same fact appears multiple times

8. **CRITICAL — Preserve specific names, places, and list items verbatim. Never paraphrase or abstract.**

   BAD → GOOD examples:
   - ❌ object_text: "home country"          ✅ object_text: "Sweden"
   - ❌ object_text: "nature and animals"    ✅ Two claims: object_text: "dinosaurs" AND object_text: "nature"
   - ❌ canonical: "Caroline values helping others"  ✅ canonical: "Caroline researched adoption agencies in Sweden"
   - ❌ object_text: "a European city"       ✅ object_text: "Berlin"
   - ❌ canonical: "User has outdoor interests"  ✅ canonical: "User enjoys hiking and rock climbing"

   Rule: if the conversation contains a specific word, use that exact word. Do NOT replace it with a category or description.

9. **Return valid JSON only**, matching the ExtractionResult schema:
   {
     "entities": [{ "id": string, "name": string, "type": EntityType, "aliases": string[] }],
     "claims": [{ "id": string, "canonical_text": string, "subject_entity_id": string, "subject_text": string, "predicate": string, "object_text": string, "object_entity_id": string|undefined, "memory_type": MemoryType, "explicitness": Explicitness, "polarity": Polarity, "status": ClaimStatus, "confidence": number, "temporal": TemporalInfo|undefined, "source_turn_index": number, "linked_claim_ids": string[], "extraction_confidence": number, "entity_resolution_confidence": number, "temporal_resolution_confidence": number, "support_count": number, "source_directness": number }],
     "anchor_conversation_time": string|undefined
   }

EntityType = "person" | "organization" | "location" | "event" | "product" | "concept" | "unknown"
MemoryType = "episodic" | "semantic" | "procedural" | "preference"
Explicitness = "stated" | "implied" | "inferred"
Polarity = "positive" | "negative" | "neutral"
ClaimStatus = "active" | "superseded" | "contradicted" | "cancelled"
TemporalGranularity = "exact" | "day" | "week" | "month" | "quarter" | "year" | "vague"
TemporalRelation = "before" | "after" | "during" | "simultaneous" | "overlaps"

Return ONLY the JSON object. No markdown fencing, no commentary.`

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

// Model resolution order:
//   COMPILER_MODEL > EXTRACT_MODEL > default (google/gemini-2.0-flash-001)
// Base URL resolution order:
//   COMPILER_BASE_URL > EXTRACT_BASE_URL > default (OpenRouter)
//
// Common overrides:
//   COMPILER_MODEL=gpt-4o                                   (OpenAI direct)
//   COMPILER_MODEL=ollama/qwen2.5:32b COMPILER_BASE_URL=http://192.168.68.73:11434/v1
const DEFAULT_MODEL = process.env['COMPILER_MODEL'] ?? process.env['EXTRACT_MODEL'] ?? 'google/gemini-2.0-flash-001'
const DEFAULT_BASE_URL = process.env['COMPILER_BASE_URL'] ?? process.env['EXTRACT_BASE_URL'] ?? 'https://openrouter.ai/api/v1'

export async function extractClaims(
  turns: ConversationTurn[],
  config: ExtractorConfig = {},
): Promise<ExtractionResult> {
  const model = config.model ?? DEFAULT_MODEL
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const apiKey = config.apiKey ?? process.env['OPENROUTER_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? ''
  const temperature = config.temperature ?? 0
  const anchorTime = config.anchorTime ?? new Date().toISOString()

  const userContent = JSON.stringify({
    anchor_conversation_time: anchorTime,
    turns: turns.map((t, i) => ({
      index: i,
      role: t.role,
      content: t.content,
      timestamp: t.timestamp,
      speaker: t.speaker,
    })),
  })

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      // Note: Ollama supports response_format json for compatible models
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Extraction API call failed (${response.status}): ${body}`,
    )
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }

  let raw = json.choices[0]?.message?.content
  // Strip <think>...</think> blocks emitted by reasoning models (e.g. qwen3 on OpenRouter)
  if (raw) raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // Also strip markdown code fences if the model wrapped the JSON
  if (raw) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
  if (!raw) {
    throw new Error('Extraction API returned empty content')
  }

  const parsed = JSON.parse(raw) as ExtractionResult
  // Debug: log shape if claims is missing or not an array
  if (!Array.isArray((parsed as any).claims)) {
    process.stderr.write(`[extractor debug] unexpected shape: ${JSON.stringify(parsed).slice(0, 500)}\n`)
  }
  return parsed
}
