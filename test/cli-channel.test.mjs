// Tests for the CLI channel as a FIRST-CLASS channel for Qoder proprietary
// models (plan A). Complements test/cli-fallback.test.mjs (which covers the
// SSE/stream-json translation) by covering:
//
//   1. the model set + the single source of truth models.js consults,
//   2. fail-closed behaviour with a machine-readable reason on every failure,
//   3. the no-silent-substitute rule when QODER_CLI_PATH is set but missing,
//   4. the EPERM -> shell-redirect -> kill-signal escalation ladder,
//   5. a live reachability probe of the real CLI from THIS runtime.
//
// Run: node test/cli-channel.test.mjs

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
const failures = []

function testAsync(name, fn) {
  return (async () => {
    try {
      await fn()
      pass++
      console.log('  ok   ' + name)
    } catch (error) {
      fail++
      failures.push({ name, error })
      console.log('  FAIL ' + name)
      console.log('       ' + String(error && error.message).split('\n')[0])
    }
  })()
}

console.log('== qoder cli channel (plan A) ==')

/**
 * A fake child that emits only AFTER the caller subscribes.
 *
 * A plain `queueMicrotask(() => setTimeout(...))` can fire `close` before
 * `runCliPiped` attaches its listeners; the missed event then surfaces as a
 * spurious 120s timeout instead of the failure under test. Arming on the first
 * `close` subscription removes that race without changing what is asserted.
 *
 * @param {() => void} emit  Called once a `close` listener exists.
 */
function armedChild(emit) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  child.removeAllListeners = () => {}
  child.on('newListener', function arm(event) {
    if (event !== 'close') return
    child.removeListener('newListener', arm)
    setImmediate(emit)
  })
  return child
}

/**
 * A REAL executable, used wherever a test needs `QODER_CLI_PATH` to resolve.
 *
 * It must exist: an explicit override that points at a missing file is rejected
 * as `missing-cli-path` before any of the prompt/run logic is reached, which is
 * deliberate (see resolveCli) and would silently skip those tests. `spawnImpl`
 * is injected everywhere, so the program is never actually executed.
 */
const REAL_CLI_PATH = process.platform === 'win32'
  ? String.raw`C:\Windows\System32\cmd.exe`
  : '/bin/sh'

let mod = null
let models = null
try {
  mod = await import('../lib/qoder/cli-fallback.js')
  models = await import('../lib/qoder/models.js')
} catch (e) {
  console.log(`  FAIL import :: ${e.message}`)
  fail++
  failures.push({ name: 'import', error: e })
}

