// RED-FIRST test suite for the Qoder credential / model-catalog / wire core.
//
// These three modules are the novel, risky part of the plugin: everything else
// is assembly cloned from dsh-codebuddy-cli. Each test below names the exact
// observable behaviour the implementation must have.
//
// Run: node --test test/core.test.mjs
// (or plain `node test/core.test.mjs`; the file sets process.exitCode itself.)

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

async function testAsync(name, fn) {
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

console.log('== qoder constants ==')
const constants = await import('../lib/qoder/constants.js').catch((e) => ({ __err: e }))
if (constants.__err) {
  console.log(`  FAIL import lib/qoder/constants.js :: ${constants.__err.code ?? constants.__err.message}`)
  fail++
  failures.push({ name: 'import constants', error: constants.__err })
} else {
  test('provider id is the qoder route name', () => {
    assert.equal(constants.QODER_PROVIDER, 'qoder-cli')
  })
  test('settings namespace matches the provider', () => {
    assert.equal(constants.QODER_SETTINGS_NS, 'qoder-cli')
  })
  test('global chat host is the verified one', () => {
    assert.equal(constants.QODER_CHAT_HOST, 'api2-v2.qoder.sh')
  })
  test('chat path is the verified one', () => {
    assert.equal(constants.QODER_CHAT_PATH, '/model/v1/chat/completions')
  })
  test('the chat host has no region variant, matching the bundle', () => {
    // The Qoder bundle's host table carries no `.cn` entry, so a CN account
    // still reaches the gateway through `.qoder.sh`. A guessed CN host would be
    // a silent failure, so its absence is asserted.
    assert.ok(!('QODER_CHAT_HOSTS' in constants), 'per-region hosts must not exist')
    assert.equal(constants.QODER_MODEL_HOST_ENV, 'QODER_MODEL_SERVER_HOST')
  })

  test('every plugin web route lives under its own prefix', () => {
    for (const key of ['QODER_STATUS_PATH', 'QODER_MODELS_PATH']) {
      assert.ok(constants[key].startsWith('/plugins/dsh-qoder-cli/'), `${key} = ${constants[key]}`)
    }
  })
}

console.log('== qoder credential parsing ==')
const credMod = await import('../lib/qoder/credentials.js').catch((e) => ({ __err: e }))
if (credMod.__err) {
  console.log(`  FAIL import lib/qoder/credentials.js :: ${credMod.__err.code ?? credMod.__err.message}`)
  fail++
  failures.push({ name: 'import credentials', error: credMod.__err })
} else {
  const { parseQoderCredential } = credMod

  // Shape copied verbatim from the real decrypted file (see
  // docs/QODER-PROTOCOL-FINDINGS.md section 2).
  const valid = {
    schemaVersion: 1,
    token: 'dt-abcdefghijklmnopqrstuvw',
    refreshToken: 'drt-abcdefghijklmnopqrstuvw',
    expiresAt: '2026-10-18T06:56:16.000Z',
    refreshTokenExpiresAt: '2027-09-13T06:56:16.000Z',
    user: { id: '<USER_ID>', name: '<ACCOUNT_NAME>', email: 'a@b.c', avatarUrl: 'https://x' },
  }

  test('accepts the real credential shape', () => {
    const out = parseQoderCredential(valid)
    assert.ok(out, 'expected a parsed credential')
    assert.equal(out.token, valid.token)
    assert.equal(out.user.id, valid.user.id)
  })

  test('rejects a wrong schemaVersion', () => {
    assert.equal(parseQoderCredential({ ...valid, schemaVersion: 2 }), null)
  })

  test('rejects a non-string token', () => {
    assert.equal(parseQoderCredential({ ...valid, token: 12345 }), null)
  })

  test('rejects a missing refreshToken', () => {
    const { refreshToken, ...rest } = valid
    assert.equal(parseQoderCredential(rest), null)
  })

  test('rejects a user without id', () => {
    assert.equal(parseQoderCredential({ ...valid, user: { name: 'x' } }), null)
  })

  test('rejects null / undefined / a string', () => {
    assert.equal(parseQoderCredential(null), null)
    assert.equal(parseQoderCredential(undefined), null)
    assert.equal(parseQoderCredential('nope'), null)
  })

  test('accepts a credential without the optional profileOverlay', () => {
    assert.ok(parseQoderCredential(valid) !== null)
  })

  test('candidate user-data dirs include the real install location', () => {
    const dirs = credMod.candidateUserDataDirs({ APPDATA: 'C:\\Users\\X\\AppData\\Roaming' })
    assert.ok(
      dirs.some((d) => d.toLowerCase().includes('com.qoder.app.stable')),
      `expected a com.qoder.app.stable candidate, got ${JSON.stringify(dirs)}`,
    )
  })

  // Electron safeStorage framing: 'v10' | 12-byte nonce | ciphertext | 16-byte tag.
  test('decryptSafeStorage round-trips a v10 AES-256-GCM blob', async () => {
    const { createCipheriv, randomBytes } = await import('node:crypto')
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    const plaintext = Buffer.from(JSON.stringify({ hello: 'qoder' }), 'utf8')
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const blob = Buffer.concat([Buffer.from('v10', 'ascii'), nonce, body, cipher.getAuthTag()])
    const out = credMod.decryptSafeStorage(blob, key)
    assert.equal(out.toString('utf8'), plaintext.toString('utf8'))
  })

  test('decryptSafeStorage rejects a blob without the v10 prefix', () => {
    assert.throws(() => credMod.decryptSafeStorage(Buffer.alloc(40), Buffer.alloc(32)))
  })

  test('decryptSafeStorage rejects a tampered tag', async () => {
    const { createCipheriv, randomBytes } = await import('node:crypto')
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    const body = Buffer.concat([cipher.update(Buffer.from('x')), cipher.final()])
    const blob = Buffer.concat([Buffer.from('v10', 'ascii'), nonce, body, cipher.getAuthTag()])
    blob[blob.length - 1] ^= 0xff
    assert.throws(() => credMod.decryptSafeStorage(blob, key))
  })

  test('extractSafeStorageKey strips the DPAPI prefix before unprotecting', () => {
    const inner = Buffer.from('0123456789abcdef0123456789abcdef', 'ascii')
    const localState = JSON.stringify({
      os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI', 'ascii'), inner]).toString('base64') },
    })
    let seen = null
    const key = credMod.extractSafeStorageKey(localState, (buf) => {
      seen = buf
      return inner
    })
    assert.equal(seen.toString('ascii'), inner.toString('ascii'), 'unprotect must receive the key without the DPAPI prefix')
    assert.equal(key.length, 32)
  })

  test('extractSafeStorageKey rejects a blob without the DPAPI prefix', () => {
    const localState = JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('NOPE').toString('base64') } })
    assert.throws(() => credMod.extractSafeStorageKey(localState, () => Buffer.alloc(32)))
  })
}

