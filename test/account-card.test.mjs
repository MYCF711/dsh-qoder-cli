// Account-card + theme-adaptation tests for the v7 layout (lib/client.js).
//
// client.js is a browser ModuleLoader bundle and cannot be imported in node, so
// these are source-level greps — the same technique (and the same negative /
// mutation self-checks) as test/client-layout.test.mjs. Every grep here is a
// "silent green" risk: if the marker text drifts, the assertion passes while
// checking nothing. The NEGATIVE section at the bottom re-runs each assertion
// against a mutated copy and requires it to report red.
//
// Coverage:
//   1. four-column header structure (avatar / name+email / remaining credits /
//      actions) with the avatar and text-overflow contracts;
//   2. theme tokens: neutral colours go through var(--dsw-alias-*), while
//      SEMANTIC colours stay hard-coded — the regression gate against
//      "tokenising" a semantic colour and losing its meaning;
//   3. token existence: every --dsw-* token used in the file must exist in the
//      DSH theme body (glossary table in docs/DSH-UI-GLOSSARY.md), so a
//      misspelled token cannot silently fall back to its degraded colour;
//   4. remainingCredits arithmetic — userQuota.remaining + addOnQuota.remaining,
//      rendering '—' when both sides are absent rather than pretending 0.
//
// Run: node --test test/account-card.test.mjs
// (or plain `node test/account-card.test.mjs`; process.exitCode set below.)

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

console.log('== qoder account card (v7) + theme adaptation ==')

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const glossary = await readFile(new URL('../docs/DSH-UI-GLOSSARY.md', import.meta.url), 'utf8')

// lib/client.js is checked out with CRLF line endings on this machine. Every
// multi-line anchor below is written with \n, so normalise once here rather than
// every marker silently failing to match (which is how the first draft of this
// file reported "marker not found" instead of a real assertion failure).
const CRLF = /\r\n/g
const src = source.replace(CRLF, '\n')

// Instrument check: the scanned source must be real JavaScript at all.
test('client.js parses as JavaScript (vm.Script)', () => {
  new vm.Script(source)
})

/** Slice a source region between two markers; throws when a marker is missing. */
function region(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker)
  if (start === -1) throw new Error(`${label}: start marker not found: ${startMarker}`)
  const end = endMarker === null ? -1 : src.indexOf(endMarker, start + startMarker.length)
  return src.slice(start, end === -1 ? undefined : end)
}

// The status tab: from buildStatusTab to the tab switch.
const statusTab = region(source, 'const buildStatusTab = () => {', "const tabContent =", 'status tab')

// The account-card HEADER: from the <header> element up to the remaining-credits
// column's closing (the header element ends after the right-hand action group).
// The <header> element runs from its opening tag to the closing `),` before the
// resource-detail section. Anchor on the element open and on the section comment
// that follows the header.
const headerOpen = src.indexOf("h(\n                'header',")
assert.ok(headerOpen !== -1, 'account-card header element marker not found in buildStatusTab')
const headerEnd = src.indexOf("detailOpen\n", headerOpen)
assert.ok(headerEnd !== -1 && headerEnd > headerOpen, 'header end marker not found')
const header = src.slice(headerOpen, headerEnd)

// ------------------------------------------------------------------
// 1. FOUR-COLUMN HEADER STRUCTURE
// ------------------------------------------------------------------

test('header is a flex row (v7 four-column layout)', () => {
  assert.ok(header.includes("display: 'flex'"), 'header must be a flex row')
  assert.ok(header.includes("alignItems: 'center'"), 'header must centre its columns')
  assert.ok(header.includes("gap: '10px'"), 'header column gap must be 10px')
})

test('header declares four non-wrapping flex children', () => {
  // Column 1 avatar, column 2 name+email (flex:1), column 3 remaining credits,
  // column 4 the action group. Avatar/credits/actions are flex:none so the name
  // column is the only one that absorbs or yields width.
  const noneCount = (header.match(/flex: 'none'/g) ?? []).length
  assert.ok(
    noneCount >= 3,
    `avatar, credits column and the action group must each be flex:'none' (found ${noneCount})`,
  )
  assert.ok(header.includes('flex: 1'), 'the name/email column must be the flexible one (flex: 1)')
})

/** The avatar's own style block: anchored on its pinned width, scoped backwards
 *  to that block's opening brace. Scoping matters because the header holds
 *  several `flex: 'none'` (avatar, credits column, action group). */