if (mod && models) {
  const {
    CLI_FALLBACK_MODELS,
    CLI_FAILURE_REASONS,
    isFallbackModel,
    resolveCliPath,
    runCliCompletion,
    cliFallbackSse,
    probeCliChannel,
    CLI_CANDIDATE_PATHS,
  } = mod

  // ---- 1. proprietary model set -----------------------------------------
  // Measured against the live REST gateway (api2-v2.qoder.sh
  // /model/v1/chat/completions): qmodel_38max / qmodel_38flash / qfmodel /
  // smodel / cmodel answer 400 invalid_model_error, while qmodel/kmodel/gmodel/
  // dmodel/mmodel/auto/ultimate/performance answer 200. Those rejected keys are
  // exactly what the CLI channel must serve.
  await testAsync('CLI_FALLBACK_MODELS: carries qmodel_38max and qfmodel', () => {
    assert.ok(CLI_FALLBACK_MODELS.has('qmodel_38max'), 'Qwen3.8-Max must be CLI-served')
    assert.ok(CLI_FALLBACK_MODELS.has('qfmodel'), 'Qwen3.8-Flash must be CLI-served')
  })

  await testAsync('CLI_FALLBACK_MODELS: covers every documented REST-rejected key', () => {
    // The rejection list is the contract: a key the gateway rejects but which
    // the CLI can serve must be reachable, or the model is offered nowhere.
    for (const key of ['qmodel_38max', 'qmodel_38flash', 'qfmodel', 'smodel', 'cmodel']) {
      assert.ok(CLI_FALLBACK_MODELS.has(key), `${key} is REST-rejected and must be CLI-served`)
    }
  })

  await testAsync('CLI_FALLBACK_MODELS: does NOT claim gateway-working keys', () => {
    // Over-claiming would route a healthy REST model through a subprocess.
    for (const key of ['auto', 'qmodel', 'kmodel', 'gmodel', 'dmodel', 'mmodel']) {
      assert.ok(!CLI_FALLBACK_MODELS.has(key), `${key} works over REST and must not be CLI-only`)
    }
  })

  await testAsync('isFallbackModel: true for proprietary, false for others/null', () => {
    assert.equal(isFallbackModel('qmodel_38max'), true)
    assert.equal(isFallbackModel('qfmodel'), true)
    assert.equal(isFallbackModel('auto'), false)
    assert.equal(isFallbackModel(null), false)
    assert.equal(isFallbackModel(undefined), false)
  })

  await testAsync('isFallbackModel: rejects inherited Object.prototype keys', () => {
    // A Set-based membership test must not answer true for 'constructor'.
    assert.equal(isFallbackModel('constructor'), false)
    assert.equal(isFallbackModel('toString'), false)
  })

  // ---- 2. models.js consults the shared source of truth ------------------
  await testAsync('models.js: rejected keys split correctly into CLI-served vs genuinely degraded', () => {
    // Two different facts, two different lists. A key the gateway refuses AND
    // no channel serves must stay degraded; a key with a working CLI channel
    // must be advertised as usable. Conflating them either hides a working
    // model or advertises a dead one.
    const cliServed = new Set(models.CLI_ONLY_QODER_KEYS)
    for (const key of ['qmodel_38max', 'qmodel_38flash', 'qfmodel', 'smodel', 'cmodel']) {
      assert.ok(cliServed.has(key), `${key} is REST-rejected and CLI-served`)
    }
    // These four were rejected by the gateway and never observed working
    // through the CLI, so they must NOT be claimed as served.
    for (const key of ['dfmodel', 'gfmodel', 'kmodel_latest', 'qmodel_latest']) {
      assert.ok(!cliServed.has(key), `${key} has no verified channel and must stay degraded`)
      assert.ok(models.REJECTED_QODER_KEYS.includes(key), `${key} must stay on the rejected list`)
    }
    for (const key of models.CLI_ONLY_QODER_KEYS) {
      assert.ok(models.REJECTED_QODER_KEYS.includes(key), `${key} must also be on the rejected list`)
      assert.ok(CLI_FALLBACK_MODELS.has(key), `${key} must be in the CLI set`)
    }
  })

  await testAsync('models.js: buildCatalog marks proprietary keys cliFallback, not degraded', async () => {
    // The catalog must present a CLI-served key as usable. A `degraded` note
    // here would wrongly tell the user the model cannot answer.
    const entries = await models.buildCatalog({
      configHome: '/definitely/not/a/real/qoder/home',
      gateCache: { measuredAt: '2026-01-01T00:00:00.000Z', results: { qmodel_38max: 'rejected' } },
    })
    const max = entries.find((e) => e.id === 'qmodel_38max')
    assert.ok(max, 'qmodel_38max must be present in the catalog')
    assert.equal(max.cliFallback, true, 'qmodel_38max must carry cliFallback')
    assert.equal(max.degraded, undefined, 'a CLI-served key must not be marked degraded')
  })

  // ---- 3. eligibility ----------------------------------------------------
  await testAsync('isCliFallbackEligible: proprietary keys eligible on all measured failure shapes', () => {
    const { isCliFallbackEligible } = mod
    for (const key of ['qmodel_38max', 'qfmodel']) {
      assert.equal(isCliFallbackEligible(key, { kind: 'http_error', status: 400, message: 'invalid_model_error' }), true, key)
      assert.equal(isCliFallbackEligible(key, { kind: 'http_error', status: 200, message: 'qoder reported an in-band error' }), true, key)
      assert.equal(isCliFallbackEligible(key, { kind: 'server_error', status: 502, message: 'All backends failed' }), true, key)
    }
  })

  // ---- 4. fail-closed with machine-readable reasons ----------------------
  await testAsync('CLI_FAILURE_REASONS: is a frozen set of stable reason codes', () => {
    assert.ok(CLI_FAILURE_REASONS instanceof Set, 'must be a Set')
    assert.ok(Object.isFrozen(CLI_FAILURE_REASONS), 'must be frozen so callers cannot mutate it')
    for (const code of ['cli-not-found', 'missing-cli-path', 'no-prompt', 'spawn-unavailable', 'nonzero-exit', 'empty-output', 'killed', 'timeout', 'aborted']) {
      assert.ok(CLI_FAILURE_REASONS.has(code), `reason code ${code} must exist`)
    }
  })

  await testAsync('cliFallbackSse: QODER_CLI_PATH pointing at a missing file is missing-cli-path, no silent substitute', async () => {
    const bogus = process.platform === 'win32' ? 'Z:\\__no_such_dir__\\nope.exe' : '/dev/null/nope'
    const result = await cliFallbackSse({
      body: { model: 'qmodel_38max', messages: [{ role: 'user', content: 'hi' }] },
      failure: { kind: 'http_error', status: 400, message: 'original REST error body' },
      env: { QODER_CLI_PATH: bogus },
      spawnImpl: () => { throw new Error('must never be called') },
    })
    assert.equal(result.ok, false, 'must not report success')
    assert.equal(result.attempted, false)
    assert.equal(result.reason, 'missing-cli-path', `expected missing-cli-path, got ${result.reason}`)
    assert.ok(result.message.length > 0, 'must carry a human explanation')
  })

  await testAsync('cliFallbackSse: absent CLI is cli-not-found and never spawns', async () => {
    const result = await cliFallbackSse({
      body: { model: 'qfmodel', messages: [{ role: 'user', content: 'hi' }] },
      failure: { kind: 'http_error', status: 400, message: 'invalid_model_error' },
      env: {}, // no override: probe finds nothing on a machine without the CLI
      spawnImpl: () => { throw new Error('must never be called') },
    })
    if (resolveCliPath({ env: {} }) === null) {
      assert.equal(result.ok, false)
      assert.equal(result.attempted, false)
      assert.equal(result.reason, 'cli-not-found')
    } else {
      // A real install exists here; the honest assertion is that resolution
      // succeeded rather than that the negative branch fired.
      assert.equal(typeof resolveCliPath({ env: {} }), 'string')
    }
  })

  await testAsync('cliFallbackSse: empty prompt is no-prompt, not a spawn', async () => {
    const result = await cliFallbackSse({
      body: { model: 'qmodel_38max', messages: [{ role: 'assistant', content: 'x' }] },
      failure: { kind: 'http_error', status: 400, message: 'invalid_model_error' },
      // A REAL path: an explicit override that does not exist is (correctly)
      // rejected earlier as missing-cli-path, so a fake path would not reach
      // the prompt check this test targets.
      env: { QODER_CLI_PATH: REAL_CLI_PATH },
      spawnImpl: () => { throw new Error('must never be called') },
    })
    assert.equal(result.ok, false)
    assert.equal(result.attempted, false)
    assert.equal(result.reason, 'no-prompt')
  })

  await testAsync('cliFallbackSse: nonzero CLI exit is nonzero-exit, never an answer', async () => {
    const child = armedChild(() => {
      child.stderr.emit('data', Buffer.from('boom'))
      child.emit('close', 2)
    })
    const result = await cliFallbackSse({
      body: { model: 'qmodel_38max', messages: [{ role: 'user', content: 'hi' }] },
      failure: { kind: 'http_error', status: 400, message: 'invalid_model_error' },
      env: { QODER_CLI_PATH: REAL_CLI_PATH },
      spawnImpl: () => child,
    })
    assert.equal(result.ok, false, 'a nonzero exit must never be reported as success')
    assert.equal(result.attempted, true)
    assert.equal(result.reason, 'nonzero-exit')
    assert.ok(result.message.includes('2'), `exit code must survive: ${result.message}`)
  })

  await testAsync('cliFallbackSse: exit 0 with empty stdout is empty-output, never a blank success', async () => {
    const child = armedChild(() => child.emit('close', 0))
    const result = await cliFallbackSse({
      body: { model: 'qmodel_38max', messages: [{ role: 'user', content: 'hi' }] },
      failure: { kind: 'http_error', status: 400, message: 'invalid_model_error' },
      env: { QODER_CLI_PATH: REAL_CLI_PATH },
      spawnImpl: () => child,
    })
    assert.equal(result.ok, false, 'empty output must never become an empty answer')
    assert.equal(result.reason, 'empty-output')
  })

  // ---- 5. the escalation ladder -----------------------------------------
  await testAsync('runCliCompletion: a killed child is reported as killed, not as exit 0', async () => {
    // Measured in this sandbox: every spawned child is assigned a real pid and
    // then terminated ~10-50ms later with code 3221225794 (0xC0000142,
    // STATUS_DLL_INIT_FAILED) while `signal` stays null. That must surface as an
    // explicit reason, never as a silent success and never as an empty answer.
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    child.removeAllListeners = () => {}
    // Arm the emitter only once the caller has subscribed: a bare
    // `queueMicrotask(() => setTimeout(...))` can fire `close` before
    // runCliPiped attaches its listener, and the missed event then surfaces as
    // a spurious 120s timeout instead of the kill we are testing for.
    child.on('newListener', function armed(event) {
      if (event !== 'close') return
      child.removeListener('newListener', armed)
      setImmediate(() => child.emit('close', 3221225794))
    })
    const result = await runCliCompletion({
      cliPath: 'C:/fake/qodercli.exe', model: 'qmodel_38max', prompt: 'p',
      spawnImpl: () => child,
    })
    assert.equal(result.ok, false, 'a sandbox kill must not read as success')
    assert.equal(result.reason, 'killed', `expected killed, got ${result.reason}`)
    // The kill must be NAMED so an operator can tell it apart from the CLI
    // failing on its own. 3221225794 renders as 0xC0000142; the assertion
    // carries both spellings so it cannot silently pass on a wrong constant.
    assert.ok(
      result.message.includes('0xC0000142') || result.message.includes('3221225794'),
      `kill must be named: ${result.message}`,
    )
  })

  await testAsync('runCliCompletion: EPERM escalates to the shell path, and its failure still carries a reason', async () => {
    // The piped shape throws EPERM under the sandbox; the shell-redirect shape is
    // then tried. Whether or not cmd.exe survives here, the contract is the same:
    // never throw, always resolve, always a reason code.
    const result = await runCliCompletion({
      cliPath: 'C:/fake/qodercli.exe', model: 'qmodel_38max', prompt: 'p',
      spawnImpl: () => { throw new Error('spawn EPERM') },
    })
    assert.equal(result.ok, false)
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'must carry a reason code')
    assert.ok(CLI_FAILURE_REASONS.has(result.reason), `reason ${result.reason} must be a known code`)
  })

  await testAsync('runCliCompletion: every failure path yields a known reason code', async () => {
    // Each case only has to prove the run TERMINATES with a known code; the
    // exact discrimination is asserted by the dedicated tests above.
    const cases = [
      { label: 'throw-EPERM', spawnImpl: () => { throw new Error('spawn EPERM') } },
      { label: 'error-event-EPERM', arm: (c) => c.emit('error', new Error('spawn EPERM')) },
      { label: 'exit2', arm: (c) => { c.stderr.emit('data', Buffer.from('x')); c.emit('close', 2) } },
      { label: 'exit0-empty', arm: (c) => c.emit('close', 0) },
      { label: 'killed', arm: (c) => c.emit('close', 3221225794) },
    ]
    for (const c of cases) {
      let child
      const spawnImpl = c.arm === undefined
        ? c.spawnImpl
        : () => {
            child = armedChild(() => c.arm(child))
            return child
          }
      const r = await runCliCompletion({ cliPath: 'C:/fake/qodercli.exe', model: 'qmodel_38max', prompt: 'p', spawnImpl })
      assert.equal(r.ok, false, `${c.label} must fail`)
      assert.ok(CLI_FAILURE_REASONS.has(r.reason), `${c.label} produced unknown reason ${r.reason}`)
    }
  })

  // ---- 6. candidate paths + live reachability ---------------------------
  await testAsync('CLI_CANDIDATE_PATHS: covers both real install locations', () => {
    const joined = CLI_CANDIDATE_PATHS.join('|').toLowerCase()
    assert.ok(joined.includes('qodercli'), 'must list qodercli executables')
    assert.ok(
      CLI_CANDIDATE_PATHS.some((p) => p.includes('QoderCLI')),
      `D:\\QoderCLI is a real install and must be probed; got ${joined}`,
    )
    assert.ok(
      CLI_CANDIDATE_PATHS.some((p) => p.includes('.qoder')),
      'the official install under .qoder must be probed',
    )
  })

  await testAsync('resolveCliPath: an explicit override that is missing does NOT fall through', () => {
    const bogus = process.platform === 'win32' ? 'Z:\\__no_such_dir__\\nope.exe' : '/dev/null/nope'
    // The operator named a binary; silently resolving to a different one would
    // make the CLI channel's reachability depend on an unrelated install.
    assert.equal(resolveCliPath({ env: { QODER_CLI_PATH: bogus } }), null)
  })

  await testAsync('probeCliChannel: reports machine-readable reachability evidence', async () => {
    const evidence = await probeCliChannel({ env: {} })
    assert.equal(typeof evidence, 'object')
    assert.ok('cliPath' in evidence, 'must report the resolved path (or null)')
    assert.ok('reachable' in evidence, 'must report whether the channel actually works')
    assert.equal(typeof evidence.reachable, 'boolean')
    assert.ok(typeof evidence.detail === 'string' && evidence.detail.length > 0, 'must carry a detail string')
    assert.ok('reason' in evidence, 'must carry a reason code when unreachable')
    if (evidence.cliPath === null) {
      assert.equal(evidence.reachable, false, 'no binary => not reachable')
      assert.equal(evidence.reason, 'cli-not-found')
    }
  })
} else {
  console.log('  SKIP all tests (import failed)')
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
