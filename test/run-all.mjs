// Aggregate test runner.
//
// Runs every test file in this directory and reports a single aggregate result.
//
// Two constraints shaped this design, both measured on this machine:
//
//  1. A `for` loop over `node file` takes its exit code from the LAST command,
//     so a failure in an earlier file would be reported as success. Hence the
//     accumulate-then-exit runner form.
//  2. Spawning a child `node` process is refused by the DSH sandbox
//     (`spawnSync ... EPERM`), so a spawn-per-file runner reports every file as
//     failed while running none of them. The files are therefore imported
//     in-process instead, and each file's own printed sentinel is captured.
//
// Green is gated on each file's own `ALL ASSERTIONS PASSED` sentinel, printed
// only after that file has counted every assertion — not on a count this runner
// derives itself.
//
// Usage: node test/run-all.mjs

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs') && name !== 'run-all.mjs')
  .sort()

/**
 * Per-invocation nonce appended to every imported URL.
 *
 * ES modules are cached by URL for the lifetime of the process, so importing the
 * same file twice re-runs nothing and yields empty output. Without this nonce a
 * second in-process invocation would report every file as failed while executing
 * none of them — and the "all files failed" result looks like a real finding.
 * Measured: this defect was caught by test/verify-runner-detects-red.mjs.
 */
const runNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const results = []

for (const file of files) {
  const captured = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args) => captured.push(args.join(' '))
  console.error = (...args) => captured.push(args.join(' '))
  console.log(`\n################ ${file} ################`)

  let thrown = null
  try {
    await import(`${pathToFileURL(join(here, file)).href}?run=${runNonce}`)
  } catch (error) {
    thrown = error
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  const text = captured.join('\n')
  originalLog(text)

  const green = text.includes('ALL ASSERTIONS PASSED')
  const summary = /== (\d+) passed, (\d+) failed ==/.exec(text)
  if (!green) {
    if (thrown !== null) originalLog(`  THREW ${thrown.stack ?? thrown.message}`)
    process.exitCode = 1
  }
  results.push({
    file,
    green,
    passed: summary ? Number(summary[1]) : 0,
    failedCount: summary ? Number(summary[2]) : 0,
  })
}

console.log('\n================ AGGREGATE ================')
let totalPassed = 0
let totalFailed = 0
let filesFailed = 0
for (const r of results) {
  totalPassed += r.passed
  totalFailed += r.failedCount
  if (!r.green) filesFailed++
  console.log(
    `${r.green ? 'PASS' : 'FAIL'}  ${r.file.padEnd(28)} ${r.passed} passed, ${r.failedCount} failed`,
  )
}
console.log('-------------------------------------------')
console.log(`files: ${results.length}, green: ${results.length - filesFailed}, failed: ${filesFailed}`)
console.log(`assertions: ${totalPassed} passed, ${totalFailed} failed`)

if (filesFailed > 0 || totalFailed > 0) {
  console.log(`\nRESULT: FAIL`)
  process.exitCode = 1
} else {
  console.log('\nRESULT: ALL FILES GREEN')
}
