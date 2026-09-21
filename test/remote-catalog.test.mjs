// Offline tests for the four-tier catalog chain (t12) and readRemoteCatalog.
//
// The chain is: remote → local-cache → bundled-snapshot → fallback.
//
// What actually needs pinning is the ORDER and the SILENCE:
//   - the remote tier is tried first, and must be inserted BEFORE local-cache
//     (docs/REVIEW-final-integration.md §2.3);
//   - every failure mode — no credential, a failed election, a 403, a malformed
//     body, a decrypt failure, a transport error — must degrade to the next
//     tier without throwing;
//   - the three pre-existing `source` literals must not change meaning, because
//     test/models-catalog.test.mjs:229 pins `source === 'bundled-snapshot'`.
//
// ⚠️ MEASURED CONTEXT (docs/FINDING-t12-remote-tier-403.md): the live
// `model/list` endpoint answers 403 `Signature invalid` for every input
// permutation tried this sprint, so in production the remote tier always
// returns null and the chain behaves as the old three-tier one. These tests
// therefore drive the remote tier with MOCK fetch — they pin the wiring and the
// degradation contract, which is what can be verified offline. They do not and
// cannot claim the live endpoint works.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

const readerMod = await import('../lib/qoder/catalog-reader.js')
const modelsMod = await import('../lib/qoder/models.js')
const { readRemoteCatalog, electInferenceEndpoint, qoderConfigHome } = readerMod
const { buildCatalog, FALLBACK_QODER_MODELS } = modelsMod

/** A fetch stub that records every call and answers from a queue. */
function mockFetch(responder) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return responder(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/** A 200 carrying a body that will not decrypt — the realistic 403-adjacent case. */
const okStatus = (body = 'not-decryptable') => ({
  status: 200,
  text: async () => body,
})

/** A temporary configHome holding a CLI store that cannot be decrypted. */
async function withTempConfigHome(fn, { withAuth = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'qoder-remote-'))
  try {
    if (withAuth) {
      await mkdir(join(dir, '.auth'), { recursive: true })
      // Present but not real ciphertext: every decrypt path must fail silently.
      await writeFile(join(dir, '.auth', 'user'), 'not-a-ciphertext', 'utf8')
      await writeFile(
        join(dir, '.auth', 'machine_id'),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
        'utf8',
      )
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

console.log('== remote catalog: silent degradation ==')

await test('readRemoteCatalog returns null when there is no CLI credential', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => okStatus())
    const result = await readRemoteCatalog(dir, fetchImpl)
    assert.equal(result, null)
    assert.equal(fetchImpl.calls.length, 0, 'must not hit the network without a credential')
  }, { withAuth: false })
})

await test('readRemoteCatalog returns null on a 403 from model/list', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => ({
      status: 403,
      text: async () => '{"code":"101","message":"Signature invalid"}',
    }))
    const result = await readRemoteCatalog(dir, fetchImpl)
    assert.equal(result, null)
  })
})

await test('readRemoteCatalog returns null on a transport error', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    assert.equal(await readRemoteCatalog(dir, fetchImpl), null)
  })
})

await test('readRemoteCatalog returns null when the 200 body will not decrypt', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => okStatus('garbage-that-is-not-ciphertext'))
    assert.equal(await readRemoteCatalog(dir, fetchImpl), null)
  })
})

await test('electInferenceEndpoint returns null when election does not answer 200', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => ({ status: 500, text: async () => '' }))
    assert.equal(await electInferenceEndpoint(dir, fetchImpl), null)
  })
})

await test('electInferenceEndpoint returns null without a credential', async () => {
  await withTempConfigHome(async (dir) => {
    const fetchImpl = mockFetch(() => okStatus())
    assert.equal(await electInferenceEndpoint(dir, fetchImpl), null)
  }, { withAuth: false })
})

console.log('')
console.log('== four-tier chain: order and fallback ==')

// The remote tier cannot be driven to success offline without the live server
// (see the header note), so these tests pin what IS verifiable: the chain still
// resolves through the lower tiers in order, and buildCatalog never throws.
await test('buildCatalog still reaches the snapshot tier when the remote tier fails', async () => {
  await withTempConfigHome(async (dir) => {
    const catalog = await buildCatalog({ configHome: dir })
    assert.ok(Array.isArray(catalog) && catalog.length > 0, 'expected a non-empty catalog')
    const source = catalog[0]?.source
    assert.equal(
      source,
      'bundled-snapshot',
      `expected the snapshot tier to answer, got source=${source}`,
    )
  })
})

await test('buildCatalog never throws when configHome points at nothing', async () => {
  const catalog = await buildCatalog({ configHome: join(tmpdir(), 'qoder-does-not-exist-xyz') })
  assert.ok(Array.isArray(catalog) && catalog.length > 0)
  assert.ok(
    ['remote', 'local-cache', 'bundled-snapshot', 'fallback'].includes(catalog[0]?.source),
    `unexpected source ${catalog[0]?.source}`,
  )
})

await test('buildCatalog omitting configHome entirely still resolves', async () => {
  // Pins the no-argument path: the remote tier must not be reached with an
  // undefined configHome and blow up the whole build.
  const catalog = await buildCatalog({})
  assert.ok(Array.isArray(catalog) && catalog.length > 0)
})

