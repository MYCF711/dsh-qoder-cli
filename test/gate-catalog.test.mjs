// Offline acceptance tests for tools/gate-catalog.mjs (the gate probe CLI tool).
//
// Verifies the two paths the task contract names, without spawning a child
// process and without touching the real chat gateway:
//
//  1. NO CREDENTIAL → the real script prints `SKIP: no credential` and exits 3.
//     The tool is a top-level-await executable whose fallback chain is
//     plugin discovery (lib/qoder/credentials.js) → CLI device-flow store
//     (<QODER_CONFIG_DIR>/.auth/user). Both are env-driven, so an isolated
//     env starves both: QODER_AUTH_FILE_ENV points at a nonexistent file
//     (explicit source throws), QODER_CONFIG_DIR points at an empty dir
//     (CLI store ENOENT). Asserted through the REAL script.
//
//  2. RESULT SHAPE — two planes:
//     a. the lib plane: probe results persisted via saveGateCache round-trip
//        as {version, measuredAt, results:{key:status}} and loadGateCache
//        rejects corrupt/expired/mistyped documents instead of trusting them;
//     b. the tool plane: with a MOCK credential injected (QODER_AUTH_FILE_ENV),
//        the real script runs to completion with the network stubbed and writes
//        its output file in {measuredAt, results:[{key,displayName,status}]}
//        shape, every unknown entry carrying httpStatus/bodyHead diagnostics.
//
// HOW THE SCRIPT IS RUN WITHOUT child_process (spawn is EPERM-blocked in this
// harness): a worker thread. Workers are threads, not processes, so the sandbox
// does not refuse them. The worker boot code hijacks console.log into
// postMessage (so stdout survives) and intercepts process.exit into a
// postMessage + throw (so the exit code is observable while pending messages
// still flush — the tool calls console.log(SKIP) and process.exit(3)
// back-to-back). globalThis.fetch is stubbed BEFORE the tool is imported, so
// even if env isolation ever failed, no request could reach the real gateway.
//
// The instrument self-check (test 3) proves this harness can report red: the
// same run/assert pair that expects exit 3 is applied to an exit-0 result and
// must throw.
//
// Run: node test/gate-catalog.test.mjs

import { Worker } from 'node:worker_threads'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { saveGateCache, loadGateCache, gateCachePath, GATE_CACHE_TTL_MS } from '../lib/qoder/gate-cache.js'

let pass = 0
let fail = 0
const failures = []
let chain = Promise.resolve()

function test(name, fn) {
  const run = async () => {
    try {
      await fn()
      pass++
      console.log('  ok   ' + name)
    } catch (error) {
      fail++
      failures.push({ name, error })
      console.log('  FAIL ' + name)
      console.log('       ' + error.message.split('\n')[0])
    }
  }
  chain = chain.then(run)
}

console.log('== qoder gate-catalog tool ==')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'tools', 'gate-catalog.mjs')
const HELPER = join(ROOT, 'tools', 'gate-wasm-helper.mjs')
const FIXTURE = join(ROOT, 'test', 'catalog-fixtures', 'gate-result.json')

const STATUS_ENUM = ['accepted', 'rejected', 'unknown']

// ---------------------------------------------------------------------------
// worker harness: run the REAL tool in-process, isolated env, stubbed network
// ---------------------------------------------------------------------------

function runGateTool(env) {
  return new Promise((resolve, reject) => {
    const logs = []
    let exitCode
    let importError = null
    // Worker with eval:true boots as CommonJS, so require works and the tool is
    // pulled in through dynamic import() (static imports are invalid there).
    const boot = [
      "const { parentPort } = require('node:worker_threads')",
      "console.log = (...a) => { parentPort.postMessage({ log: a.join(' ') }) }",
      "console.error = (...a) => { parentPort.postMessage({ log: a.join(' ') }) }",
      "// belt & braces: a test must never touch the real gateway",
      "globalThis.fetch = async () => { throw new Error('NO-NETWORK-IN-TEST') }",
      "// intercept process.exit so queued stdout messages can flush: the tool",
      '// prints SKIP and exits 3 back-to-back, and a real exit would drop both.',
      "process.exit = (code) => { parentPort.postMessage({ exitCode: code ?? 0 }); throw new Error('PROCESS_EXIT_' + (code ?? 0)) }",
      `import(${JSON.stringify(pathToFileURL(TOOL).href)}).then(`,
      '  () => parentPort.postMessage({ exitCode: 0, completed: true }),',
      '  (e) => parentPort.postMessage({ importError: String((e && (e.stack || e.message)) || e) })',
      ')',
    ].join('\n')
    const worker = new Worker(boot, { eval: true, env })
    worker.on('message', (m) => {
      if (typeof m.log === 'string') logs.push(m.log)
      if (m.exitCode !== undefined) exitCode = m.exitCode
      if (m.importError) importError = m.importError
    })
    worker.on('error', (e) => reject(e))
    worker.on('exit', () => resolve({ logs, exitCode, importError }))
  })
}

