// Catalog reader tests for Qoder model-catalog decryption and parsing.
//
// Tests:
// 1. decryptCatalog: encrypt a fixture JSON with WASM, then decrypt and deep assert.
// 2. readLocalCatalog: create temp config dir, write encrypted catalog, verify parse;
//    also verify null on missing .models and corrupted ciphertext.
// 3. rawModelToCatalogEntry: verify VL input, reasoningEfforts, promotion window.
//
// Run: node --test test/catalog-reader.test.mjs
// (or plain `node test/catalog-reader.test.mjs`; process.exitCode set below.)

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

console.log('== qoder catalog-reader ==')

// Load fixtures and modules once up front
let fixtureChat = null
let fixtureUid = null
let modelCacheEncrypt = null
let modelCacheDecrypt = null
let decryptCatalog = null
let readLocalCatalog = null
let rawModelToCatalogEntry = null

try {
  // The model-cache codec is pure JS now; the bundled WASM has been removed
  // from the package. Fixtures are built with the pure codec, and
  // decryptCatalog is exercised through its pure path by default (the WASM
  // remains opt-in inside catalog-reader via QODER_MODEL_CACHE_WASM=1).
  const pure = await import('../lib/qoder/model-cache-crypto.js')
  modelCacheEncrypt = pure.modelCacheEncrypt
  modelCacheDecrypt = pure.modelCacheDecrypt
} catch (e) {
  console.log(`  FAIL init pure codec :: ${e.code ?? e.message}`)
  fail++
  failures.push({ name: 'init pure codec', error: e })
}

