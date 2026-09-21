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
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    const result = fn()
    // An async body would return a promise that this synchronous helper cannot
    // await: the assertion would resolve AFTER pass++ and any rejection would
    // become an unhandled rejection, i.e. a SILENT GREEN. Reject loudly instead.
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      throw new Error('test body must be synchronous (async bodies silently pass)')
    }
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

// ------------------------------
// ACCOUNTS PANEL (t6/t12): the discovered-account list wired to the three
// backend routes. Added because NO suite asserted on this UI — the endpoints
// were covered by web.test.mjs but their browser half was not.
// ------------------------------
const accountsStart = source.indexOf('const ACCOUNTS_PATH')
assert.ok(accountsStart !== -1, 'accounts route constants not found')

const accountsPanelStart = source.indexOf('const accountsPanel = h(')
const accountsPanelEnd = source.indexOf('accountsPanel,', accountsPanelStart)
assert.ok(accountsPanelStart !== -1 && accountsPanelEnd > accountsPanelStart, 'accounts panel render not found')
const accountsPanel = source.slice(accountsPanelStart, accountsPanelEnd)

// The per-account card builder, which owns the activate/probe controls.
// NOTE: those controls live in `accountRow`, NOT inside the panel array literal —
// asserting on the panel slice alone fails. Anchor on the builder instead.
const rowStart = source.lastIndexOf('accountRow', source.indexOf("runAccountAction(account, 'activate')"))
const accountRowStart = source.lastIndexOf('const accountRow =', source.indexOf("runAccountAction(account, 'activate')"))
assert.ok(accountRowStart !== -1, 'accountRow builder not found')
const accountRow = source.slice(accountRowStart, accountsPanelStart)

// The whole accounts feature: the route constants and the three fetchers near the
// top (L32-160) through the panel render (L1464+). Slicing only from the state
// declarations missed the fetchers, which is why the route assertions failed.
const accountsRegion = source.slice(accountsStart, accountsPanelEnd)

test('accounts client declares all three backend routes', () => {
  for (const marker of ['ACCOUNTS_PATH', 'ACCOUNTS_ACTIVATE_PATH', 'ACCOUNTS_PROBE_PATH']) {
    assert.ok(accountsRegion.includes(`const ${marker} = '/plugins/dsh-qoder-cli/accounts`),
      `${marker} must be declared with its /plugins/dsh-qoder-cli path`)
  }
})

test('accounts client actually fetches all three backend routes', () => {
  assert.ok(accountsRegion.includes('fetch(ACCOUNTS_PATH'), 'GET accounts must be fetched')
  assert.ok(accountsRegion.includes('fetch(ACCOUNTS_ACTIVATE_PATH'), 'activate must be fetched')
  assert.ok(accountsRegion.includes('fetch(ACCOUNTS_PROBE_PATH'), 'probe must be fetched')
})

test('accounts panel distinguishes loading from empty (no silent-failure shape)', () => {
  // accounts === null means "not yet loaded"; [] means "genuinely none".
  // Collapsing them would render a failed fetch as "no accounts".
  // Anchored on the REAL code line (`: accounts === null`), not the comment that
  // also contains this text — a prose-only match would be a blind assertion.
  const codeMatch = /[?:]\s*accounts === null/.test(accountsRegion)
  assert.ok(codeMatch, 'null (loading) must be distinguished from [] (empty) in executable code')
  assert.ok(accountsRegion.includes('accountsError'), 'a fetch error must have its own state')
})

test('accounts panel renders a per-account activate and probe control', () => {
  assert.ok(accountRow.includes("'activate'"), 'activate control must exist in accountRow')
  assert.ok(accountRow.includes("'probe'"), 'probe control must exist in accountRow')
  assert.ok(accountsPanel.includes('.map(accountRow)'), 'the panel must render one row per account')
})