console.log('== qoder model catalog ==')
const modelsMod = await import('../lib/qoder/models.js').catch((e) => ({ __err: e }))
if (modelsMod.__err) {
  console.log(`  FAIL import lib/qoder/models.js :: ${modelsMod.__err.code ?? modelsMod.__err.message}`)
  fail++
  failures.push({ name: 'import models', error: modelsMod.__err })
} else {
  const { FALLBACK_QODER_MODELS, filterEnabledModels } = modelsMod

  // Keys live-verified against api2-v2.qoder.sh; see
  // docs/QODER-PROTOCOL-FINDINGS.md section 4. The five keys the gateway
  // rejected must NOT be offered.
  const VERIFIED_KEYS = ['auto', 'lite', 'performance', 'ultimate', 'dmodel', 'gmodel', 'kmodel', 'mmodel', 'qmodel']
  const REJECTED_KEYS = ['dfmodel', 'gfmodel', 'kmodel_latest', 'qmodel_latest', 'qmodel_38max', 'qfmodel']

  test('catalog offers every live-verified key', () => {
    const ids = new Set(FALLBACK_QODER_MODELS.map((m) => m.id))
    for (const key of VERIFIED_KEYS) assert.ok(ids.has(key), `missing verified key ${key}`)
  })

  test('catalog omits every gateway-rejected key', () => {
    const ids = new Set(FALLBACK_QODER_MODELS.map((m) => m.id))
    for (const key of REJECTED_KEYS) assert.ok(!ids.has(key), `must not offer rejected key ${key}`)
  })

  test('every catalog entry is a usable pi-ai descriptor', () => {
    for (const m of FALLBACK_QODER_MODELS) {
      assert.equal(typeof m.id, 'string', `id of ${JSON.stringify(m)}`)
      assert.equal(typeof m.name, 'string', `name of ${m.id}`)
      assert.ok(m.contextWindow > 0, `contextWindow of ${m.id}`)
      assert.ok(m.maxTokens > 0, `maxTokens of ${m.id}`)
      assert.ok(Array.isArray(m.input) && m.input.includes('text'), `input of ${m.id}`)
    }
  })

  test('model ids are unique', () => {
    const ids = FALLBACK_QODER_MODELS.map((m) => m.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('an empty allowlist means "offer everything"', () => {
    assert.equal(filterEnabledModels(FALLBACK_QODER_MODELS, []).length, FALLBACK_QODER_MODELS.length)
  })

  test('a non-empty allowlist narrows to exactly those ids', () => {
    const out = filterEnabledModels(FALLBACK_QODER_MODELS, ['auto', 'dmodel'])
    assert.deepEqual(out.map((m) => m.id).sort(), ['auto', 'dmodel'])
  })

  test('an unknown id in the allowlist is ignored, not fatal', () => {
    const out = filterEnabledModels(FALLBACK_QODER_MODELS, ['auto', 'no-such-model'])
    assert.deepEqual(out.map((m) => m.id), ['auto'])
  })
}

console.log('== qoder wire protocol ==')
const wireMod = await import('../lib/qoder/wire.js').catch((e) => ({ __err: e }))
if (wireMod.__err) {
  console.log(`  FAIL import lib/qoder/wire.js :: ${wireMod.__err.code ?? wireMod.__err.message}`)
  fail++
  failures.push({ name: 'import wire', error: wireMod.__err })
} else {
  const { qoderChatUrl, qoderHeaders, prepareChatBody } = wireMod

  test('global chat url matches the live-verified endpoint', () => {
    assert.equal(qoderChatUrl({}), 'https://api2-v2.qoder.sh/model/v1/chat/completions')
  })

  test('the model host env var overrides the endpoint, as the bundle does', () => {
    assert.equal(
      qoderChatUrl({ QODER_MODEL_SERVER_HOST: 'example.internal:8443' }),
      'https://example.internal:8443/model/v1/chat/completions',
    )
  })

  test('a scheme and trailing slash in the override are tolerated', () => {
    assert.equal(
      qoderChatUrl({ QODER_MODEL_SERVER_HOST: 'https://example.internal/' }),
      'https://example.internal/model/v1/chat/completions',
    )
  })

  test('an empty override falls back to the verified host', () => {
    assert.equal(qoderChatUrl({ QODER_MODEL_SERVER_HOST: '   ' }), qoderChatUrl({}))
  })

  const cred = { token: 'dt-TOKEN', refreshToken: 'drt-RT', user: { id: 'u1' } }

  test('headers carry the bearer token', () => {
    const h = qoderHeaders(cred, 'machine-1')
    assert.equal(h.Authorization, 'Bearer dt-TOKEN')
  })

  test('headers carry the Cosy identity family observed on the wire', () => {
    const h = qoderHeaders(cred, 'machine-1')
    assert.equal(h['Cosy-ClientType'], '10')
    assert.equal(h['Cosy-Version'], '0.2.5')
    assert.equal(h['Cosy-MachineId'], 'machine-1')
  })

  test('headers set a Qoder user agent', () => {
    assert.equal(qoderHeaders(cred, 'm')['User-Agent'], 'Qoder')
  })

  test('headers omit the machine id when none is known', () => {
    const h = qoderHeaders(cred, null)
    assert.ok(!('Cosy-MachineId' in h), 'must not send an empty Cosy-MachineId')
  })

  test('prepareChatBody keeps the model and messages untouched', () => {
    const body = prepareChatBody(JSON.stringify({
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    }))
    assert.equal(body.model, 'auto')
    assert.equal(body.messages[0].content, 'hi')
    assert.equal(body.stream, true)
  })

  test('prepareChatBody throws on malformed json rather than sending garbage', () => {
    assert.throws(() => prepareChatBody('{not json'))
  })

  test('prepareChatBody refuses a body with no model', () => {
    assert.throws(() => prepareChatBody(JSON.stringify({ messages: [] })))
  })
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