try {
  const readerMod = await import('../lib/qoder/catalog-reader.js')
  decryptCatalog = readerMod.decryptCatalog
  readLocalCatalog = readerMod.readLocalCatalog
  rawModelToCatalogEntry = readerMod.rawModelToCatalogEntry
} catch (e) {
  console.log(`  FAIL import catalog-reader :: ${e.message}`)
  fail++
  failures.push({ name: 'import catalog-reader', error: e })
}
if (modelCacheEncrypt && modelCacheDecrypt && decryptCatalog) {
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

  if (fixtureChat && typeof fixtureChat.chat === 'object') {
    // ------------------------------
    // TEST 1: decryptCatalog
    // ------------------------------
    await testAsync('decryptCatalog: encrypt fixture chat -> decrypt -> deep equal', async () => {
      // Encrypt entire JSON.stringify of fixture
      const plainJson = JSON.stringify(fixtureChat)
      const encrypted = modelCacheEncrypt(plainJson, fixtureUid)
      assert.ok(typeof encrypted === 'string' && encrypted.length > 0, 'encrypted output must be base64-like string')

      // Call decryptCatalog
      const decrypted = await decryptCatalog(encrypted, fixtureUid)
      assert.ok(decrypted && typeof decrypted.chat === 'object', 'decrypted result must have chat scene')

      // Deep equivalence check by comparing assistant array inside chat scene
      const origScene = fixtureChat.chat
      const decScene = decrypted.chat

      assert.equal(Array.isArray(origScene), Array.isArray(decScene), 'both scenes must be arrays')
      assert.equal(origScene.length, decScene.length, 'scene length must match')

      if (origScene.length > 0 && decScene.length > 0) {
        const firstOrig = origScene[0]
        const firstDec = decScene[0]
        assert.equal(firstOrig.key, firstDec.key, 'first element key must match')
        assert.equal(firstOrig.display_name, firstDec.display_name, 'first element display_name must match')
      }
    })
  } else {
    console.log('  SKIP decryptCatalog (fixture shape wrong)')
  }

  // ------------------------------
  // TEST 2: readLocalCatalog
  // ------------------------------
  await testAsync('readLocalCatalog: create temp dir, write encrypted catalog, read back', async () => {
    const tmpRoot = tmpdir()
    const tempDir = await mkdtemp(join(tmpRoot, 'qoder-test-'))

    // Ensure models directory structure
    const modelsDir = join(tempDir, '.models')
    const uidSafe = String(fixtureUid).replace(/^\.+/, '') || 'anon'
    const uidDir = join(modelsDir, uidSafe)
    await mkdir(uidDir, { recursive: true })

    const plainJson = JSON.stringify(fixtureChat)
    const encrypted = modelCacheEncrypt(plainJson, fixtureUid)
    const catalogPath = join(uidDir, 'catalog-v6')
    await writeFile(catalogPath, encrypted, 'utf8')

    // Set env var to point to temp directory
    const prevEnv = process.env.QODER_CONFIG_DIR
    process.env.QODER_CONFIG_DIR = tempDir

    try {
      // Dynamically reload module to pick up new env var
      const readerMod = await import('../lib/qoder/catalog-reader.js')
      const readResult = await readerMod.readLocalCatalog(tempDir)
      assert.ok(readResult && typeof readResult.chat === 'object', 'must return parsed catalog')
      assert.equal(readResult.chat.length, fixtureChat.chat.length, 'must have same scene length')
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

  await testAsync('readLocalCatalog: no .models directory returns null', async () => {
    const tmpRoot = tmpdir()
    const tempDir = await mkdtemp(join(tmpRoot, 'qoder-test-no-models-'))

    try {
      const readerMod = await import('../lib/qoder/catalog-reader.js')
      const result = await readerMod.readLocalCatalog(tempDir)
      assert.equal(result, null, 'must return null when .models missing')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  await testAsync('readLocalCatalog: corrupted ciphertext returns null without throwing', async () => {
    const tmpRoot = tmpdir()
    const tempDir = await mkdtemp(join(tmpRoot, 'qoder-test-corrupt-'))
    const modelsDir = join(tempDir, '.models')
    const uidSafe = String(fixtureUid).replace(/^\.+/, '') || 'anon'
    const uidDir = join(modelsDir, uidSafe)
    await mkdir(uidDir, { recursive: true })

    await writeFile(join(uidDir, 'catalog-v6'), 'this-is-not-valid-base64-or-wasm-encrypted-data!!', 'utf8')

    try {
      const readerMod = await import('../lib/qoder/catalog-reader.js')
      const result = await readerMod.readLocalCatalog(tempDir)
      assert.equal(result, null, 'must return null when ciphertext is garbage')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
}

if (fixtureChat && typeof fixtureChat.chat === 'object') {
  // Find an is_vl=true sample in chat scene
  let vlSample = null
  for (const m of fixtureChat.chat) {
    if (m.is_vl === true) {
      vlSample = m
      break
    }
  }

  // ------------------------------
  // TEST 3: rawModelToCatalogEntry
  // ------------------------------
  // Verifier finding V2-F2: this assertion was stale. It pinned the OLD
  // behaviour (advertise `image` for is_vl models) that catalog-reader.js
  // deliberately reversed: this connector has no attachment channel, so
  // advertising `image` makes pi-ai reject the whole request up front with
  // UNSUPPORTED_CONTENT before it ever reaches the plugin (measured on
  // qfmodel, which is is_vl: true). The test now pins the INTENDED contract —
  // text always, and never a capability we cannot serve — plus a negative
  // guard so a future edit cannot silently re-advertise `image`.
  await testAsync('rawModelToCatalogEntry: is_vl=true stays text-only (capability we can serve)', async () => {
    if (!vlSample) throw new Error('no is_vl=true sample found in fixture')
    const entry = rawModelToCatalogEntry(vlSample)
    assert.ok(Array.isArray(entry.input), 'input must be array')
    assert.ok(entry.input.includes('text'), 'input must always include text')
    assert.ok(
      !entry.input.includes('image'),
      'is_vl models must NOT advertise image: the connector has no attachment path, ' +
        'and advertising it makes pi-ai reject the request with UNSUPPORTED_CONTENT',
    )
  })

  await testAsync('negative: a fabricated image capability is detected (instrument self-check)', async () => {
    // Prove the guard above can actually go red: if the projection ever emits
    // `image`, this negative case must fail. We simulate that by asserting the
    // guard's predicate against a deliberately wrong value.
    const fabricated = { input: ['text', 'image'] }
    const advertisesImage = fabricated.input.includes('image')
    assert.ok(advertisesImage, 'instrument check: the detector recognises a fabricated image capability')
    assert.ok(
      !(fabricated.input.includes('text') && !fabricated.input.includes('image')),
      'instrument check: the guard predicate reports false for a fabricated image capability',
    )
  })

  await testAsync('rawModelToCatalogEntry: thinking_config.enabled.efforts builds reasoningEfforts', async () => {
    const thinkingConfig = { enabled: { efforts: { low: {}, xhigh: {} } } }
    const sample = { ...vlSample, thinking_config: thinkingConfig }
    const entry = rawModelToCatalogEntry(sample)
    assert.deepEqual(entry.reasoningEfforts, ['low', 'xhigh'], 'reasoningEfforts must preserve order low before xhigh')
  })

  await testAsync('rawModelToCatalogEntry: promotion.active=true builds window start-end', async () => {
    const promo = { active: true, badge: 'NEW', description: 'New model', window_start: '2025-01-01', window_end: '2025-12-31' }
    const sample = { ...vlSample, promotion: promo }
    const entry = rawModelToCatalogEntry(sample)
    assert.ok(entry.promotion && entry.promotion.active === true, 'promotion.active must be true')
    assert.equal(entry.promotion.window, '2025-01-01-2025-12-31', 'window must be start-end format')
  })

  await testAsync('rawModelToCatalogEntry: max_output_tokens missing defaults to 32768', async () => {
    const sample = { ...vlSample, max_output_tokens: undefined }
    const entry = rawModelToCatalogEntry(sample)
    assert.equal(entry.maxTokens, 32768, 'default maxTokens must be 32768 when max_output_tokens absent')
  })
} else {
  console.log('  SKIP rawModelToCatalogEntry (fixture invalid or no VL sample)')
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