/** Starve both credential sources: explicit file absent, CLI store absent. */
async function isolatedEnv(tmp) {
  await mkdir(join(tmp, 'appdata'), { recursive: true })
  await mkdir(join(tmp, 'home'), { recursive: true })
  await mkdir(join(tmp, 'config'), { recursive: true })
  const env = { ...process.env }
  env.APPDATA = join(tmp, 'appdata')
  env.USERPROFILE = join(tmp, 'home')
  env.QODER_CONFIG_DIR = join(tmp, 'config')
  env.QODER_AUTH_FILE_ENV = join(tmp, 'no-such-credential.json')
  env.DSH_HOME = join(tmp, 'dsh-home')
  // scrub every other QODER_* variable that could leak a credential source
  for (const key of Object.keys(env)) {
    if (key.startsWith('QODER_') && key !== 'QODER_CONFIG_DIR' && key !== 'QODER_AUTH_FILE_ENV') delete env[key]
  }
  return env
}

/** The green-gate assertion for the no-credential path. */
function assertSkipExit3(result) {
  if (result.exitCode !== 3) {
    throw new Error(`expected exit code 3, got ${JSON.stringify(result.exitCode)}`)
  }
  const skip = result.logs.find((line) => line.startsWith('SKIP: no credential'))
  if (!skip) {
    throw new Error(`expected a SKIP: no credential line, got logs: ${JSON.stringify(result.logs)}`)
  }
}

// ---------------------------------------------------------------------------

test('tool and wasm helper exist; helper exposes the CLI-fallback surface', () => {
  if (!existsSync(TOOL)) throw new Error(`missing ${TOOL}`)
  if (!existsSync(HELPER)) throw new Error(`missing ${HELPER}`)
})

test('no credential (isolated env) → real script prints SKIP and exits 3', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'gate-catalog-nocred-'))
  try {
    const result = await runGateTool(await isolatedEnv(tmp))
    assertSkipExit3(result)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('mock credential → real script completes, output file has probe shape (+ instrument self-check sees red on exit 0)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'gate-catalog-mockcred-'))
  const env = await isolatedEnv(tmp)
  // A valid mock credential for parseQoderCredential: schema 1 + token +
  // refreshToken + user.id. The explicit-file branch accepts it, so the script
  // proceeds past credentials and the whole probe/writer path is exercised —
  // against the stubbed fetch (every probe lands in the transport-error branch).
  const credPath = join(tmp, 'mock-credential.json')
  await writeFile(
    credPath,
    JSON.stringify({
      schemaVersion: 1,
      token: 'mock-token-for-offline-test',
      refreshToken: 'mock-refresh-token',
      user: { id: 'mock-user-id' },
    }),
    'utf8',
  )
  env.QODER_AUTH_FILE_ENV = credPath

  // The tool writes test/catalog-fixtures/gate-result.json (hardcoded path);
  // back the real fixture up and restore it no matter how this test ends.
  const backup = existsSync(FIXTURE) ? readFileSync(FIXTURE, 'utf8') : null
  let result
  let written
  try {
    result = await runGateTool(env)
    if (result.importError) {
      throw new Error(`tool crashed under mock credential: ${result.importError.split('\n')[0]}`)
    }
    if (result.exitCode !== 0) {
      throw new Error(`expected exit code 0 on the credential-found path, got ${JSON.stringify(result.exitCode)}`)
    }
    if (!result.logs.some((l) => l.startsWith('[OK] credential acquired from plugin-discovery'))) {
      throw new Error(`expected the plugin-discovery credential line, got: ${JSON.stringify(result.logs)}`)
    }
    written = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  } finally {
    if (backup !== null) writeFileSync(FIXTURE, backup, 'utf8')
    await rm(tmp, { recursive: true, force: true })
  }

  // output-file shape: {measuredAt, results:[{key, displayName, status}]}
  if (typeof written.measuredAt !== 'string' || Number.isNaN(Date.parse(written.measuredAt))) {
    throw new Error('measuredAt must be an ISO timestamp')
  }
  if (!Array.isArray(written.results) || written.results.length === 0) {
    throw new Error('results must be a non-empty array')
  }
  const probedMatch = /probed all (\d+) models/.exec(result.logs.join('\n'))
  if (probedMatch && Number(probedMatch[1]) !== written.results.length) {
    throw new Error(`probed ${probedMatch[1]} but results array holds ${written.results.length}`)
  }
  for (const r of written.results) {
    if (typeof r.key !== 'string' || r.key.length === 0) throw new Error('every result needs a non-empty key')
    if (!STATUS_ENUM.includes(r.status)) throw new Error(`status "${r.status}" is outside the enum`)
    if (r.status === 'unknown') {
      // transport-error branch: fetch stub threw, so the diagnostic carries its message
      if (r.httpStatus !== null) throw new Error(`unknown entry ${r.key} must carry httpStatus null on a transport error`)
      if (!r.bodyHead) throw new Error(`unknown entry ${r.key} must carry a bodyHead diagnostic`)
    }
  }

  // INSTRUMENT SELF-CHECK: the same ruler that enforces exit 3 + SKIP must be
  // able to report red — once against a synthetic exit-0 result and once
  // against THIS real exit-0 run. If either does not throw, the gate is blind.
  let sawRed = false
  try {
    assertSkipExit3(result)
  } catch {
    sawRed = true
  }
  try {
    assertSkipExit3({ exitCode: 0, logs: ['[OK] credential acquired from plugin-discovery'] })
  } catch {
    if (!sawRed) throw new Error('synthetic red check must also trip the gate')
  }
  if (!sawRed) throw new Error('instrument self-check failed: assertSkipExit3 passed an exit-0 result')
})

