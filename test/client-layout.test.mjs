// Layout tests for the Qoder settings-card model rows (lib/client.js).
//
// Verifies the t6-4/t6-5/t6-8 fixes at source level (client.js is a browser
// ModuleLoader bundle and cannot be imported in node):
//   1. the model row container is a CSS grid with the agreed five columns;
//   2. the per-row select placeholders exist so columns stay aligned when a
//      model has no effort ladder (t6-5) or a single context tier (t6-8);
//   3. the price badge no longer uses marginLeft:auto (grid column 5 owns it).
//
// Run: node --test test/client-layout.test.mjs
// (or plain `node test/client-layout.test.mjs`; process.exitCode set below.)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log('  ok   ' + name)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log('  FAIL ' + name)
    console.log('       ' + String(error && error.message).split('\n')[0])
  }
}

console.log('== qoder client model-row layout ==')

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

// Instrument check: the source must be valid JavaScript at all, and the
// scanner below must be able to fail (proven by the injected-bad assertions
// at the end of this file).

test('client.js parses as JavaScript (vm.Script)', () => {
  new vm.Script(source)
})

// The model-row rendering segment: from the per-model loop to the error row.
const loopStart = source.indexOf('for (const model of status.models')
assert.ok(loopStart !== -1, 'model loop marker not found')
const segmentEnd = source.indexOf("if (error !== null)")
const segment = source.slice(loopStart, segmentEnd > loopStart ? segmentEnd : undefined)

test('model row container is a five-column CSS grid (t6-4)', () => {
  assert.ok(segment.includes("display: 'grid'"), "model row must use display: 'grid'")
  assert.ok(
    segment.includes("gridTemplateColumns: '34px 1fr 96px 100px 56px'"),
    "gridTemplateColumns must be exactly '34px 1fr 96px 100px 56px'",
  )
  assert.ok(segment.includes("gap: '8px'"), 'grid gap must be 8px')
})

test('model row no longer relies on flex wrapping (t6-4)', () => {
  assert.ok(!segment.includes('flexWrap'), 'flexWrap is meaningless in grid and must be removed from the row')
})

test('price badge uses the grid column instead of marginLeft:auto (t6-4)', () => {
  assert.ok(!segment.includes("marginLeft: 'auto'"), 'price badge must not push itself with marginLeft:auto inside a grid')
})

test('missing effort select renders an empty placeholder span (t6-5)', () => {
  // effortSelect is null when the model has no reasoningEfforts ladder; the
  // row must still emit a child so the following columns keep their tracks.
  assert.ok(
    segment.includes('effortSelect ?? '),
    'row children must fall back to a placeholder when effortSelect is null',
  )
})

test('missing context select renders an empty placeholder span (t6-8)', () => {
  // ctxSelect is null for single-tier models; the placeholder keeps the
  // price column (and every other row's columns) aligned.
  assert.ok(
    segment.includes('ctxSelect ?? '),
    'row children must fall back to a placeholder when ctxSelect is null',
  )
})

// ------------------------------
// INSTRUMENT SELF-CHECK: the scanner above must be able to report red.
// Assert on a literal that must NOT exist; if a copy of it ever appears,
// these deliberately fail. They also prove `segment` extraction is live
// (an empty segment would fail the grid assertion above, not silently pass).
// ------------------------------
test('instrument check: segment is non-empty and anchored', () => {
  assert.ok(segment.length > 500, 'model-row segment extraction must capture the real loop body')
  assert.ok(segment.includes("'select'"), 'segment must contain the tier/effort select elements')
})

// ------------------------------
// NEGATIVE / MUTATION CHECKS: the assertions above are source greps, so their
// failure mode is a silent green when the marker text drifts. Each check below
// re-runs the same assertion against a MUTATED copy of the segment and requires
// it to fail — proving every grep above can actually report red (and pinning
// the defensive properties the greps stand for).
// ------------------------------

/** Apply an assertion to arbitrary source; returns true when it holds. */
function holds(fn, src) {
  try {
    fn(src)
    return true
  } catch {
    return false
  }
}

const gridColumnsAssert = (src) => {
  if (!src.includes("gridTemplateColumns: '34px 1fr 96px 100px 56px'")) {
    throw new Error('gridTemplateColumns marker missing')
  }
}

test('negative: grid assertion fails when the column template changes', () => {
  const mutated = segment.replace("'34px 1fr 96px 100px 56px'", "'30px 1fr 96px 100px 56px'")
  if (mutated === segment) throw new Error('mutation did not apply — marker text drifted')
  if (holds(gridColumnsAssert, mutated)) throw new Error('grid assertion passed a mutated template — it cannot report red')
})

test('negative: no-flexWrap rule fails when flexWrap is reintroduced', () => {
  const mutated = `${segment}\nflexWrap: 'wrap',\n`
  if (holds((src) => { if (src.includes('flexWrap')) throw new Error('flexWrap found') }, mutated)) {
    throw new Error('no-flexWrap check passed a segment containing flexWrap — it cannot report red')
  }
})

test('negative: marginLeft:auto ban fails when the badge pushes itself again', () => {
  const mutated = `${segment}\nmarginLeft: 'auto',\n`
  if (holds((src) => { if (src.includes("marginLeft: 'auto'")) throw new Error('marginLeft:auto found') }, mutated)) {
    throw new Error('no-marginLeft-auto check passed a mutated segment — it cannot report red')
  }
})

test('negative: placeholder assertions fail when the null-fallback is dropped', () => {
  const withoutEffort = segment.replace('effortSelect ?? ', '')
  const withoutCtx = segment.replace('ctxSelect ?? ', '')
  if (withoutEffort === segment || withoutCtx === segment) {
    throw new Error('placeholder marker not present in the live segment — the positive greps are already blind')
  }
  for (const [marker, mutated] of [['effortSelect ?? ', withoutEffort], ['ctxSelect ?? ', withoutCtx]]) {
    if (holds((src) => { if (!src.includes(marker)) throw new Error('missing') }, mutated)) {
      throw new Error(`placeholder check passed a segment without ${marker} — it cannot report red`)
    }
  }
})

test('negative: vm.Script parse check fails on syntactically broken source', () => {
  let threw = false
  try {
    new vm.Script('function { broken (')
  } catch {
    threw = true
  }
  if (!threw) throw new Error('vm.Script accepted invalid syntax — the parse gate cannot report red')
})

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