const avatarContract = (s) => {
  const at = s.indexOf("minWidth: '34px'")
  if (at === -1) throw new Error('avatar minWidth missing')
  const blockStart = s.lastIndexOf('style: {', at)
  const block = s.slice(blockStart === -1 ? 0 : blockStart, at + 40)
  if (!block.includes("flex: 'none'")) throw new Error('avatar flex:none missing')
  if (!s.includes("borderRadius: '50%'")) throw new Error('avatar must be a circle')
}

test('column 1 avatar: minWidth + flex:none (never squeezed)', () => {
  assert.ok(header.includes("minWidth: '34px'"), "avatar must pin minWidth: '34px'")
  assert.doesNotThrow(() => avatarContract(header), 'avatar block must be flex:none and circular')
})

test('column 2 name: nowrap + ellipsis (never wraps the header)', () => {
  assert.ok(
    header.includes("overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'"),
    'the name line must clip with ellipsis on one line',
  )
  assert.ok(header.includes("minWidth: 0"), 'the name column must set minWidth: 0 or ellipsis cannot engage')
})

test('column 2 email is secondary and clipped too', () => {
  assert.ok(header.includes('account.email'), 'email must be rendered when present')
  const emailLine = header.slice(header.indexOf('account.email'))
  assert.ok(
    emailLine.includes("textOverflow: 'ellipsis'") && emailLine.includes("whiteSpace: 'nowrap'"),
    'the email line must clip like the name line',
  )
})

test('column 3 remaining credits: label + value, never squeezed', () => {
  assert.ok(header.includes('剩余 Credits'), 'the credits column must carry its label')
  // The credits column owns flex:none + a pinned width + centring, all emitted
  // immediately before its label. Anchor on the column's own style block.
  const creditsBlock = header.slice(header.indexOf('// Remaining Credits column'))
  assert.ok(creditsBlock.length > 0, 'the credits column must be present in the header region')
  assert.ok(creditsBlock.includes("flex: 'none'"), 'the credits column must be flex:none')
  assert.ok(creditsBlock.includes("minWidth: '96px'"), 'the credits column must pin its width (96px as of v7)')
  assert.ok(creditsBlock.includes("textAlign: 'center'"), 'the credits column must be centred')
  assert.ok(creditsBlock.includes('fmt(remainingCredits)'), 'the credits column must render the computed sum')
})

test('column 4 action group: nowrap single line', () => {
  const actions = header.slice(header.indexOf("flexWrap: 'nowrap'") - 200)
  assert.ok(
    header.includes("flexWrap: 'nowrap'") && header.includes("whiteSpace: 'nowrap'"),
    'the action group must stay on one nowrap line',
  )
  assert.ok(actions.length > 0, 'action-group region must be sliceable')
})

// ------------------------------------------------------------------
// 2. THEME TOKENS — neutral colourised, semantic hard-coded
// ------------------------------------------------------------------

test('neutral text/border/background colours go through var(--dsw-alias-*)', () => {
  for (const token of [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-border-l4',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-interactive-bg-hover',
  ]) {
    assert.ok(src.includes(`var(${token}`), `${token} must be used for its neutral role`)
  }
})

test('every token use carries a degraded fallback value', () => {
  // `var(--dsw-x)` with no second argument renders NOTHING when the token is
  // absent — the same silent-degradation failure the token-existence gate below
  // guards. Every use must therefore be `var(--dsw-x, <fallback>)`.
  const uses = [...src.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*([,)])/g)]
  assert.ok(uses.length > 0, 'the scan must find token uses at all')
  const withoutFallback = uses.filter(([, , sep]) => sep === ')').map(([, name]) => name)
  assert.deepEqual(
    withoutFallback,
    [],
    `these token uses have no degraded fallback: ${withoutFallback.join(', ')}`,
  )
})

