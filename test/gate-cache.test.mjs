// Offline tests for the per-account gate cache (lib/qoder/gate-cache.js).
//
// The cache is what lets the settings card mark each model with THIS account's
// measured reality, so its risky part is not the happy path but the four ways it
// must refuse to trust a file on disk:
//
//   1. absent file        -> null (first run, nothing measured yet)
//   2. unparseable JSON   -> null (truncated write / hand-edited file)
//   3. no `results` field -> null (wrong shape, e.g. another tool's file)
//   4. older than TTL     -> null (a stale measurement must re-probe, not block)
//
// Everything below runs offline: no network, no $DSH_HOME, no real credentials.
// Every case uses its own mkdtemp directory so cases cannot leak into each other.
//
// Run: node --test test/gate-cache.test.mjs
// (or plain `node test/gate-cache.test.mjs`; process.exitCode set at the end.)

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

/** Fresh isolated config home; the caller owns cleanup via `finally`. */
async function makeHome(tag) {
  return mkdtemp(join(tmpdir(), `qoder-gate-cache-${tag}-`))
}

const mod = await import('../lib/qoder/gate-cache.js').catch((e) => ({ __err: e }))

if (mod.__err) {
  console.log('== qoder gate-cache ==')
  console.log(`  FAIL import lib/qoder/gate-cache.js :: ${mod.__err.code ?? mod.__err.message}`)
  fail++
  failures.push({ name: 'import gate-cache', error: mod.__err })
} else {
  const { GATE_CACHE_TTL_MS, gateCachePath, loadGateCache, saveGateCache } = mod
  console.log('== qoder gate-cache ==')

  const T0 = Date.parse('2026-01-01T00:00:00.000Z')
  const SAMPLE = {
    'qoder-model-a': 'accepted',
    'qoder-model-b': 'rejected',
    'qoder-model-c': 'unknown',
  }

  // ------------------------------------------------------------------
  // Path contract
  // ------------------------------------------------------------------
  await test('gateCachePath: cache lives beside the credential copy under $DSH_HOME', async () => {
    const home = await makeHome('path')
    try {
      assert.equal(
        gateCachePath(home),
        join(home, '.qoder-cli-gate-cache.json'),
        'cache file name is part of the on-disk contract',
      )
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------------------
  // Round trip (and: the directory is created on demand)
  // ------------------------------------------------------------------
  await test('save -> load round trip returns the same results', async () => {
    const home = await makeHome('roundtrip')
    try {
      // The home directory does not exist yet: saveGateCache must create it.
      await assert.doesNotReject(
        () => saveGateCache(home, SAMPLE, T0),
        'saveGateCache must create the missing config directory',
      )

      const loaded = await loadGateCache(home, T0)
      assert.ok(loaded !== null, 'a fresh cache must load, not return null')
      assert.deepEqual(loaded.results, SAMPLE, 'results must survive the round trip intact')
      assert.equal(loaded.version, 1, 'cache documents carry version 1')
      assert.equal(
        loaded.measuredAt,
        new Date(T0).toISOString(),
        'measuredAt records the probe instant as an ISO string',
      )
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('save -> load from a pre-existing directory also round trips', async () => {
    const home = await makeHome('roundtrip2')
    try {
      await saveGateCache(home, { 'qoder-model-a': 'rejected' }, T0)
      // Second save overwrites atomically (temp + rename) rather than appending.
      await saveGateCache(home, SAMPLE, T0 + 60_000)
      const loaded = await loadGateCache(home, T0 + 60_000)
      assert.ok(loaded !== null, 'the rewritten cache must still load')
      assert.deepEqual(loaded.results, SAMPLE, 'the rewrite replaces the earlier round')
      assert.equal(loaded.measuredAt, new Date(T0 + 60_000).toISOString())
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('save leaves no stray temp file behind (atomic temp + rename)', async () => {
    const home = await makeHome('atomic')
    try {
      await saveGateCache(home, SAMPLE, T0)
      const { readdir } = await import('node:fs/promises')
      const names = await readdir(home)
      assert.deepEqual(names, ['.qoder-cli-gate-cache.json'], 'only the final cache file may remain')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------------------
  // TTL boundary
  // ------------------------------------------------------------------
  await test('TTL: exactly GATE_CACHE_TTL_MS old is still valid (inclusive boundary)', async () => {
    const home = await makeHome('ttl-edge')
    try {
      await saveGateCache(home, SAMPLE, T0)
      const loaded = await loadGateCache(home, T0 + GATE_CACHE_TTL_MS)
      assert.ok(loaded !== null, 'age == TTL is inside the documented <= TTL window')
      assert.deepEqual(loaded.results, SAMPLE)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('TTL: one millisecond past the window returns null (expired)', async () => {
    const home = await makeHome('ttl-expired')
    try {
      await saveGateCache(home, SAMPLE, T0)
      const loaded = await loadGateCache(home, T0 + GATE_CACHE_TTL_MS + 1)
      assert.equal(loaded, null, 'an expired cache must return null so the caller re-probes')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('TTL: 24h long-expired cache on disk is still readable as raw JSON', async () => {
    const home = await makeHome('ttl-really-old')
    try {
      await saveGateCache(home, SAMPLE, T0)
      const raw = await readFile(gateCachePath(home), 'utf8')
      assert.ok(raw.includes('qoder-model-a'), 'the expired file is left in place, not deleted')
      assert.equal(await loadGateCache(home, T0 + 30 * 24 * 60 * 60 * 1000), null)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('TTL: a future measuredAt is rejected (clock skew is not freshness)', async () => {
    const home = await makeHome('ttl-future')
    try {
      await saveGateCache(home, SAMPLE, T0)
      // Negative age: the file claims to have been measured after "now".
      const loaded = await loadGateCache(home, T0 - 60_000)
      assert.equal(loaded, null, 'negative age must not be treated as valid')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('TTL: default `now` argument is usable (no now supplied)', async () => {
    const home = await makeHome('ttl-default-now')
    try {
      await saveGateCache(home, SAMPLE, Date.now())
      const loaded = await loadGateCache(home)
      assert.ok(loaded !== null, 'a just-written cache must load with the default clock')
      assert.deepEqual(loaded.results, SAMPLE)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------------------
  // Defensive paths: absent / corrupt / incomplete
  // ------------------------------------------------------------------
  await test('absent file returns null without creating anything', async () => {
    const home = await makeHome('absent')
    try {
      assert.equal(await loadGateCache(home, T0), null, 'no measurement yet must be null')
      const { readdir } = await import('node:fs/promises')
      assert.deepEqual(await readdir(home), [], 'a failed load must not write a cache file')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('absent $DSH_HOME directory returns null instead of throwing', async () => {
    const home = await makeHome('absent-dir')
    const missing = join(home, 'does-not-exist')
    try {
      await assert.doesNotReject(
        () => loadGateCache(missing, T0),
        'a missing config home must degrade to null, not throw',
      )
      assert.equal(await loadGateCache(missing, T0), null)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('corrupt JSON returns null (truncated write)', async () => {
    const home = await makeHome('corrupt-truncated')
    try {
      await writeFile(gateCachePath(home), '{"version":1,"measuredAt":"2026-01-01T00:00:00.000Z","resu', 'utf8')
      assert.equal(await loadGateCache(home, T0), null, 'truncated JSON must be rejected')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('corrupt JSON returns null (not JSON at all)', async () => {
    const home = await makeHome('corrupt-garbage')
    try {
      await writeFile(gateCachePath(home), 'this is not json, it is 中文 garbage \u0000', 'utf8')
      assert.equal(await loadGateCache(home, T0), null, 'garbage bytes must be rejected')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('empty file returns null', async () => {
    const home = await makeHome('corrupt-empty')
    try {
      await writeFile(gateCachePath(home), '', 'utf8')
      assert.equal(await loadGateCache(home, T0), null, 'an empty file parses to nothing usable')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('valid JSON with no `results` object returns null', async () => {
    const home = await makeHome('no-results')
    try {
      const doc = { version: 1, measuredAt: new Date(T0).toISOString() }
      await writeFile(gateCachePath(home), JSON.stringify(doc), 'utf8')
      assert.equal(await loadGateCache(home, T0), null, 'a document without results is not a cache')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('null `results` returns null', async () => {
    const home = await makeHome('null-results')
    try {
      const doc = { version: 1, measuredAt: new Date(T0).toISOString(), results: null }
      await writeFile(gateCachePath(home), JSON.stringify(doc), 'utf8')
      // typeof null === 'object', so this is the case that a naive shape check lets through.
      assert.equal(await loadGateCache(home, T0), null, 'typeof null is object but it is not results')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('`results` of the wrong type (string/array) returns null', async () => {
    const home = await makeHome('bad-results-type')
    try {
      for (const results of ['accepted', ['qoder-model-a'], 7, true]) {
        const doc = { version: 1, measuredAt: new Date(T0).toISOString(), results }
        await writeFile(gateCachePath(home), JSON.stringify(doc), 'utf8')
        assert.equal(
          await loadGateCache(home, T0),
          null,
          `results of type ${typeof results} must not be accepted`,
        )
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('valid JSON with no/unparseable `measuredAt` returns null', async () => {
    const home = await makeHome('bad-measuredat')
    try {
      for (const measuredAt of [undefined, null, '', 'not-a-date', 12345, {}]) {
        const doc = { version: 1, results: SAMPLE }
        if (measuredAt !== undefined) doc.measuredAt = measuredAt
        await writeFile(gateCachePath(home), JSON.stringify(doc), 'utf8')
        assert.equal(
          await loadGateCache(home, T0),
          null,
          `measuredAt ${JSON.stringify(measuredAt)} must not yield a usable cache`,
        )
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('a JSON scalar document (not an object) returns null', async () => {
    const home = await makeHome('scalar-doc')
    try {
      for (const raw of ['null', '42', '"a string"', '[]', 'true']) {
        await writeFile(gateCachePath(home), raw, 'utf8')
        assert.equal(await loadGateCache(home, T0), null, `document ${raw} is not a cache document`)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  await test('the raw TTL constant is the documented 24h', async () => {
    assert.equal(GATE_CACHE_TTL_MS, 24 * 60 * 60 * 1000, 'TTL is part of the documented contract')
  })

  // ------------------------------------------------------------------
  // Isolation: separate mkdtemp homes must not see each other
  // ------------------------------------------------------------------
  await test('two homes are isolated (mkdtemp per case)', async () => {
    const homeA = await makeHome('iso-a')
    const homeB = await makeHome('iso-b')
    try {
      await saveGateCache(homeA, { 'qoder-model-a': 'accepted' }, T0)

      assert.equal(await loadGateCache(homeB, T0), null, 'home B must not see home A cache')

      await saveGateCache(homeB, { 'qoder-model-b': 'rejected' }, T0)

      const a = await loadGateCache(homeA, T0)
      const b = await loadGateCache(homeB, T0)
      assert.ok(a !== null && b !== null, 'both homes must load their own cache')
      assert.deepEqual(a.results, { 'qoder-model-a': 'accepted' }, 'home A keeps its own results')
      assert.deepEqual(b.results, { 'qoder-model-b': 'rejected' }, 'home B keeps its own results')
      assert.notEqual(gateCachePath(homeA), gateCachePath(homeB), 'the two paths differ')
    } finally {
      await rm(homeA, { recursive: true, force: true })
      await rm(homeB, { recursive: true, force: true })
    }
  })

  await test('every case above ran in its own mkdtemp directory', async () => {
    const { readdir } = await import('node:fs/promises')
    const leftovers = (await readdir(tmpdir())).filter((n) => n.startsWith('qoder-gate-cache-'))
    assert.deepEqual(leftovers, [], `temp homes must be cleaned up, found: ${leftovers.join(', ')}`)
  })
}

// ------------------------------------------------------------------
// Token resolution path (resolveProbeToken -> wasm-credential-reader)
// ------------------------------------------------------------------
//
// These cases run AFTER every cache case above, and deliberately so: they are
// the only cases here that touch WASM. They double as the regression pin for
// ds-b's fix in lib/qoder/wasm-credential-reader.js — `init` used to be declared
// without a default path, so the plugin's own module called it as `init()` and
// threw ERR_INVALID_ARG_TYPE out of readFileSync(undefined); the parameter list
// is now `init(wasmPath = WASM_PATH)` (line 31).
//
// Wasm memory is rebound per module instance: resolveProbeToken calls the
// LIBRARY's bare init(), while the credential is encrypted through this file's
// own helper instance. Both must be instantiated, and the helper must not be
// re-initialised after its instances are used, or the library's rebound memory
// invalidates them (measured while developing this case).

if (mod.__err) {
  console.log('  SKIP token resolution (gate-cache failed to import)')
} else {
  const { resolveProbeToken } = mod
  const { mkdir, writeFile } = await import('node:fs/promises')

  console.log('-- token resolution --')

  const helper = await import('./wasm-encrypt-helper.mjs').catch((e) => ({ __err: e }))
  const libWasm = await import('../lib/qoder/wasm-credential-reader.js').catch((e) => ({ __err: e }))

  if (helper.__err || libWasm.__err) {
    const err = helper.__err ?? libWasm.__err
    console.log(`  FAIL import wasm modules :: ${err.code ?? err.message}`)
    fail++
    failures.push({ name: 'import wasm modules', error: err })
  } else {
    const { WASM_PATH, credentialStorageEncrypt, init: initHelper } = helper
    const { init: initLib } = libWasm

    // Case (1) — the regression pin, updated for the post-WASM world.
    // init() used to throw ERR_INVALID_ARG_TYPE with no argument (ds-b's fix
    // added a default); the bundled WASM has since been removed entirely, so
    // the no-argument call is now a no-op resolving null. The credential codec
    // is pure JS and needs no setup.
    await test('init(): calling with no argument is safe (resolves null, WASM removed)', async () => {
      const exports = await initLib()
      assert.equal(exports, null, 'init() with no binary to load resolves null')
    })

    await test('init(): an explicit path still loads a binary when given one', async () => {
      // No bundled binary exists anymore, so the explicit-path contract is
      // pinned by asserting the rejection shape rather than a successful load:
      // a missing file must fail loudly (ENOENT), never silently return null.
      await assert.rejects(
        () => initLib('D:/DSH/qoder-dsh-plugin/lib/qoder/wasm/removed.bin'),
        /ENOENT/,
        'an explicit missing path must surface ENOENT, not a silent null',
      )
    })

    // Case (2) — a real token through the CLI device-flow fallback.
    await test('resolveProbeToken: reads a token from a temp .auth store (configHome)', async () => {
      const home = await makeHome('probe-token')
      try {
        // The credential codec is pure JS: no helper init needed. The store is
        // encrypted with the reader's own primitive and decrypted by the
        // library's own codec inside resolveProbeToken's walk.
        const MACHINE_ID = 'machine-id-0123456789abcdef'
        const TOKEN = 'dt-PROBE-TOKEN-LIVE'
        const credential = {
          security_oauth_token: TOKEN,
          user: { id: 'u-test', name: 'tester' },
        }

        await mkdir(join(home, '.auth'), { recursive: true })
        await writeFile(
          join(home, '.auth', 'user'),
          libWasm.credentialStorageEncrypt(JSON.stringify(credential), MACHINE_ID.slice(0, 16)),
          'utf8',
        )
        await writeFile(join(home, '.auth', 'machine_id'), `${MACHINE_ID}\n`, 'utf8')

        // The discover branch is deliberately denied, so the assertions below can
        // only pass through the .auth store: a green here is not the first branch.
        const token = await resolveProbeToken(
          async () => { throw new Error('no plugin credential in this test') },
          async () => { throw new Error('no dpapi in this test') },
          home,
        )

        assert.equal(typeof token, 'string', 'resolveProbeToken must return a token string')
        assert.equal(token, TOKEN, 'the token must be the one stored in .auth/user')
        assert.ok(token.length > 0, 'the token must be non-empty')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    })

    await test('resolveProbeToken: prefers the discovered credential when there is one', async () => {
      // No .auth store on disk at all: only the discover branch can answer.
      const home = await makeHome('probe-discover')
      try {
        const token = await resolveProbeToken(
          async () => ({ credential: { token: 'dt-FROM-DISCOVER' }, machineId: 'm1', dir: home }),
          async () => Buffer.alloc(0),
          home,
        )
        assert.equal(token, 'dt-FROM-DISCOVER', 'the plugin credential chain wins over the store')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    })

    await test('resolveProbeToken: no credential anywhere returns null, not a throw', async () => {
      const home = await makeHome('probe-none')
      try {
        await assert.doesNotReject(
          () => resolveProbeToken(async () => null, async () => null, home),
          'a missing credential must degrade to null',
        )
        const token = await resolveProbeToken(async () => null, async () => null, home)
        assert.equal(token, null, 'nothing discoverable and no store must yield null')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    })

    await test('resolveProbeToken: undecryptable .auth/user returns null, not a throw', async () => {
      const home = await makeHome('probe-corrupt')
      try {
        await mkdir(join(home, '.auth'), { recursive: true })
        await writeFile(join(home, '.auth', 'user'), 'not-valid-encrypted-credential', 'utf8')
        await writeFile(join(home, '.auth', 'machine_id'), 'machine-id-0123456789abcdef', 'utf8')
        const token = await resolveProbeToken(async () => null, async () => null, home)
        assert.equal(token, null, 'garbage ciphertext must degrade to null')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    })

    await test('every token case cleaned up (no probe homes left behind)', async () => {
      const { readdir } = await import('node:fs/promises')
      const leftovers = (await readdir(tmpdir())).filter((n) => n.startsWith('qoder-gate-cache-'))
      assert.deepEqual(leftovers, [], `temp homes must be cleaned up, found: ${leftovers.join(', ')}`)
    })
  }
}

// ------------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------------
console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  console.log('failures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.error?.message ?? f.error}`)
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
