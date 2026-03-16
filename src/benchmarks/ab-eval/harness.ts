/**
 * A/B Evaluation Harness
 *
 * Compares two retrieval modes:
 *   Mode A: Raw chunk retrieval — embed query, cosine search against raw conversation text
 *   Mode B: Claim retrieval — extractClaims + runAllValidators, embed canonical_text, cosine search
 *
 * For each question, both modes retrieve context, then an LLM answers from that context.
 * Scoring uses exact substring match + LLM-based semantic match as fallback.
 */

import type { ConversationTurn } from '../../compiler/schemas.js'
import type { ExtractionResult, MemoryClaim } from '../../compiler/schemas.js'
import { extractClaims } from '../../compiler/extractor.js'
import { runAllValidators } from '../../compiler/validators/index.js'
import { cosineSimilarity } from '../../utils/similarity.js'
import { EVAL_QUESTIONS, type EvalQuestion } from './questions.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerQuestionResult {
  questionId: number
  question: string
  expected_answer: string
  mode_a_answer: string
  mode_b_answer: string
  mode_a_correct: boolean
  mode_b_correct: boolean
  mode_a_context: string
  mode_b_context: string
}

export interface ABTestReport {
  mode_a_score: number
  mode_b_score: number
  total_questions: number
  per_question_results: PerQuestionResult[]
}

// ---------------------------------------------------------------------------
// Embedding via OpenAI API
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text'

async function embedTexts(
  texts: string[],
  _apiKey: string,
): Promise<number[][]> {
  // Use local Ollama for embeddings (free, no quota)
  const results: number[][] = []
  for (const text of texts) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_EMBED_MODEL,
        prompt: text,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama embedding failed (${response.status}): ${body}`)
    }

    const json = (await response.json()) as { embedding: number[] }
    results.push(json.embedding)
  }
  return results
}

// ---------------------------------------------------------------------------
// LLM answer + semantic match
// ---------------------------------------------------------------------------

async function askLLM(
  prompt: string,
  apiKey: string,
  model = process.env['JUDGE_MODEL'] ?? 'google/gemini-2.0-flash-001',
  baseUrl = process.env['JUDGE_BASE_URL'] ?? 'https://openrouter.ai/api/v1',
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM API failed (${response.status}): ${body}`)
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }
  return json.choices[0]?.message?.content?.trim() ?? ''
}

async function answerFromContext(
  question: string,
  context: string,
  apiKey: string,
): Promise<string> {
  const prompt = `Given the following context, answer the question in a brief, factual manner. If the context does not contain enough information, say "unknown".

Context:
${context}

Question: ${question}

Answer (brief, factual):`
  return askLLM(prompt, apiKey)
}

async function semanticMatch(
  answer: string,
  expected: string,
  apiKey: string,
): Promise<boolean> {
  const prompt = `Does answer A match expected answer B in meaning? Consider them matching if A contains the key facts from B, even if worded differently.

A: "${answer}"
B: "${expected}"

Reply with exactly "yes" or "no".`
  const result = await askLLM(prompt, apiKey)
  return result.toLowerCase().startsWith('yes')
}

// ---------------------------------------------------------------------------
// Cosine search helpers
// ---------------------------------------------------------------------------

interface EmbeddedDoc {
  text: string
  embedding: number[]
}

