// Instrument self-check for test/run-all.mjs.
//
// A runner that always prints green is not evidence. This copies the suite to a
// temp tree, injects a deliberate failure, and asserts the runner reports it.
// Usage: node test/verify-runner-detects-red.mjs

import { mkdtemp, mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(here)
const scratch = await mkdtemp(join(tmpdir(), 'qoder-runner-check-'))

let pass = 0
let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

try {
  await cp(join(projectRoot, 'lib'), join(scratch, 'lib'), { recursive: true })
  await cp(join(projectRoot, 'test'), join(scratch, 'test'), { recursive: true })

  /** Run the copied runner and return its stdout. */
  const runRunner = async () => {
    const captured = []
    const originalLog = console.log
    const originalError = console.error
    console.log = (...a) => captured.push(a.join(' '))
    console.error = (...a) => captured.push(a.join(' '))
    // Re-import with a cache-busting query so repeated runs re-execute.
    const href = pathToFileURL(join(scratch, 'test', 'run-all.mjs')).href + `?v=${Math.random()}`
    try {
      await import(href)
    } finally {
      console.log = originalLog
      console.error = originalError
    }
    return captured.join('\n')
  }

  const baseline = await runRunner()
  await check('the pristine copy reports ALL FILES GREEN', () => {
    assert.ok(
      baseline.includes('RESULT: ALL FILES GREEN'),
      `expected a green baseline; tail was:\n${baseline.split('\n').slice(-12).join('\n')}`,
    )
  })

  // Inject a failing assertion into a copy of the core suite.
  const victim = join(scratch, 'test', 'core.test.mjs')
  const original = await readFile(victim, 'utf8')
  const injected = original.replace(
    "  test('provider id is the qoder route name', () => {\n    assert.equal(constants.QODER_PROVIDER, 'qoder-cli')\n  })",
    "  test('INJECTED FAILURE', () => {\n    assert.equal(constants.QODER_PROVIDER, 'deliberately-wrong')\n  })",
  )
  assert.notEqual(injected, original, 'the injection must actually change the file')
  await writeFile(victim, injected)

  const red = await runRunner()
  await check('an injected failure makes the runner report FAIL', () => {
    assert.ok(!red.includes('RESULT: ALL FILES GREEN'), 'the runner must not stay green')
    assert.ok(red.includes('RESULT: FAIL'), 'the runner must print RESULT: FAIL')
  })
  await check('the failure names the file that broke', () => {
    assert.ok(red.includes('core.test.mjs'), 'the failing file must be named')
  })
  await check('a green file is still distinguished from the red one', () => {
    assert.ok(red.includes('PASS  store.test.mjs'), 'unaffected files must still read PASS')
  })
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
// The imported run-all.mjs sets process.exitCode = 1 during the deliberate
// red run (a process-level side effect that outlives the import). Recompute
// the exit code explicitly so it reflects THIS script's own tally only.
process.exitCode = fail > 0 ? 1 : 0
if (fail > 0) console.log('INSTRUMENT CHECK FAILED')
else console.log('INSTRUMENT CHECK PASSED')