test('accounts UI uses only tokens present in the shipped theme', () => {
  // Historical defect: three non-existent --dsw-* tokens caused silent
  // white-on-white in dark theme. Assert every token used here exists.
  // NOTE: synchronous on purpose — this file's `test()` helper cannot await.
  const theme = readFileSync(
    'D:/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
    'utf8',
  )
  const used = [...new Set([...accountsRegion.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)].map((m) => m[1]))]
  assert.ok(used.length > 0, 'accounts region must use theme tokens, not raw colours')
  const missing = used.filter((t) => !theme.includes(t))
  assert.deepEqual(missing, [], `accounts UI uses tokens absent from the shipped theme: ${missing.join(', ')}`)
})

test('every accounts-UI token carries a fallback seed', () => {
  const ungated = [...accountsRegion.matchAll(/var\(--dsw-[a-zA-Z0-9-]+\)/g)].map((m) => m[0])
  assert.deepEqual(ungated, [], `token used without a fallback seed: ${ungated.join(', ')}`)
})

test('accounts region is CRLF (client.js line-ending contract)', () => {
  // client.js ships CRLF; a lone LF here would mean an editor rewrote a chunk.
  const lfOnly = (accountsRegion.match(/(?<!\r)\n/g) ?? []).length
  assert.equal(lfOnly, 0, `accounts region contains ${lfOnly} LF-only newline(s)`)
})

// ------------------------------
// NEGATIVE / MUTATION CHECKS for the accounts assertions above.
// Each re-runs the same predicate against a MUTATED copy and requires failure,
// so a drifting marker cannot leave these greps silently green.
// ------------------------------
const routeAssert = (src) => {
  for (const marker of ['ACCOUNTS_PATH', 'ACCOUNTS_ACTIVATE_PATH', 'ACCOUNTS_PROBE_PATH']) {
    if (!src.includes(`const ${marker} = `)) throw new Error(`route marker missing: ${marker}`)
  }
}

test('negative: route assertion fails when a route reference is dropped', () => {
  const mutated = accountsRegion.replace('const ACCOUNTS_PROBE_PATH = ', 'const REMOVED = ')
  if (mutated === accountsRegion) throw new Error('mutation did not apply — marker text drifted')
  if (holds(routeAssert, mutated)) throw new Error('route assertion passed a region missing the probe route — it cannot report red')
})

test('negative: fetch assertion fails when a fetcher is dropped', () => {
  const mutated = accountsRegion.replace('fetch(ACCOUNTS_PROBE_PATH', 'fetch(REMOVED_PATH')
  if (mutated === accountsRegion) throw new Error('mutation did not apply')
  if (holds((src) => { if (!src.includes('fetch(ACCOUNTS_PROBE_PATH')) throw new Error('missing') }, mutated)) {
    throw new Error('fetch assertion passed a region without the probe fetcher — it cannot report red')
  }
})

test('negative: loading/empty distinction fails when the code null-check is removed', () => {
  // Mutate the EXECUTABLE occurrence; the text also appears in a comment, so a
  // naive replace could hit prose and leave the assertion genuinely blind.
  const mutated = accountsRegion.replace(': accounts === null', ': false')
  if (mutated === accountsRegion) throw new Error('mutation did not apply to executable code')
  if (holds((src) => { if (!/[?:]\s*accounts === null/.test(src)) throw new Error('missing') }, mutated)) {
    throw new Error('null-vs-empty check passed a mutated region — it cannot report red')
  }
})

test('negative: token-existence check reports a fabricated token', () => {
  const theme = readFileSync(
    'D:/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
    'utf8',
  )
  const fabricated = '--dsw-alias-THIS-DOES-NOT-EXIST'
  const used = [...new Set([...`var(${fabricated}, #000)`.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)].map((m) => m[1]))]
  const missing = used.filter((t) => !theme.includes(t))
  if (missing.length === 0) throw new Error('token-existence check accepted a fabricated token — it cannot report red')
})

test('negative: fallback-seed check reports a token without a seed', () => {
  const sample = 'var(--dsw-alias-label-primary)'
  const ungated = [...sample.matchAll(/var\(--dsw-[a-zA-Z0-9-]+\)/g)].map((m) => m[0])
  if (ungated.length === 0) throw new Error('fallback-seed check accepted a seedless token — it cannot report red')
})

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