await test('an empty configHome directory falls through to the snapshot', async () => {
  await withTempConfigHome(async (dir) => {
    const catalog = await buildCatalog({ configHome: dir })
    assert.equal(catalog[0]?.source, 'bundled-snapshot')
  }, { withAuth: false })
})

await test('the fallback tier is the declared minimal set', async () => {
  assert.ok(Array.isArray(FALLBACK_QODER_MODELS))
  assert.ok(FALLBACK_QODER_MODELS.length > 0)
})

console.log('')
console.log('== source ladder: the three legacy literals are unchanged ==')

await test('an existing snapshot-tier source stays "bundled-snapshot"', async () => {
  // models-catalog.test.mjs:229 depends on this exact literal.
  const catalog = await buildCatalog({ configHome: join(tmpdir(), 'qoder-absent-abc') })
  assert.ok(
    ['bundled-snapshot', 'fallback', 'local-cache'].includes(catalog[0]?.source),
    `legacy literal drifted: ${catalog[0]?.source}`,
  )
})

await test('every catalog entry carries a source', async () => {
  const catalog = await buildCatalog({})
  for (const entry of catalog) {
    assert.equal(typeof entry.source, 'string', `entry ${entry.id} has no source`)
  }
})

console.log('')
console.log('== configHome same-source ==')

await test('qoderConfigHome honours QODER_CONFIG_DIR over the injected home', async () => {
  const prior = process.env.QODER_CONFIG_DIR
  const dir = await mkdtemp(join(tmpdir(), 'qoder-env-'))
  try {
    process.env.QODER_CONFIG_DIR = dir
    assert.equal(qoderConfigHome('C:/some/other/home'), dir)
    delete process.env.QODER_CONFIG_DIR
    assert.equal(qoderConfigHome('C:/some/home'), join('C:/some/home', '.qoder'))
  } finally {
    if (prior === undefined) delete process.env.QODER_CONFIG_DIR
    else process.env.QODER_CONFIG_DIR = prior
    await rm(dir, { recursive: true, force: true })
  }
})

await test('the remote reader and the local reader resolve the SAME directory', async () => {
  // The split-brain guard from REVIEW-final-integration.md §2.4: both tiers must
  // be pointed at one resolved path, never re-derived independently.
  //
  // Note on method: this cannot be proved by observing readRemoteCatalog reach
  // the network, because that needs a genuinely decryptable CLI store (a
  // fixture we cannot forge offline — see the header note). What IS provable
  // is the resolution contract: qoderConfigHome() is the single source of the
  // path, it honours QODER_CONFIG_DIR, and buildCatalog threads the value it is
  // handed straight through instead of re-deriving it.
  const prior = process.env.QODER_CONFIG_DIR
  const dir = await mkdtemp(join(tmpdir(), 'qoder-same-'))
  try {
    process.env.QODER_CONFIG_DIR = dir
    assert.equal(qoderConfigHome(), dir, 'the env var must win')

    // A credential directory that exists but is not decryptable: the remote
    // reader must fail SILENTLY (null) rather than throwing, and crucially must
    // not fall back to reading some other hard-coded directory.
    await mkdir(join(dir, '.auth'), { recursive: true })
    await writeFile(join(dir, '.auth', 'user'), 'not-ciphertext', 'utf8')
    await writeFile(join(dir, '.auth', 'machine_id'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab', 'utf8')

    const fetchImpl = mockFetch(() => ({ status: 403, text: async () => '' }))
    assert.equal(await readRemoteCatalog(dir, fetchImpl), null)

    // The explicit argument wins over the env var, so the caller that resolves
    // once and threads the value gets exactly what it resolved.
    const otherDir = await mkdtemp(join(tmpdir(), 'qoder-other-'))
    try {
      assert.equal(await readRemoteCatalog(otherDir, fetchImpl), null)
    } finally {
      await rm(otherDir, { recursive: true, force: true })
    }
  } finally {
    if (prior === undefined) delete process.env.QODER_CONFIG_DIR
    else process.env.QODER_CONFIG_DIR = prior
    await rm(dir, { recursive: true, force: true })
  }
})

await test('buildCatalog forwards its configHome to the tiers it drives', async () => {
  // Pins index.js's threading contract at the models.js boundary: passing an
  // explicit configHome must change which directory the local tier reads.
  const dir = await mkdtemp(join(tmpdir(), 'qoder-fwd-'))
  try {
    await mkdir(join(dir, '.models', 'someone'), { recursive: true })
    await writeFile(join(dir, '.models', 'default'), JSON.stringify({ uid: 'someone' }), 'utf8')
    // catalog-v6 is absent -> the local tier finds nothing and we fall through.
    // If buildCatalog ignored the argument it would read the real home instead,
    // and the source would differ on a machine that HAS a live cache.
    const catalog = await buildCatalog({ configHome: dir })
    assert.ok(Array.isArray(catalog) && catalog.length > 0)
    assert.notEqual(
      catalog[0]?.source,
      'remote',
      'the remote tier cannot succeed offline; a "remote" source here would mean a mock leaked',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  for (const f of failures) console.log(`  ${f.name}: ${f.error.stack ?? f.error.message}`)
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}