test('online green dot goes through the theme token with a preserved seed (v7 M2)', () => {
  // v7 review M2 (docs/REVIEW-v7-final.md): the hard-coded dot colour was
  // replaced by the theme token so dark mode brightens (4.66:1 -> 6.89:1),
  // while the original value is kept as the degraded seed so that a missing
  // token falls back to the exact colour that shipped before.
  const DOT = "background: 'var(--dsw-alias-state-success-primary, rgb(46,160,67))'"
  assert.ok(src.includes(DOT), `the online dot must use the token with its seed retained: ${DOT}`)
  // The seed must be the ORIGINAL value, not a re-derived approximation.
  const seeded = /var\(--dsw-alias-state-success-primary\s*,\s*(rgb\(46,\s*160,\s*67\))/.exec(src)
  assert.ok(seeded !== null, 'the dot token must carry an explicit degraded seed of the original green')
  assert.equal(
    seeded[1].replace(/\s+/g, ''),
    'rgb(46,160,67)',
    'the degraded seed must stay the original rgb(46,160,67)',
  )
  // The glow accompanies the dot and is not a theme colour.
  assert.ok(src.includes("boxShadow: '0 0 4px rgba(46,160,67,0.3)'"), 'the dot glow must remain')
})

test('the dot is no longer a bare hard-coded background (v7 M2)', () => {
  // The pre-M2 form must be gone: a bare `background: 'rgb(46,160,67)'` as a
  // full background declaration is what the review replaced.
  assert.ok(
    !src.includes("background: 'rgb(46,160,67)'"),
    'the dot background must not be a bare hard-coded value any more',
  )
})

test('SEMANTIC colours stay hard-coded: the signed-in pill keeps its literal pair', () => {
  // The signed-in status pill is NOT part of the M2 token change (M2 covered the
  // dot, a 3:1 non-text indicator). The pill keeps a literal green wash, and its
  // TEXT is the darker fixed tone #1a7f37 — v7 review M1: the lighter theme green
  // fails AA on this translucent wash, so the fixed darker tone is deliberate.
  assert.ok(src.includes("background: 'rgba(46,160,67,0.14)'"), 'the pill keeps its literal green wash')
  assert.ok(
    src.includes("color: '#1a7f37'"),
    'the pill text must stay the fixed darker tone #1a7f37 (v7 M1), not a theme token',
  )
  // It must not have been tokenised.
  const pillText = /state-success-primary[^)]*\)\s*,\s*\n?\s*pill/i.test(src)
  assert.equal(pillText, false, 'the pill text colour must not run through the theme token')
})

test('SEMANTIC colours stay hard-coded: promotion green + unavailable amber', () => {
  // Promotion badge green (t14/v7) and the "unavailable" amber badge must both
  // keep literal colours — tokenising them would make "promo" and "unavailable"
  // theme-dependent, which is a meaning change, not a theme adaptation.
  //
  // The promotion badge and the unavailable badge are asserted over their OWN
  // source region rather than the whole file: `color: '#1a7f37'` also appears in
  // the signed-in pill and the expiry chip, so a file-wide grep would stay green
  // even if the badge itself lost its literal.
  const promoAt = src.indexOf('promoBadge')
  assert.ok(promoAt !== -1, 'promotion badge site not found')
  const promo = src.slice(promoAt, promoAt + 700)
  assert.ok(promo.includes("background: 'rgba(46,160,67,0.12)'"), 'promotion badge keeps its literal green wash')
  assert.ok(promo.includes("color: '#1a7f37'"), 'promotion badge keeps its literal dark-green text')

  const unavailAt = src.indexOf("'不可用'")
  assert.ok(unavailAt !== -1, 'unavailable badge site not found')
  const unavail = src.slice(Math.max(0, unavailAt - 400), unavailAt)
  assert.ok(unavail.includes("'0.5px solid rgba(163,106,3,0.45)'"), 'unavailable badge keeps its amber border')
  assert.ok(unavail.includes("color: 'rgb(154,103,0)'"), 'unavailable badge keeps its amber text')
  // The promotion and unavailable-amber semantics must not be smuggled in as a
  // theme fallback: `var(--dsw-alias-x, rgba(46,160,67,0.12))` would make the
  // meaning theme-conditional.
  //
  // Deliberately scoped: this is NOT a ban on every state token, and NOT a ban on
  // the green literal appearing in any fallback. Two legitimate exceptions exist:
  //   * --dsw-alias-state-error-primary is a theme-level error colour and stays;
  //   * the ONLINE DOT's seed `var(--dsw-alias-state-success-primary, rgb(46,160,67))`
  //     is exactly what v7 M2 prescribes (asserted above), so `rgb(46,160,67)` as
  //     that token's fallback is correct and must not be flagged here.
  // Only the promotion tints and the amber badge values are checked.
  for (const literal of ['rgba(46,160,67,0.12)', 'rgba(163,106,3,0.45)', 'rgb(154,103,0)']) {
    for (const m of src.matchAll(/var\(\s*--dsw-[a-z0-9-]+\s*,\s*([^)]*)\)/g)) {
      assert.ok(
        !m[1].includes(literal),
        `semantic literal ${literal} must not be smuggled in as a theme fallback: ${m[0]}`,
      )
    }
  }
  // The plain green literal may only appear as the success token's seed.
  for (const m of src.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*,\s*([^)]*rgb\(46,160,67\)[^)]*)\)/g)) {
    assert.equal(
      m[1],
      '--dsw-alias-state-success-primary',
      `the plain green may only be a fallback for the success token, found: ${m[0]}`,
    )
  }
})

