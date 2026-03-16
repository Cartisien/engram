/**
 * Smoke test — runs A/B eval on first 4 questions only (windows 0 and 1).
 * Usage: npx tsx src/benchmarks/ab-eval/run-smoke.ts
 */

import { runABTest } from './harness.js'
import { printReport } from './report.js'
import { SYNTHETIC_CORPUS } from '../../../tests/fixtures/synthetic-corpus.js'
import { EVAL_QUESTIONS } from './questions.js'

const apiKey = process.env['OPENROUTER_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? ''
if (!apiKey) {
  console.error('Set OPENROUTER_API_KEY or OPENAI_API_KEY')
  process.exit(1)
}

const smokeQuestions = EVAL_QUESTIONS.filter(q => q.id <= 4)
console.log(`Running smoke test: ${smokeQuestions.length} questions across windows 0-1\n`)

async function main() {
  const report = await runABTest(apiKey, SYNTHETIC_CORPUS, smokeQuestions)
  printReport(report)
}

main().catch(err => { console.error(err); process.exit(1) })
