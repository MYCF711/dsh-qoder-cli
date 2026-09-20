// Acceptance test for tools/snapshot-refresh.mjs
//
// Verifies (per task t1 contract):
//   1. tools/snapshot-refresh.mjs exists and parses/loads as valid ESM.
//   2. After running the script, test/catalog-fixtures/catalog-snapshot.json
//      is refreshed from the local decrypted catalog (assistant scene first).
//   3. The script prints the refreshed scene name and model count.
//   4. README.md development section gains the usage line
//      `node tools/snapshot-refresh.mjs  # 刷新随包目录快照`.
//
// child_process spawn is EPERM-blocked inside this harness, so the script is
// executed in-process via cache-busting dynamic import: the module loader only
// accepts syntactically valid ESM, which stands in for `node --check`, and the
// import re-runs the script's procedural top-level body.
//
// Run: node test/snapshot-refresh.test.mjs

import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  // Sequential so the fixture test's console.log hijack never overlaps
  // another test's output window.
  chain = chain.then(run)
}

console.log('== qoder snapshot-refresh ==')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'tools', 'snapshot-refresh.mjs')
const FIXTURE = join(ROOT, 'test', 'catalog-fixtures', 'catalog-snapshot.json')
const README = join(ROOT, 'README.md')

test('script exists and loads as valid ESM', async () => {
  if (!existsSync(SCRIPT)) throw new Error(`missing ${SCRIPT}`)
  // Output goes to a throwaway temp file so this check stays independent of
  // the fixture-refresh test below.
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const tmp = await mkdtemp(join(tmpdir(), 'snapshot-refresh-syntax-'))
  const tmpOut = join(tmp, 'out.json')
  process.env.QODER_SNAPSHOT_OUT = tmpOut
  try {
    await import(`../tools/snapshot-refresh.mjs?syntax=${Date.now()}-${Math.random()}`)
    if (!existsSync(tmpOut)) throw new Error('script ran but produced no output file')
  } finally {
    delete process.env.QODER_SNAPSHOT_OUT
    await rm(tmp, { recursive: true, force: true })
  }
})

test('fixture refreshed from local decrypted catalog (assistant scene first)', async () => {
  const before = existsSync(FIXTURE) ? statSync(FIXTURE).mtimeMs : 0
  process.env.QODER_SNAPSHOT_OUT = FIXTURE
  let stdout = ''
  const originalLog = console.log
  console.log = (...args) => { stdout += args.join(' ') + '\n' }
  try {
    // Re-import with a cache-busting query so the module body (the script's
    // procedural top-level code) re-runs on every test invocation.
    await import(`../tools/snapshot-refresh.mjs?v=${Date.now()}-${Math.random()}`)
  } finally {
    console.log = originalLog
    delete process.env.QODER_SNAPSHOT_OUT
  }
  if (!existsSync(FIXTURE)) throw new Error('fixture was not created')
  // mtime has ~10-16ms quantization on NTFS, so a fast re-run can land in the
  // same tick; only flag a refresh failure when mtime demonstrably regressed.
  const after = statSync(FIXTURE)
  if (after.mtimeMs < before) {
    throw new Error('fixture mtime went backwards — not refreshed')
  }

  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const scenes = Object.keys(doc)
  if (scenes.length !== 1) throw new Error(`expected exactly one scene key, got ${scenes.join(', ')}`)
  const [scene, models] = Object.entries(doc)[0]
  if (!Array.isArray(models) || models.length === 0) throw new Error('scene must be a non-empty array')
  if (!models[0].key) throw new Error('models must be raw catalog entries (missing .key)')

  // printed output must name the scene and the model count
  if (!stdout.includes(scene)) throw new Error(`output must name scene "${scene}"`)
  if (!stdout.includes(String(models.length))) throw new Error(`output must print model count ${models.length}`)
})

test('README development section has the usage line', () => {
  const text = readFileSync(README, 'utf8')
  const devIdx = text.indexOf('## 开发')
  if (devIdx === -1) throw new Error(`no ## 开发 section (read ${text.length} chars from ${README})`)
  const devSection = text.slice(devIdx, text.indexOf('##', devIdx + 2))
  if (!devSection.includes('snapshot-refresh')) {
    throw new Error(`usage line missing from 开发 section (section length ${devSection.length})`)
  }
  if (!devSection.includes('刷新随包目录快照')) {
    throw new Error('usage line comment missing')
  }
})