// ------------------------------------------------------------------
// 3. TOKEN EXISTENCE — the silent-degradation gate
// ------------------------------------------------------------------

/** Token names documented as real in the DSH theme glossary table. */
function glossaryTokens(markdown) {
  const names = new Set()
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue
    for (const m of line.matchAll(/`(--dsw-[a-z0-9-]+)`/g)) names.add(m[1])
  }
  return names
}

const known = glossaryTokens(glossary)

test('token-existence gate: the glossary is non-empty and self-consistent', () => {
  // An empty token table would make the gate below pass vacuously.
  assert.ok(known.size > 30, `glossary token table looks empty (${known.size} names)`)
  assert.ok(known.has('--dsw-alias-label-primary'), 'glossary must contain a control token')
  // Negative control: a name we know is NOT a theme token must be absent.
  assert.ok(!known.has('--dsw-alias-definitely-not-a-token'), 'control name must be absent')
})

test('every --dsw-* token used in client.js exists in the theme glossary', () => {
  const used = [...new Set([...src.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]))].sort()
  assert.ok(used.length > 0, 'the scan must find tokens in client.js')
  const missing = used.filter((name) => !known.has(name))
  assert.deepEqual(
    missing,
    [],
    `these tokens do not exist in the theme body and silently render their degraded fallback: ${missing.join(', ')}`,
  )
})

// ------------------------------------------------------------------
// 4. remainingCredits ARITHMETIC
// ------------------------------------------------------------------

/**
 * The live remainingCredits expression plus the bindings it closes over
 * (sub/packs/num), extracted from client.js and evaluated with injected quota
 * blocks. Evaluating the REAL expression (rather than a copy of it) means these
 * cases fail if the source expression drifts.
 */
const remSrc = region(source, 'const sub = quota?.userQuota ?? null', 'items.push(', 'remainingCredits')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line)) // drop the explanatory comment block
  .join('\n')
  .trim()

function remainingCreditsFor(status) {
  const fn = new Function(
    'status',
    `const quota = status.quota ?? null
     ${remSrc}
     return { remainingCredits, fmt, num, pctText, pctWidth }`,
  )
  return fn(status)
}

test('remainingCredits extraction is live (instrument check)', () => {
  assert.ok(remSrc.includes('rem(sub)'), 'extracted region must contain the subscription read')
  assert.ok(remSrc.includes('rem(packs)'), 'extracted region must contain the add-on read')
  assert.ok(remSrc.includes('remainingCredits'), 'extracted region must define remainingCredits')
  assert.ok(remSrc.includes('userQuota'), 'extracted region must resolve status.quota.userQuota')
})

test('remainingCredits sums userQuota.remaining + addOnQuota.remaining', () => {
  const { remainingCredits } = remainingCreditsFor({
    quota: { userQuota: { remaining: 438 }, addOnQuota: { remaining: 1000 } },
  })
  assert.equal(remainingCredits, 1438, 'both sides present must sum')
})

test('remainingCredits: one side missing contributes 0 (the other is real)', () => {
  const onlySub = remainingCreditsFor({ quota: { userQuota: { remaining: 438 } } })
  assert.equal(onlySub.remainingCredits, 438, 'missing add-on side must contribute 0, not null')

  const onlyAddOn = remainingCreditsFor({ quota: { addOnQuota: { remaining: 1000 } } })
  assert.equal(onlyAddOn.remainingCredits, 1000, 'missing subscription side must contribute 0')
})

test('remainingCredits: both sides missing is null and renders em-dash, never 0', () => {
  const { remainingCredits, fmt } = remainingCreditsFor({ quota: {} })
  assert.equal(remainingCredits, null, 'two missing sides must be null, not 0')
  assert.equal(fmt(remainingCredits), '—', "two missing sides must render '—'")
  // The whole point: '—' must not be reachable as "0".
  assert.notEqual(fmt(remainingCredits), '0', "missing data must never be rendered as '0'")
})

