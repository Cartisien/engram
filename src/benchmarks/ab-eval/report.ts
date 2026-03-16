/**
 * A/B Evaluation — Report Printer
 *
 * Renders a console table of per-question results and final accuracy scores.
 */

import type { ABTestReport } from './harness.js'

export function printReport(report: ABTestReport): void {
  console.log('\n' + '='.repeat(90))
  console.log('  A/B EVALUATION REPORT')
  console.log('='.repeat(90))

  // Header
  const header = [
    'Q#'.padEnd(4),
    'Question'.padEnd(45),
    'A'.padEnd(5),
    'B'.padEnd(5),
    'Expected'.padEnd(25),
  ].join(' | ')

  console.log(header)
  console.log('-'.repeat(90))

  // Per-question rows
  for (const r of report.per_question_results) {
    const row = [
      String(r.questionId).padEnd(4),
      r.question.slice(0, 45).padEnd(45),
      (r.mode_a_correct ? 'Y' : 'N').padEnd(5),
      (r.mode_b_correct ? 'Y' : 'N').padEnd(5),
      r.expected_answer.slice(0, 25).padEnd(25),
    ].join(' | ')
    console.log(row)
  }

  console.log('-'.repeat(90))

  // Summary
  const aScore = (report.mode_a_score * 100).toFixed(1)
  const bScore = (report.mode_b_score * 100).toFixed(1)
  const aCorrect = report.per_question_results.filter((r) => r.mode_a_correct).length
  const bCorrect = report.per_question_results.filter((r) => r.mode_b_correct).length

  console.log(`  Mode A (raw chunks):      ${aCorrect}/${report.total_questions} = ${aScore}%`)
  console.log(`  Mode B (validated claims): ${bCorrect}/${report.total_questions} = ${bScore}%`)

  const delta = report.mode_b_score - report.mode_a_score
  const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(1)}` : (delta * 100).toFixed(1)
  console.log(`  Delta (B - A):             ${deltaStr}%`)

  console.log('='.repeat(90) + '\n')

  // Per-question detail (answers)
  console.log('Answer Details:')
  for (const r of report.per_question_results) {
    console.log(`  Q${r.questionId}: ${r.question}`)
    console.log(`    Expected: ${r.expected_answer}`)
    console.log(`    Mode A:   ${r.mode_a_answer} [${r.mode_a_correct ? 'PASS' : 'FAIL'}]`)
    console.log(`    Mode B:   ${r.mode_b_answer} [${r.mode_b_correct ? 'PASS' : 'FAIL'}]`)
    console.log()
  }
}