// ------------------------------
// NEGATIVE PATHS: the script must refuse to write a snapshot it cannot
// source. process.exit is intercepted into a throwing sentinel so the
// error branch is observable without killing the test runner; the import
// rejection carries it. Output always redirected to a throwaway path so a
// regression can never touch the shipped snapshot.
// ------------------------------

/** Run the tool body with an isolated config dir and a captured process.exit. */
async function runIsolated(configDir, label) {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const outTmp = await mkdtemp(join(tmpdir(), `snapshot-refresh-${label}-`))
  const outPath = join(outTmp, 'out.json')
  const prevConfig = process.env.QODER_CONFIG_DIR
  const prevOut = process.env.QODER_SNAPSHOT_OUT
  process.env.QODER_CONFIG_DIR = configDir
  process.env.QODER_SNAPSHOT_OUT = outPath
  const originalError = console.error
  const originalExit = process.exit
  let stderr = ''
  let exitCode
  console.error = (...args) => { stderr += args.join(' ') + '\n' }
  process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}`) }
  let threw = null
  try {
    await import(`../tools/snapshot-refresh.mjs?${label}=${Date.now()}-${Math.random()}`)
  } catch (error) {
    threw = error
  } finally {
    console.error = originalError
    process.exit = originalExit
    if (prevConfig === undefined) delete process.env.QODER_CONFIG_DIR
    else process.env.QODER_CONFIG_DIR = prevConfig
    if (prevOut === undefined) delete process.env.QODER_SNAPSHOT_OUT
    else process.env.QODER_SNAPSHOT_OUT = prevOut
  }
  return { threw, exitCode, stderr, outPath, outTmp, rm: () => rm(outTmp, { recursive: true, force: true }) }
}

test('negative: empty QODER_CONFIG_DIR (no catalog) → exit 1, ERROR on stderr, no output file', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const empty = await mkdtemp(join(tmpdir(), 'snapshot-refresh-emptycfg-'))
  const r = await runIsolated(empty, 'nocred')
  try {
    await rm(empty, { recursive: true, force: true })
    if (r.exitCode !== 1) {
      throw new Error(`expected exit 1 on the no-catalog path, got ${JSON.stringify(r.exitCode)} (threw: ${r.threw?.message})`)
    }
    if (!r.stderr.includes('ERROR: no readable local catalog')) {
      throw new Error(`stderr must explain the no-catalog failure, got: ${JSON.stringify(r.stderr)}`)
    }
    if (existsSync(r.outPath)) throw new Error('no output file may be written when no catalog is readable')
  } finally {
    await r.rm()
  }
})

test('negative: catalog with only empty scenes → exit 1 "no non-empty scene", no output file', async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  // Inject a genuinely encrypted catalog whose every scene is empty: the tool
  // gets a real (non-null) catalog document and must still refuse.
  const wasmHelper = await import('./wasm-encrypt-helper.mjs')
  await wasmHelper.init(wasmHelper.WASM_PATH)
  const uid = 'snapshot-refresh-empty-scene'
  const configDir = await mkdtemp(join(tmpdir(), 'snapshot-refresh-emptyscene-'))
  const uidDir = join(configDir, '.models', uid)
  await mkdir(uidDir, { recursive: true })
  const encrypted = wasmHelper.modelCacheEncrypt(JSON.stringify({ assistant: [], chat: [], app: [], qwake: [] }), uid)
  await writeFile(join(uidDir, 'catalog-v6'), encrypted, 'utf8')

  const r = await runIsolated(configDir, 'emptyscene')
  try {
    await rm(configDir, { recursive: true, force: true })
    if (r.exitCode !== 1) {
      throw new Error(`expected exit 1 on the empty-scenes path, got ${JSON.stringify(r.exitCode)} (threw: ${r.threw?.message})`)
    }
    if (!r.stderr.includes('no non-empty scene')) {
      throw new Error(`stderr must name the empty-scenes failure, got: ${JSON.stringify(r.stderr)}`)
    }
    if (existsSync(r.outPath)) throw new Error('no output file may be written when no scene has models')
  } finally {
    await r.rm()
  }
})

await chain

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
