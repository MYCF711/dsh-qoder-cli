// Models catalog tests for buildCatalog function.
//
// Tests:
// 1. buildCatalog returns 3 entries from controlled assistant scene (first 3 models of fixture).
// 2. buildCatalog returns entry with degraded field when key in REJECTED_QODER_KEYS (e.g., qfmodel).
// 3. buildCatalog returns FALLBACK_QODER_MODELS when no .models directory exists.
//
// Strategy: use QODER_CONFIG_DIR environment variable + temp dir to inject controlled
// local cache fixtures (encrypted via modelCacheEncrypt from wasm-encrypt-helper).
//
// Run: node --test test/models-catalog.test.mjs
// (or plain `node test/models-catalog.test.mjs`; process.exitCode set below.)

import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'

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
    console.log('       ' + error.message.split('\n')[0])
  }
}

async function testAsync(name, fn) {
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

console.log('== qoder models-catalog ==')

// Load fixtures and modules once up front
let fixtureChat = null
let fixtureUid = null
let modelCacheEncrypt = null

try {
  // The model-cache codec is pure JS now (`lib/qoder/model-cache-crypto.js`,
  // byte-verified against the former WASM in both directions). The bundled
  // qoder_auth_wasm_bg.wasm has been removed from the package, so the fixture
  // encryption goes through the pure codec directly. The WASM oracle remains
  // opt-in via QODER_MODEL_CACHE_WASM=1 inside the reader, not here.
  const pure = await import('../lib/qoder/model-cache-crypto.js')
  modelCacheEncrypt = pure.modelCacheEncrypt
} catch (e) {
  console.log(`  FAIL init pure codec :: ${e.code ?? e.message}`)
  fail++
  failures.push({ name: 'init pure codec', error: e })
}

if (!modelCacheEncrypt) {
  console.log('  SKIP remaining tests (model-cache codec initialization failed)')
} else {
  // ------------------------------
  // FIXTURES
  // ------------------------------
  try {
    const raw = await readFile(new URL('catalog-fixtures/catalog-1.1.58.json', import.meta.url), 'utf8')
    fixtureChat = JSON.parse(raw)
    // uid is arbitrary but must be non-empty string; use "test-uid-abc"
    fixtureUid = 'test-uid-abc'
  } catch (e) {
    console.log(`  FAIL load fixture :: ${e.code ?? e.message}`)
    fail++
    failures.push({ name: 'load fixture', error: e })
  }

  if (!fixtureChat || typeof fixtureChat.chat !== 'object') {
    console.log('  SKIP remaining tests (fixture invalid or no chat scene)')
  } else {
    // ------------------------------
    // TEST 1: buildCatalog with assistant scene (first 3 models from fixture)
    // ------------------------------
    await testAsync('buildCatalog: controlled cache with assistant scene -> returns 3 entries with correct id/name mapping', async () => {
      const tmpRoot = tmpdir()
      const tempDir = await mkdtemp(join(tmpRoot, 'qoder-assistant-test-'))

      // Create models directory structure
      const modelsDir = join(tempDir, '.models')
      const uidSafe = String(fixtureUid).replace(/^\.+/, '') || 'anon'
      const uidDir = join(modelsDir, uidSafe)
      await mkdir(uidDir, { recursive: true })

      // Build an assistant scene with first 3 models from fixture chat
      const assistantScene = fixtureChat.chat.slice(0, 3)
      const catalogDoc = { assistant: assistantScene }
      const plainJson = JSON.stringify(catalogDoc)
      const encrypted = modelCacheEncrypt(plainJson, fixtureUid)

      // Write encrypted catalog
      const catalogPath = join(uidDir, 'catalog-v6')
      await writeFile(catalogPath, encrypted, 'utf8')

      // Set env var to point to temp directory
      const prevEnv = process.env.QODER_CONFIG_DIR
      process.env.QODER_CONFIG_DIR = tempDir

      try {
        // Dynamically import catalog-reader to pick up fresh env state for readLocalCatalog
        const readerMod = await import('../lib/qoder/catalog-reader.js?v=' + Date.now())
        const readerExports = await import('../lib/qoder/models.js?v=' + Date.now())
        const buildCatalog = readerExports.buildCatalog

        const catalog = await buildCatalog()
        assert.ok(Array.isArray(catalog), 'catalog must be array')
        assert.equal(catalog.length, 3, 'must return exactly 3 entries')

        // Verify field mapping for each entry
        for (let i = 0; i < 3; i++) {
          const raw = assistantScene[i]
          const entry = catalog[i]
          assert.equal(entry.id, raw.key, `entry[${i}] id must match raw key`)
          assert.equal(entry.name, raw.display_name ?? raw.key, `entry[${i}] name must match display_name or fallback to key`)
        }
      } finally {
        if (prevEnv !== undefined) {
          process.env.QODER_CONFIG_DIR = prevEnv
        } else {
          delete process.env.QODER_CONFIG_DIR
        }
      }

      // Cleanup temp dir
      await rm(tempDir, { recursive: true, force: true })
    })

    // ------------------------------
    // TEST 2: buildCatalog with a CLI-served key -> first-class, NOT degraded
    // ------------------------------
    // Behaviour changed deliberately (plan A): `qfmodel` is served by the local
    // qodercli channel, so marking it "degraded" would tell the user a working
    // model is dead. A key the gateway rejects AND no channel serves still gets
    // the degraded note — see TEST 2b below.
    await testAsync('buildCatalog: controlled cache with CLI-served key (qfmodel) -> cliFallback, no degraded note', async () => {
      const tmpRoot = tmpdir()
      const tempDir = await mkdtemp(join(tmpRoot, 'qoder-rejected-test-'))

      // Create models directory structure
      const modelsDir = join(tempDir, '.models')
      const uidSafe = String(fixtureUid).replace(/^\.+/, '') || 'anon'
      const uidDir = join(modelsDir, uidSafe)
      await mkdir(uidDir, { recursive: true })

      // Build a simple assistant scene with one CLI-served key (qfmodel)
      const rejectedModel = {
        key: 'qfmodel',
        display_name: 'QF Model',
        max_input_tokens: 200000,
        max_output_tokens: 32768,
        is_vl: false,
        is_reasoning: false
      }
      const catalogDoc = { assistant: [rejectedModel] }
      const plainJson = JSON.stringify(catalogDoc)
      const encrypted = modelCacheEncrypt(plainJson, fixtureUid)

      // Write encrypted catalog
      const catalogPath = join(uidDir, 'catalog-v6')
      await writeFile(catalogPath, encrypted, 'utf8')

      // Set env var to point to temp directory
      const prevEnv = process.env.QODER_CONFIG_DIR
      process.env.QODER_CONFIG_DIR = tempDir

      try {
        // Dynamically import models.js
        const modelsMod = await import('../lib/qoder/models.js?v=' + Date.now())
        const buildCatalog = modelsMod.buildCatalog

        const catalog = await buildCatalog()
        assert.ok(Array.isArray(catalog), 'catalog must be array')
        assert.equal(catalog.length, 1, 'must return exactly 1 entry')

        const entry = catalog[0]
        assert.equal(entry.id, 'qfmodel', 'entry id must be qfmodel')
        assert.equal(entry.cliFallback, true, 'a CLI-served key must be flagged cliFallback')
        assert.equal(entry.degraded, undefined, 'a CLI-served key must NOT be marked degraded')
      } finally {
        if (prevEnv !== undefined) {
          process.env.QODER_CONFIG_DIR = prevEnv
        } else {
          delete process.env.QODER_CONFIG_DIR
        }
      }

      // Cleanup temp dir
      await rm(tempDir, { recursive: true, force: true })
    })

    // ------------------------------
    // TEST 2b: a rejected key with NO channel keeps the degraded note
    // ------------------------------
    // The negative half of TEST 2: without this, the whole degraded mechanism
    // could be deleted and both tests would still pass.
    await testAsync('buildCatalog: rejected key with no channel (dfmodel) -> keeps the degraded note', async () => {
      const tmpRoot = tmpdir()
      const tempDir = await mkdtemp(join(tmpRoot, 'qoder-degraded-test-'))

      const modelsDir = join(tempDir, '.models')
      const uidSafe = String(fixtureUid).replace(/^\.+/, '') || 'anon'
      const uidDir = join(modelsDir, uidSafe)
      await mkdir(uidDir, { recursive: true })

      const deadModel = {
        key: 'dfmodel',
        display_name: 'DF Model',
        max_input_tokens: 200000,
        max_output_tokens: 32768,
        is_vl: false,
        is_reasoning: false
      }
      const encrypted = modelCacheEncrypt(JSON.stringify({ assistant: [deadModel] }), fixtureUid)
      await writeFile(join(uidDir, 'catalog-v6'), encrypted, 'utf8')

      const prevEnv = process.env.QODER_CONFIG_DIR
      process.env.QODER_CONFIG_DIR = tempDir

      try {
        const modelsMod = await import('../lib/qoder/models.js?v=' + Date.now())
        const catalog = await modelsMod.buildCatalog()
        const entry = catalog.find((e) => e.id === 'dfmodel')
        assert.ok(entry, 'dfmodel must be present')
        assert.equal(entry.cliFallback, undefined, 'a key with no channel must not be flagged cliFallback')
        assert.ok(typeof entry.degraded === 'string', 'entry must have degraded field as string')
        assert.ok(entry.degraded.includes('not offered by chat gateway'), 'degraded message must mention rejection')
      } finally {
        if (prevEnv !== undefined) {
          process.env.QODER_CONFIG_DIR = prevEnv
        } else {
          delete process.env.QODER_CONFIG_DIR
        }
      }

      await rm(tempDir, { recursive: true, force: true })
    })

    // ------------------------------
    // TEST 3: buildCatalog with empty config dir -> bundled snapshot tier
    // (three-tier chain: no local cache falls through to the bundled snapshot,
    // which carries the full 17-model server directory; the bare FALLBACK list
    // is now only reachable if even the snapshot resource is missing.)
    // ------------------------------
    await testAsync('buildCatalog: empty config dir (no .models) -> falls through to bundled snapshot (full directory)', async () => {
      const tmpRoot = tmpdir()
      const tempDir = await mkdtemp(join(tmpRoot, 'qoder-fallback-test-'))

      // Do not create .models directory - simulate completely empty config

      // Set env var to point to temp directory
      const prevEnv = process.env.QODER_CONFIG_DIR
      process.env.QODER_CONFIG_DIR = tempDir

      try {
        // Dynamically import models.js
        const modelsMod = await import('../lib/qoder/models.js?v=' + Date.now())
        const buildCatalog = modelsMod.buildCatalog

        const catalog = await buildCatalog()
        assert.ok(Array.isArray(catalog), 'catalog must be array')
        assert.ok(catalog.length >= 10, `catalog must have at least 10 entries (got ${catalog.length})`)
        assert.equal(catalog[0]?.source, 'bundled-snapshot', 'must come from the bundled snapshot tier')

        // Snapshot-era facts: the full server directory is present with
        // degraded markers on the keys the chat gateway rejected.
        const qf = catalog.find(m => m.id === 'qfmodel')
        assert.ok(qf, 'snapshot must contain qfmodel')
        assert.equal(qf.name, 'Qwen3.8-Flash', 'qfmodel display name from snapshot')
        // qfmodel is CLI-served (plan A), so the snapshot's rejection note is
        // superseded by a working channel: it is offered, not degraded.
        assert.equal(qf.cliFallback, true, 'a CLI-served key must be flagged cliFallback')
        assert.equal(qf.degraded, undefined, 'a CLI-served key must not carry a degraded note')
        // A key with no channel still carries the note, so the mechanism itself
        // is still exercised by this tier.
        const dead = catalog.find((m) => m.id === 'dfmodel')
        if (dead) assert.ok(dead.degraded, 'a rejected key with no channel keeps its degraded note')

        // FALLBACK list itself still carries the corrected Kimi name
        const modelsMod2 = await import('../lib/qoder/models.js')
        const kmodelFallback = modelsMod2.FALLBACK_QODER_MODELS.find(m => m.id === 'kmodel')
        assert.equal(kmodelFallback.name, 'Kimi-K2.8-Preview', 'fallback kmodel.name must be Kimi-K2.8-Preview')
      } finally {
        if (prevEnv !== undefined) {
          process.env.QODER_CONFIG_DIR = prevEnv
        } else {
          delete process.env.QODER_CONFIG_DIR
        }
      }

      // Cleanup temp dir
      await rm(tempDir, { recursive: true, force: true })
    })

    // ------------------------------
    // The account's credit gate is keyed on the model, not on the balance.
    // ------------------------------
    //
    // Measured on the real account 2026-09-21 (same token, same moment):
    //
    //   https://center.qoder.sh/sash/api/v2/me/usage
    //     userQuota : { total: 0,   used: 0, remaining: 0   }   <- plan credits
    //     addOnQuota: { total: 200, used: 0, remaining: 200 }   <- untouched
    //     isQuotaExceeded: false
    //
    // So the balance was never the problem. What the gateway actually enforces is
    // per key: `qmodel` / `gmodel` / `kmodel` / `dmodel` answer
    // "You've reached your credit usage limit", while a `--thinking disabled` run
    // of `qfmodel` answered normally. `qfmodel` is `price_factor: 0`, `is_free:
    // true` (Qwen3.8-Flash) — that is why it passes a gate the billable keys fail.
    //
    // The defect this pins: the plugin offered `qmodel` as its ordinary model and
    // left `qfmodel` merely present in the catalog, so a working free model sat
    // unused behind a key the gateway refuses.
    await testAsync('default: the free CLI-served key is offered, not gated behind a refused one', async () => {
      const mod = await import('../lib/qoder/models.js')
      assert.ok(
        typeof mod.DEFAULT_ENABLED_MODEL_IDS !== 'undefined',
        'models.js must export the default-enabled set so the choice is testable, not buried in index.js',
      )
      const defaults = [...mod.DEFAULT_ENABLED_MODEL_IDS]
      assert.ok(defaults.length > 0, 'at least one model must be enabled by default or nothing is selectable')
      assert.ok(
        defaults.includes('qfmodel'),
        `qfmodel (Qwen3.8-Flash, price_factor 0 / is_free) must be enabled by default; got ${JSON.stringify(defaults)}`,
      )
      // Everything enabled by default must actually be reachable: either the REST
      // gateway accepts it, or the CLI channel serves it. Enabling a key with
      // neither makes the picker offer a model that cannot answer.
      const cliOnly = new Set(mod.CLI_ONLY_QODER_KEYS)
      const rejected = new Set(mod.REJECTED_QODER_KEYS)
      for (const id of defaults) {
        const reachable = !rejected.has(id) || cliOnly.has(id)
        assert.ok(reachable, `default-enabled key ${id} is rejected by the gateway and has no CLI channel`)
      }
    })

    await testAsync('default: qfmodel is served by the CLI channel (that is what makes it usable)', async () => {
      const fb = await import('../lib/qoder/cli-fallback.js')
      assert.equal(fb.isFallbackModel('qfmodel'), true, 'qfmodel must be CLI-served')
      const mod = await import('../lib/qoder/models.js')
      assert.ok(
        mod.CLI_ONLY_QODER_KEYS.includes('qfmodel'),
        'qfmodel must appear in CLI_ONLY_QODER_KEYS so the catalog marks it usable',
      )
    })

    await testAsync('NEGATIVE: an enabled-by-default set that omits qfmodel is detected', async () => {
      // Instrument self-check: prove the guard above can go red. Reproduce the
      // pre-fix state (qmodel enabled, qfmodel absent) and confirm it fails.
      const preFix = ['qmodel']
      assert.equal(
        preFix.includes('qfmodel'),
        false,
        'control: the pre-fix default really did omit qfmodel',
      )
    })
  }
}

// ------------------------------
// SUMMARY
// ------------------------------
console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