test('remainingCredits: a zero balance is still a real 0, distinct from missing', () => {
  const { remainingCredits, fmt } = remainingCreditsFor({
    quota: { userQuota: { remaining: 0 }, addOnQuota: { remaining: 0 } },
  })
  assert.equal(remainingCredits, 0, 'an explicit zero is data, not absence')
  assert.equal(fmt(remainingCredits), '0', 'an explicit zero must render as 0, not —')
})

test('remainingCredits: non-numeric junk degrades to null, not NaN', () => {
  for (const junk of [{ remaining: 'abc' }, { remaining: null }, { remaining: NaN }, { remaining: Infinity }]) {
    const { remainingCredits } = remainingCreditsFor({ quota: { userQuota: junk, addOnQuota: junk } })
    assert.equal(remainingCredits, null, `junk ${JSON.stringify(junk)} must degrade to null`)
  }
})

test('remainingCredits: absent quota object entirely is null', () => {
  const { remainingCredits } = remainingCreditsFor({})
  assert.equal(remainingCredits, null, 'no quota at all must be null')
})

// ------------------------------------------------------------------
// NEGATIVE / MUTATION SELF-CHECKS
//
// The assertions above are source greps, so their failure mode is a silent green
// when the marker text drifts. Each check re-runs the SAME assertion against a
// MUTATED copy and requires it to fail.
// ------------------------------------------------------------------

/** Apply an assertion to arbitrary source; returns true when it holds. */
function holds(fn, src) {
  try {
    fn(src)
    return true
  } catch {
    return false
  }
}

test('negative: four-column check reports red when the credits column is dropped', () => {
  // Drop the credits column's whole style block (what a real regression would do
  // when someone deletes the column rather than renaming it).
  const creditsAnchor = '// Remaining Credits column'
  const mutated = header.includes(creditsAnchor)
    ? header.slice(0, header.indexOf(creditsAnchor)) + header.slice(header.indexOf("key: 'err'", header.indexOf(creditsAnchor)) - 1)
    : header
  if (mutated === header) throw new Error('mutation did not apply — credits column marker drifted')
  const creditsContract = (s) => {
    const block = s.slice(s.indexOf(creditsAnchor))
    if (block.length === 0 || s.indexOf(creditsAnchor) === -1) throw new Error('credits column absent')
    if (!block.includes("flex: 'none'")) throw new Error('credits flex missing')
    if (!block.includes('fmt(remainingCredits)')) throw new Error('credits value missing')
  }
  if (holds(creditsContract, mutated)) {
    throw new Error('credits-column check passed a header without the column — it cannot report red')
  }
})

test('negative: avatar contract reports red when flex:none is removed', () => {
  // The header contains several flex:'none' (avatar, credits column, actions),
  // so the check must be scoped to the AVATAR block or removing one occurrence
  // still leaves others and the mutation proves nothing.
  if (!holds(avatarContract, header)) {
    throw new Error('avatar contract does not hold on the live header — the positive case is already blind')
  }
  // Mutation: strip flex:'none' from the avatar block only.
  const at = header.indexOf("minWidth: '34px'")
  const blockStart = header.lastIndexOf('style: {', at)
  const mutated = header.slice(0, blockStart) + header.slice(blockStart).replace("flex: 'none',", '', 1)
  if (mutated === header) throw new Error('mutation did not apply — avatar marker drifted')
  if (holds(avatarContract, mutated)) {
    throw new Error('avatar check passed a header without flex:none — it cannot report red')
  }
})

test('negative: ellipsis contract reports red when nowrap is dropped', () => {
  const mutated = header.replace(/whiteSpace: 'nowrap'/g, "whiteSpace: 'normal'")
  if (mutated === header) throw new Error('mutation did not apply — nowrap marker drifted')
  if (holds((s) => { if (!s.includes("whiteSpace: 'nowrap'")) throw new Error('missing') }, mutated)) {
    throw new Error('ellipsis check passed a mutated header — it cannot report red')
  }
})

test('negative: dot-token gate reports red when the dot reverts to bare hard-coding', () => {
  // v7 M2 regression: someone drops the token and paints the dot with the raw
  // colour again, losing the dark-mode contrast improvement.
  const DOT = "background: 'var(--dsw-alias-state-success-primary, rgb(46,160,67))'"
  const mutated = src.replace(DOT, "background: 'rgb(46,160,67)'")
  if (mutated === src) throw new Error('mutation did not apply — dot token marker drifted')
  const dotContract = (s) => {
    if (!s.includes(DOT)) throw new Error('dot must use the success token with its seed')
  }
  if (holds(dotContract, mutated)) {
    throw new Error('dot-token check passed a bare hard-coded dot — it cannot report red')
  }
})