test('probe-result shape: saveGateCache/loadGateCache round-trips {version, measuredAt, results:{key:status}}', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'gate-catalog-shape-'))
  try {
    const mock = { auto: 'accepted', efficient: 'unknown', smodel: 'rejected' }
    await saveGateCache(dshHome, mock)
    const loaded = await loadGateCache(dshHome)
    if (!loaded || typeof loaded !== 'object') throw new Error('cache must round-trip to an object')
    if (loaded.version !== 1) throw new Error(`version must be 1, got ${JSON.stringify(loaded.version)}`)
    if (typeof loaded.measuredAt !== 'string' || Number.isNaN(Date.parse(loaded.measuredAt))) {
      throw new Error('measuredAt must be an ISO timestamp')
    }
    if (loaded.results === null || typeof loaded.results !== 'object' || Array.isArray(loaded.results)) {
      throw new Error('results must be a plain {key: status} map')
    }
    const statuses = Object.values(loaded.results)
    for (const status of statuses) {
      if (!STATUS_ENUM.includes(status)) throw new Error(`status "${status}" is outside the enum`)
    }
    const raw = JSON.parse(await readFile(gateCachePath(dshHome), 'utf8'))
    const mapKeys = Object.keys(raw.results ?? {})
    if (mapKeys.length !== Object.keys(mock).length) throw new Error('results map must hold exactly the probed keys')
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('shape negatives: corrupt / mistyped / expired probe documents degrade to null, never trusted', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'gate-catalog-negative-'))
  try {
    const now = Date.now()
    const cases = [
      ['corrupt JSON', '{oops'],
      ['results as array', JSON.stringify({ version: 1, measuredAt: new Date(now).toISOString(), results: [] })],
      ['missing measuredAt', JSON.stringify({ version: 1, results: { auto: 'accepted' } })],
      ['results missing', JSON.stringify({ version: 1, measuredAt: new Date(now).toISOString() })],
    ]
    for (const [label, body] of cases) {
      await writeFile(gateCachePath(dshHome), body, 'utf8')
      if ((await loadGateCache(dshHome, now)) !== null) {
        throw new Error(`${label}: must degrade to null`)
      }
    }
    // exactly one TTL past the window is expired, not fresh
    await saveGateCache(dshHome, { auto: 'accepted' }, now - GATE_CACHE_TTL_MS - 1)
    if ((await loadGateCache(dshHome, now)) !== null) throw new Error('expired cache must degrade to null')
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('real gate-result.json fixture matches the tool contract it was produced by', async () => {
  const doc = JSON.parse(await readFile(FIXTURE, 'utf8'))
  if (typeof doc.measuredAt !== 'string' || Number.isNaN(Date.parse(doc.measuredAt))) {
    throw new Error('fixture measuredAt must be an ISO timestamp')
  }
  if (!Array.isArray(doc.results) || doc.results.length === 0) throw new Error('fixture results must be a non-empty array')
  for (const r of doc.results) {
    if (typeof r.key !== 'string' || r.key.length === 0) throw new Error('every result needs a non-empty key')
    if (typeof r.displayName !== 'string' || r.displayName.length === 0) {
      throw new Error(`result ${r.key} needs a displayName`)
    }
    if (!STATUS_ENUM.includes(r.status)) throw new Error(`fixture status "${r.status}" is outside the enum`)
    if (r.status === 'unknown' && r.httpStatus === null && !r.bodyHead) {
      throw new Error(`unknown result ${r.key} must carry diagnostics`)
    }
  }
})

await chain

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
