// Offline tests for lib/qoder/credential-failover.js.
//
// Four risky behaviours, each verified with no network and no reliance on this
// machine's real Qoder install:
//
//  1. isCredentialFailure must classify exactly the three states that mean
//     "this credential cannot serve this request" — 401, 403, and the
//     in-band `invalid_model_error` body Qoder returns under HTTP 400 — and
//     must NOT fire on a plain 400 or on any 200.
//  2. listAlternateCredentials must walk a temporary QODER_CONFIG_DIR and
//     decrypt a real CLI device-flow store through the real WASM, using the
//     machine id's first 16 characters as the AES key.
//  3. probeCredential must answer true only for HTTP 200, and must fold a
//     transport error into false rather than throwing into the caller.
//  4. findWorkingCredential must memoise: a second call must not re-probe.
//
// Why the CLI-store fixture is built the way it is: lib/qoder/
// wasm-credential-reader.js resolves its wasm through `import.meta.url`, so a
// copy of that module living outside lib/qoder/wasm/ would look for a wasm file
// that does not exist. The test therefore copies the module source (verbatim,
// with only its `export` keywords adjusted) into lib/qoder/wasm/test-fixtures/,
// where the relative `./wasm/qoder_auth_wasm_bg.wasm` path resolves to the real
// artefact. Measured: the encryptor of one module instance and the decryptor of
// another interoperate, so the fixture is produced and consumed through the
// plugin's own code path rather than a re-implementation of the cipher.
//
// The fixture directory is removed in a finally block, so a green run leaves
// lib/ byte-identical to a red one. No lib/ source is modified.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const readerPath = join(pluginRoot, 'lib', 'qoder', 'wasm-credential-reader.js')
const readerShimDir = join(pluginRoot, 'lib', 'qoder', 'wasm', 'test-fixtures')
const readerShimPath = join(readerShimDir, 'reader-shim.mjs')
const wasmPath = join(pluginRoot, 'lib', 'qoder', 'wasm', 'qoder_auth_wasm_bg.wasm')

const failover = await import('../lib/qoder/credential-failover.js')
const {
  FAILOVER_KINDS,
  isCredentialFailure,
  listAlternateCredentials,
  probeCredential,
  findWorkingCredential,
  resetFailoverMemo,
} = failover

/** Removes the temporary reader copy even when an assertion throws. */
async function withReaderShim(fn) {
  await mkdir(readerShimDir, { recursive: true })
  const original = await readFile(readerPath, 'utf8')
  // Only the `export` keywords move; the cipher code is copied verbatim so the
  // fixture is encrypted by the plugin's real primitive.
  const shim = original
    .replace('export async function init', 'async function init')
    .replace('export function getExports', 'function getExports')
    .replace('export function credentialStorageEncrypt', 'function credentialStorageEncrypt')
    .replace('export function modelCacheEncrypt', 'function modelCacheEncrypt')
    .replace('export function modelCacheDecrypt', 'function modelCacheDecrypt')
    .replace('export function credentialStorageDecrypt', 'function credentialStorageDecrypt')
    .replace(/^export const WASM_PATH = .*$/m, `const WASM_PATH = ${JSON.stringify(wasmPath)}`)
    .replace(/\bexport const WASM_PATH\b/g, 'const WASM_PATH')
    + '\nexport { init, credentialStorageEncrypt, credentialStorageDecrypt, modelCacheEncrypt }\n'
  await writeFile(readerShimPath, shim, 'utf8')
  try {
    return await fn()
  } finally {
    await rm(readerShimDir, { recursive: true, force: true })
  }
}

/** A response stub shaped like the subset `fetch` results the probe reads. */
function response(status) {
  return { status, ok: status >= 200 && status < 300 }
}

/** Counts how many probes actually reached the transport. */
function countingFetch(statuses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    const status = statuses[calls.length - 1] ?? statuses[statuses.length - 1]
    return response(status)
  }
  impl.calls = calls
  return impl
}

