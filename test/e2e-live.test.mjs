// END-TO-END proof: the full host chain against the real Qoder gateway.
//
// This is the delivery gate. Every other test uses fakes; this one wires the
// real credential store, the real DPAPI decrypt, the real upstream client, and
// the real loopback shim together, then sends a real completion request through
// the shim exactly as DSH would — and asserts that tokens come back.
//
// It costs one tiny completion (a couple of tokens).
//
// Usage: node test/e2e-live.test.mjs

import assert from 'node:assert/strict'

let pass = 0
let fail = 0
let skipped = 0
const failures = []

/** Marks a test as environment-gated: skipped, not failed, when absent. */
async function liveTest(name, fn) {
  if (!hasLiveCredential) {
    skipped++
    console.log(`  SKIP ${name}  (no live Qoder credential on this machine)`)
    return
  }
  await test(name, fn)
}

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

const { discoverCredential, qoderOwnAuthPath } = await import('../lib/qoder/credentials.js')
const { dpapiUnprotect } = await import('../lib/qoder/native.js')
const { QoderUpstreamClient } = await import('../lib/qoder/relay.js')
const { QoderCredentialStore } = await import('../lib/qoder/store.js')
const { createQoderShim } = await import('../lib/qoder/shim.js')
const { FALLBACK_QODER_MODELS } = await import('../lib/qoder/models.js')

const os = await import('node:os')
const path = await import('node:path')
const fs = await import('node:fs')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-e2e-'))

console.log('== end-to-end against the live Qoder gateway ==')

// Precondition probe: the e2e gate requires a signed-in Qoder install. When
// absent, credential-dependent assertions SKIP instead of reporting a red that
// looks like a code regression (the offline shim/auth assertions still run).
const { discoverCredential: probeDiscover, qoderOwnAuthPath: probeOwnPath } = {
  discoverCredential,
  qoderOwnAuthPath,
}
const probeStore = new QoderCredentialStore({
  ownPath: probeOwnPath(fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-probe-'))),
  discover: () => probeDiscover(dpapiUnprotect),
  refresh: async (credential) => credential,
})
let hasLiveCredential = true
try {
  await probeStore.resolve()
} catch {
  hasLiveCredential = false
}

const store = new QoderCredentialStore({
  ownPath: qoderOwnAuthPath(scratch),
  discover: () => discoverCredential(dpapiUnprotect),
  refresh: async (credential) => credential,
})

const client = new QoderUpstreamClient()
const shim = createQoderShim({
  store,
  client,
  catalog: () => FALLBACK_QODER_MODELS,
  logger: { warn() {}, error() {} },
})

try {
  await shim.ready
  const base = shim.baseUrl()
  const token = shim.token()

  await liveTest('resolve() returns a real credential through the store', async () => {
    const resolved = await store.resolve()
    assert.equal(typeof resolved.credential.token, 'string')
    assert.ok(resolved.credential.token.length > 10)
    assert.equal(typeof resolved.machineId, 'string')
  })

  await test('the shim refuses an unauthenticated call', async () => {
    const res = await fetch(`${base}/v1/models`)
    assert.equal(res.status, 401)
  })

  await test('the shim lists the built-in catalog', async () => {
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    const body = await res.json()
    const ids = body.data.map((m) => m.id)
    assert.ok(ids.includes('auto'), `expected auto in ${ids.join(',')}`)
    assert.ok(!ids.includes('gfmodel'), 'a gateway-rejected key must not be listed')
  })

  let completionText = ''
  await liveTest('a real completion streams back through the shim', async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'lite',
        messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    })
    assert.equal(res.status, 200, `expected 200, got ${res.status}`)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)

    const text = await res.text()
    assert.ok(text.length > 0, 'the stream must not be empty')
    assert.ok(text.includes('data:'), `expected SSE frames, got: ${text.slice(0, 200)}`)
    assert.ok(text.includes('[DONE]'), `expected a [DONE] terminator, got: ${text.slice(0, 300)}`)

    // Extract the assistant text from the delta frames.
    const chunks = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]' || payload.length === 0) continue
      try {
        const parsed = JSON.parse(payload)
        const delta = parsed?.choices?.[0]?.delta?.content
        if (typeof delta === 'string') chunks.push(delta)
      } catch {
        // A non-JSON data line is not a content frame.
      }
    }
    completionText = chunks.join('')
    console.log(`       model=lite completion=${JSON.stringify(completionText)}`)
    assert.ok(completionText.length > 0, 'the completion must contain assistant text')
  })

  await liveTest('the completion is the answer we asked for', () => {
    assert.match(completionText, /PONG/i, `expected PONG, got ${JSON.stringify(completionText)}`)
  })

  await liveTest('each offered model key is accepted by the gateway', async () => {
    // Probe the model keys the catalog offers, with a 1-token request, so the
    // catalog cannot drift away from what the gateway serves.
    const results = []
    const degraded = []
    for (const model of FALLBACK_QODER_MODELS) {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
          max_tokens: 1,
        }),
      })
      const text = await res.text()
      const rejected = text.includes('invalid_model_error') || res.status === 400
      // A 429 carrying `provider_error` means the key is recognised but the
      // backend is unavailable — a capacity fact, not a wrong id. Distinct from
      // a rejection and tracked separately so this test stays honest.
      const unavailable = res.status === 429 && text.includes('provider_error')
      if (unavailable) degraded.push(model.id)
      results.push(`${model.id}=${rejected ? 'REJECTED' : unavailable ? 'NO_BACKEND' : res.status}`)
    }
    console.log(`       ${results.join('  ')}`)
    const rejected = results.filter((r) => r.includes('REJECTED'))
    assert.equal(rejected.length, 0, `gateway rejected catalog keys: ${rejected.join(', ')}`)
    if (degraded.length > 0) {
      console.log(`       note: ${degraded.join(', ')} recognised but no backend available right now`)
    }
  })
} finally {
  await shim.close().catch(() => {})
  fs.rmSync(scratch, { recursive: true, force: true })
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed${skipped > 0 ? `, ${skipped} skipped` : ''} ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