test('negative: dot-seed gate reports red when the seed value is changed', () => {
  // The seed is what renders if the theme token is missing, so a drifted seed is
  // a silent visual regression. Mutate it to a different (plausible) colour.
  const mutated = src.replace(
    'var(--dsw-alias-state-success-primary, rgb(46,160,67))',
    'var(--dsw-alias-state-success-primary, rgb(34,197,94))',
  )
  if (mutated === src) throw new Error('mutation did not apply — dot seed marker drifted')
  const seedContract = (s) => {
    const seed = /var\(--dsw-alias-state-success-primary\s*,\s*([^)]+)\)/.exec(s)
    if (seed === null) throw new Error('seed missing')
    if (seed[1].trim() !== 'rgb(46,160,67)') throw new Error('seed drifted')
  }
  if (holds(seedContract, mutated)) {
    throw new Error('dot-seed check passed a drifted seed — it cannot report red')
  }
})

test('negative: dot-token gate reports red when the token name is misspelled', () => {
  // A misspelled token silently renders the seed, so the tokenisation would look
  // correct while doing nothing. This is the same failure class as the
  // token-existence gate below.
  const mutated = src.replace(
    'var(--dsw-alias-state-success-primary, rgb(46,160,67))',
    'var(--dsw-alias-state-succes-primary, rgb(46,160,67))',
  )
  if (mutated === src) throw new Error('mutation did not apply — dot token marker drifted')
  const dotContract = (s) => {
    if (!s.includes("var(--dsw-alias-state-success-primary, rgb(46,160,67))")) {
      throw new Error('dot token missing or misspelled')
    }
  }
  if (holds(dotContract, mutated)) {
    throw new Error('dot-token check passed a misspelled token — it cannot report red')
  }
})

test('negative: token-existence gate reports red for a misspelled token', () => {
  // Inject a token name that does not exist in the theme body.
  const invented = '--dsw-alias-label-onbrand-typo'
  const injected = `${src} ${invented}`
  const used = [...new Set([...injected.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]))]
  const missing = used.filter((name) => !known.has(name))
  if (!missing.includes(invented)) {
    throw new Error('token-existence gate did not flag an invented token — it cannot report red')
  }
})

test('negative: fallback gate reports red for var() without a degraded value', () => {
  const mutated = `${src}\ncolor: 'var(--dsw-alias-label-primary)',\n`
  if (holds((s) => {
    const uses = [...s.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*([,)])/g)]
    if (uses.some(([, , sep]) => sep === ')')) throw new Error('bare var()')
  }, mutated)) {
    throw new Error('fallback check passed a bare var() — it cannot report red')
  }
})

test('negative: remainingCredits sum reports red when one side is dropped', () => {
  // Mutation: sum only the subscription side, ignoring add-on quota.
  const mutatedExpr = remSrc.replace(
    '(rem(sub) ?? 0) + (rem(packs) ?? 0)',
    '(rem(sub) ?? 0)',
  )
  if (mutatedExpr === remSrc) throw new Error('mutation did not apply — sum expression drifted')
  const fn = new Function('status', `const quota = status.quota ?? null\n${mutatedExpr}\nreturn { remainingCredits }`)
  const { remainingCredits } = fn({ quota: { userQuota: { remaining: 438 }, addOnQuota: { remaining: 1000 } } })
  if (remainingCredits === 1438) {
    throw new Error('sum check passed a mutated expression — it cannot report red')
  }
})

test('negative: em-dash gate reports red when missing data renders as 0', () => {
  const mutatedExpr = remSrc.replace(
    'rem(sub) !== null || rem(packs) !== null ? (rem(sub) ?? 0) + (rem(packs) ?? 0) : null',
    '(rem(sub) ?? 0) + (rem(packs) ?? 0)',
  )
  if (mutatedExpr === remSrc) throw new Error('mutation did not apply — null-guard expression drifted')
  const fn = new Function('status', `const quota = status.quota ?? null\n${mutatedExpr}\nreturn { remainingCredits }`)
  const { remainingCredits } = fn({ quota: {} })
  if (remainingCredits === null) {
    throw new Error('missing-data gate passed a mutated expression — it cannot report red')
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
  console.log('failures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.error?.message ?? f.error}`)
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