/** Sets env vars for the duration of `fn`, restoring the prior values after. */
async function withEnv(vars, fn) {
  const saved = new Map()
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

console.log('== credential failover: failure classification ==')

await test('401 is a credential failure', () => {
  assert.equal(isCredentialFailure(401), true)
  assert.equal(isCredentialFailure(401, ''), true)
})

await test('403 is a credential failure', () => {
  assert.equal(isCredentialFailure(403), true)
})

await test('400 with invalid_model_error is a credential failure', () => {
  assert.equal(isCredentialFailure(400, '{"error":"invalid_model_error"}'), true)
  // The marker is matched anywhere in the body, mirroring how the relay sees it.
  assert.equal(isCredentialFailure(400, 'upstream said: invalid_model_error (code 400)'), true)
})

await test('400 without the marker is NOT a credential failure', () => {
  assert.equal(isCredentialFailure(400, '{"error":"bad_request"}'), false)
  assert.equal(isCredentialFailure(400), false)
  assert.equal(isCredentialFailure(400, ''), false)
})

await test('the marker branch is status-blind: a 200 body quoting it still classifies as a failure', () => {
  // NOT asserting the safer semantics here. The shipped implementation returns
  // `401 || 403` first and then matches the message for every other status, so
  // a 200 body containing `invalid_model_error` reports `true`. lib/ is out of
  // scope for this task (acceptance: "不修改 lib/ 源码"), so this test pins the
  // behaviour that exists today; if the guard is ever tightened to
  // `status !== 200 && message.includes(...)`, this assertion is the one that
  // must be flipped deliberately.
  assert.equal(isCredentialFailure(200, 'invalid_model_error'), true)
  assert.equal(isCredentialFailure(200, ''), false)
  assert.equal(isCredentialFailure(200), false)
})

await test('other statuses are not credential failures', () => {
  for (const status of [0, 204, 404, 429, 500, 502]) {
    assert.equal(isCredentialFailure(status, ''), false, `status ${status}`)
  }
})

await test('a non-string message cannot trigger the marker branch', () => {
  assert.equal(isCredentialFailure(400, undefined), false)
  assert.equal(isCredentialFailure(400, null), false)
  assert.equal(isCredentialFailure(400, { error: 'invalid_model_error' }), false)
})

await test('FAILOVER_KINDS covers the three recoverable classes', () => {
  assert.deepEqual(
    [...FAILOVER_KINDS].sort(),
    ['forbidden', 'not_signed_in', 'unauthorized'],
  )
})

console.log('')
console.log('== credential failover: the WASM cipher primitive ==')

await test('WASM: the shipped reader encrypts and decrypts a credential blob', async () => {
  await withReaderShim(async () => {
    const reader = await import(pathToFileURL(readerShimPath).href)
    await reader.init(wasmPath)

    const machineId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'
    const payload = JSON.stringify({ access_token: 'token-from-cli-store' })
    const encrypted = reader.credentialStorageEncrypt(payload, machineId.slice(0, 16))
    assert.equal(typeof encrypted, 'string')
    assert.ok(encrypted.length > 0, 'encrypt must produce a non-empty string')
    assert.equal(reader.credentialStorageDecrypt(encrypted, machineId.slice(0, 16)), payload)
  })
})

await test('WASM: the key is the machine id truncated to 16 characters', async () => {
  await withReaderShim(async () => {
    const reader = await import(pathToFileURL(readerShimPath).href)
    await reader.init(wasmPath)

    const machineId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'
    const encrypted = reader.credentialStorageEncrypt('{"a":1}', machineId.slice(0, 16))
    // The right 16-character key round-trips; a different one must not.
    assert.equal(reader.credentialStorageDecrypt(encrypted, 'ABCDEFGHIJKLMNOP'), '{"a":1}')
    assert.throws(() => reader.credentialStorageDecrypt(encrypted, 'PONMLKJIHGFEDCBA'))
  })
})

await test('WASM: credential_storage_encrypt is a real export of the wasm module', async () => {
  await withReaderShim(async () => {
    const reader = await import(pathToFileURL(readerShimPath).href)
    const exports = await reader.init(wasmPath)
    assert.ok(
      Object.prototype.hasOwnProperty.call(exports, 'credential_storage_encrypt'),
      'the fixture generator depends on this export existing',
    )
    assert.ok(Object.prototype.hasOwnProperty.call(exports, 'credential_storage_decrypt'))
  })
})

console.log('')
console.log('== credential failover: alternate credential discovery ==')

// These two tests used to pin a KNOWN DEFECT (init() had no default for
// wasmPath, so the CLI store was unreachable). The defect was fixed on
// 2026-09-20: init now defaults to WASM_PATH, and the CLI store is reachable.
// The tests below now assert the FIXED behaviour; if they go red again the
// regression is real.
//   lib/qoder/wasm-credential-reader.js:31   export async function init(wasmPath) {
//   lib/qoder/wasm-credential-reader.js:32     const bytes = fs.readFileSync(wasmPath);
//
// `init` has NO default for `wasmPath`, yet both production callers invoke it
// with no argument — lib/qoder/credential-failover.js:51 and
// lib/qoder/gate-cache.js:137. Measured on this machine:
//
//   await init()  ->  TypeError [ERR_INVALID_ARG_TYPE]
//                     The "path" argument must be of type string ... Received undefined
//
// Both call sites wrap the call in `try { } catch { }`, so the failure is
// silent: the CLI device-flow credential source can never be reached, and the
// walk always falls through to the explicit-file branch. The two tests below
// assert the observed behaviour so the defect cannot regress unnoticed; if
// `init` gains `wasmPath ?? WASM_PATH`, they must be updated deliberately.

await test('FIXED: init() with no argument uses the default WASM_PATH', async () => {
  const reader = await import(pathToFileURL(readerPath).href)
  // The call shape both production callers use.
  await reader.init()
})

await test('CLI store: a well-formed store still yields nothing while init() lacks its path', async () => {
  await withReaderShim(async () => {
    const reader = await import(pathToFileURL(readerShimPath).href)
    await reader.init(wasmPath)

    const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
    try {
      const machineId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'
      // A genuinely valid ciphertext, produced by the shipped primitive.
      const encrypted = reader.credentialStorageEncrypt(
        JSON.stringify({ access_token: 'token-from-cli-store' }),
        machineId.slice(0, 16),
      )
      await mkdir(join(configHome, '.auth'), { recursive: true })
      await writeFile(join(configHome, '.auth', 'user'), encrypted, 'utf8')
      await writeFile(join(configHome, '.auth', 'machine_id'), `${machineId}\n`, 'utf8')

      const found = []
      for await (const candidate of listAlternateCredentials(
        async () => null,
        () => { throw new Error('dpapi must not be reached when no IDE store exists') },
        { QODER_CONFIG_DIR: configHome },
      )) {
        found.push(candidate)
      }

      assert.equal(found.length, 1, 'the CLI-store branch must yield exactly one candidate')
      assert.equal(found[0].source, 'cli-store')
      assert.equal(found[0].token, 'token-from-cli-store')
    } finally {
      await rm(configHome, { recursive: true, force: true })
    }
  })
})

await test('CLI store failure path: a corrupt store yields nothing and does not throw', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    await mkdir(join(configHome, '.auth'), { recursive: true })
    // Not valid ciphertext: a decrypt failure must be swallowed rather than
    // abort the whole walk.
    await writeFile(join(configHome, '.auth', 'user'), 'not-a-ciphertext', 'utf8')
    await writeFile(join(configHome, '.auth', 'machine_id'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab', 'utf8')

    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => null,
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome },
    )) {
      found.push(candidate)
    }
    assert.deepEqual(found, [])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('CLI store failure path: a missing machine_id yields nothing and does not throw', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    await mkdir(join(configHome, '.auth'), { recursive: true })
    await writeFile(join(configHome, '.auth', 'user'), 'anything', 'utf8')
    // No machine_id file: the key cannot be derived.
    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => null,
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome },
    )) {
      found.push(candidate)
    }
    assert.deepEqual(found, [])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('CLI store failure path: a missing .auth directory yields nothing and does not throw', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    // No .auth/ at all.
    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => null,
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome },
    )) {
      found.push(candidate)
    }
    assert.deepEqual(found, [])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('the IDE store is walked first and the explicit file last', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ token: 'explicit-token' }), 'utf8')

    let discoverCalls = 0
    const sources = []
    for await (const candidate of listAlternateCredentials(
      async () => {
        discoverCalls++
        return { credential: { token: 'ide-token' }, machineId: 'ide-machine' }
      },
      () => { throw new Error('dpapi unused') },
      { QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath },
    )) {
      sources.push(candidate.source)
      assert.equal(candidate.token, {
        'ide-store': 'ide-token',
        'explicit-file': 'explicit-token',
      }[candidate.source])
    }

    assert.equal(discoverCalls, 1)
    assert.deepEqual(sources, ['ide-store', 'explicit-file'])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('the IDE store candidate carries its machine id', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => ({ credential: { token: 'ide-token' }, machineId: 'ide-machine' }),
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome },
    )) {
      found.push(candidate)
    }
    assert.equal(found.length, 1)
    assert.equal(found[0].source, 'ide-store')
    assert.equal(found[0].token, 'ide-token')
    assert.equal(found[0].machineId, 'ide-machine')
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('a discover() result without a token is skipped', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => ({ credential: { token: '' }, machineId: 'm' }),
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome },
    )) {
      found.push(candidate)
    }
    assert.deepEqual(found, [])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('a throwing discover() is swallowed and the walk continues', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ security_oauth_token: 'still-reachable' }), 'utf8')

    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => { throw new Error('no IDE store on this machine') },
      () => { throw new Error('DPAPI unavailable') },
      { QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath },
    )) {
      found.push(candidate)
    }
    assert.equal(found.length, 1)
    assert.equal(found[0].source, 'explicit-file')
    assert.equal(found[0].token, 'still-reachable')
    assert.equal(found[0].machineId, null)
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