function cosineSearch(
  queryEmbedding: number[],
  docs: EmbeddedDoc[],
  topK = 5,
): EmbeddedDoc[] {
  const scored = docs.map((doc) => ({
    doc,
    score: cosineSimilarity(queryEmbedding, doc.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map((s) => s.doc)
}

// ---------------------------------------------------------------------------
// Mode A: Raw chunk retrieval
// ---------------------------------------------------------------------------

async function buildModeAIndex(
  windows: ConversationTurn[][],
  apiKey: string,
): Promise<EmbeddedDoc[]> {
  const chunks: string[] = []
  for (const window of windows) {
    const text = window
      .map((t) => `${t.role}: ${t.content}`)
      .join('\n')
    chunks.push(text)
  }

  const embeddings = await embedTexts(chunks, apiKey)
  return chunks.map((text, i) => ({
    text,
    embedding: embeddings[i]!,
  }))
}

// ---------------------------------------------------------------------------
// Mode B: Claim retrieval
// ---------------------------------------------------------------------------

async function buildModeBIndex(
  windows: ConversationTurn[][],
  apiKey: string,
): Promise<EmbeddedDoc[]> {
  const allValidClaims: MemoryClaim[] = []

  for (const window of windows) {
    const extraction: ExtractionResult = await extractClaims(window, {
      apiKey,
    })
    const validated = await runAllValidators(extraction)
    allValidClaims.push(...validated.valid)
  }

  if (allValidClaims.length === 0) {
    return []
  }

  const texts = allValidClaims.map((c) => c.canonical_text)
  const embeddings = await embedTexts(texts, apiKey)
  return texts.map((text, i) => ({
    text,
    embedding: embeddings[i]!,
  }))
}

// ---------------------------------------------------------------------------
// Score a single answer
// ---------------------------------------------------------------------------

function exactMatch(answer: string, expected: string): boolean {
  const a = answer.toLowerCase()
  const e = expected.toLowerCase()
  return a.includes(e) || e.includes(a)
}

// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

export async function runABTest(
  apiKey: string,
  corpus: ConversationTurn[][],
  questions?: EvalQuestion[],
): Promise<ABTestReport> {
  const evalQuestions = questions ?? EVAL_QUESTIONS

  console.log('Building Mode A index (raw chunks)...')
  const modeADocs = await buildModeAIndex(corpus, apiKey)

  console.log('Building Mode B index (validated claims)...')
  const modeBDocs = await buildModeBIndex(corpus, apiKey)

  const perQuestionResults: PerQuestionResult[] = []
  let modeACorrect = 0
  let modeBCorrect = 0

  for (const q of evalQuestions) {
    console.log(`  Q${q.id}: ${q.question}`)

    // Embed the question
    const [queryEmbedding] = await embedTexts([q.question], apiKey)

    // Mode A retrieval
    const modeAResults = cosineSearch(queryEmbedding!, modeADocs, 3)
    const modeAContext = modeAResults.map((d) => d.text).join('\n---\n')

    // Mode B retrieval
    const modeBResults = cosineSearch(queryEmbedding!, modeBDocs, 5)
    const modeBContext = modeBResults.map((d) => d.text).join('\n')

    // Get answers from LLM
    const modeAAnswer = await answerFromContext(q.question, modeAContext, apiKey)
    const modeBAnswer = await answerFromContext(q.question, modeBContext, apiKey)

    // Score
    let modeAMatch = exactMatch(modeAAnswer, q.expected_answer)
    let modeBMatch = exactMatch(modeBAnswer, q.expected_answer)

    // Fallback to semantic match if exact fails
    if (!modeAMatch) {
      modeAMatch = await semanticMatch(modeAAnswer, q.expected_answer, apiKey)
    }
    if (!modeBMatch) {
      modeBMatch = await semanticMatch(modeBAnswer, q.expected_answer, apiKey)
    }

    if (modeAMatch) modeACorrect++
    if (modeBMatch) modeBCorrect++

    perQuestionResults.push({
      questionId: q.id,
      question: q.question,
      expected_answer: q.expected_answer,
      mode_a_answer: modeAAnswer,
      mode_b_answer: modeBAnswer,
      mode_a_correct: modeAMatch,
      mode_b_correct: modeBMatch,
      mode_a_context: modeAContext.slice(0, 200),
      mode_b_context: modeBContext.slice(0, 200),
    })
  }

  return {
    mode_a_score: modeACorrect / evalQuestions.length,
    mode_b_score: modeBCorrect / evalQuestions.length,
    total_questions: evalQuestions.length,
    per_question_results: perQuestionResults,
  }
}