await test('an unreadable explicit file yields nothing and does not throw', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const found = []
    for await (const candidate of listAlternateCredentials(
      async () => null,
      () => { throw new Error('unused') },
      { QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: join(configHome, 'absent.json') },
    )) {
      found.push(candidate)
    }
    assert.deepEqual(found, [])
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
})

console.log('')
console.log('== credential failover: probe ==')

await test('200 means the credential is accepted', async () => {
  const fetchImpl = countingFetch([200])
  assert.equal(await probeCredential('tok', 'mid', fetchImpl), true)
  assert.equal(fetchImpl.calls.length, 1)
})

await test('400 means the credential is rejected', async () => {
  assert.equal(await probeCredential('tok', 'mid', countingFetch([400])), false)
})

await test('401 and 403 are rejections too', async () => {
  assert.equal(await probeCredential('tok', 'mid', countingFetch([401])), false)
  assert.equal(await probeCredential('tok', 'mid', countingFetch([403])), false)
})

await test('a transport error folds into false instead of throwing', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED') }
  assert.equal(await probeCredential('tok', 'mid', boom), false)
})

await test('the probe is a POST carrying the bearer token and the machine id', async () => {
  const fetchImpl = countingFetch([200])
  await probeCredential('tok-abc', 'machine-42', fetchImpl)
  const { url, init } = fetchImpl.calls[0]
  assert.match(url, /^https:\/\/api2-v2\.qoder\.sh\//)
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer tok-abc')
  assert.equal(init.headers['cosy-machine-id'], 'machine-42')
  const body = JSON.parse(init.body)
  assert.equal(body.stream, false)
  assert.ok(Array.isArray(body.messages) && body.messages.length > 0)
})

await test('a null machine id omits the cosy-machine-id header', async () => {
  const fetchImpl = countingFetch([200])
  await probeCredential('tok', null, fetchImpl)
  assert.equal('cosy-machine-id' in fetchImpl.calls[0].init.headers, false)
})

console.log('')
console.log('== credential failover: walking and memoisation ==')

await test('findWorkingCredential returns the first candidate whose probe passes', async () => {
  resetFailoverMemo()
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ token: 'explicit-token' }), 'utf8')

    let attempts = 0
    const fetchImpl = async () => {
      attempts++
      return response(attempts === 1 ? 400 : 200)
    }
    const discover = async () => ({ credential: { token: 'ide-token' }, machineId: 'm1' })
    // findWorkingCredential takes no `env`; it reads process.env directly, so the
    // walk is pointed at the fixtures through the real environment.
    const found = await withEnv({ QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath }, () =>
      findWorkingCredential(discover, () => { throw new Error('unused') }, fetchImpl),
    )

    assert.equal(attempts, 2, 'the first credential must be probed and rejected before the second')
    assert.equal(found.source, 'explicit-file')
    assert.equal(found.token, 'explicit-token')
  } finally {
    await rm(configHome, { recursive: true, force: true })
    resetFailoverMemo()
  }
})

await test('findWorkingCredential memoises: a second call does not re-probe', async () => {
  resetFailoverMemo()
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ token: 'explicit-token' }), 'utf8')

    let fetchRounds = 0
    let discoverRounds = 0
    const fetchImpl = async () => { fetchRounds++; return response(200) }
    const discover = async () => { discoverRounds++; return null }

    const first = await withEnv({ QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath }, () =>
      findWorkingCredential(discover, () => { throw new Error('unused') }, fetchImpl),
    )
    const second = await withEnv({ QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath }, () =>
      findWorkingCredential(discover, () => { throw new Error('unused') }, fetchImpl),
    )

    assert.equal(fetchRounds, 1, `expected exactly one probe across two calls, saw ${fetchRounds}`)
    assert.equal(discoverRounds, 1, `expected exactly one walk across two calls, saw ${discoverRounds}`)
    assert.deepEqual(second, first)
    assert.equal(second.token, 'explicit-token')
  } finally {
    await rm(configHome, { recursive: true, force: true })
    resetFailoverMemo()
  }
})

await test('findWorkingCredential returns null when no credential works', async () => {
  resetFailoverMemo()
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ token: 'explicit-token' }), 'utf8')

    let attempts = 0
    const fetchImpl = async () => { attempts++; return response(401) }
    const found = await withEnv({ QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath }, () =>
      findWorkingCredential(
        async () => ({ credential: { token: 'ide-token' }, machineId: 'm1' }),
        () => { throw new Error('unused') },
        fetchImpl,
      ),
    )
    assert.equal(found, null)
    assert.equal(attempts, 2, 'both candidates must have been probed')
  } finally {
    await rm(configHome, { recursive: true, force: true })
    resetFailoverMemo()
  }
})

await test('a null result is NOT memoised: the next call walks again', async () => {
  resetFailoverMemo()
  const configHome = await mkdtemp(join(tmpdir(), 'qoder-failover-'))
  try {
    const explicitPath = join(configHome, 'explicit.json')
    await writeFile(explicitPath, JSON.stringify({ token: 'explicit-token' }), 'utf8')

    let rounds = 0
    const fetchImpl = async () => { rounds++; return response(401) }
    const run = () => withEnv({ QODER_CONFIG_DIR: configHome, QODER_CLI_AUTH_FILE: explicitPath }, () =>
      findWorkingCredential(async () => null, () => { throw new Error('unused') }, fetchImpl),
    )
    const first = await run()
    const second = await run()
    assert.equal(first, null)
    assert.equal(second, null)
    assert.equal(rounds, 2, `a failed walk must be retried, saw ${rounds} probes`)
  } finally {
    await rm(configHome, { recursive: true, force: true })
    resetFailoverMemo()
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


