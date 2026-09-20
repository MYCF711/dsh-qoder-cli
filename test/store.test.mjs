// RED tests for the credential store and the stream relay.
//
// The store's risky parts are: (a) it must never write to Qoder's own files,
// (b) it must prefer a fresher copy on either side, (c) a refresh failure must
// degrade to the still-valid cached token rather than throwing into a request.
//
// The relay's risky part is that Qoder reports failures inside an HTTP 200
// stream, so the relay must surface in-band error frames as failures.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
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

const storeMod = await import('../lib/qoder/store.js').catch((e) => ({ __err: e }))
const relayMod = await import('../lib/qoder/relay.js').catch((e) => ({ __err: e }))

if (storeMod.__err) {
  console.log(`== credential store ==`)
  console.log(`  FAIL import lib/qoder/store.js :: ${storeMod.__err.code ?? storeMod.__err.message}`)
  fail++
} else {
  console.log('== credential store ==')
  const { QoderCredentialStore } = storeMod

  const valid = {
    schemaVersion: 1,
    token: 'dt-TOKEN-1',
    refreshToken: 'drt-RT-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2031-01-01T00:00:00.000Z',
    user: { id: 'u1', name: 'tester' },
  }

  await test('resolves the discovered credential when no copy exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const store = new QoderCredentialStore({
        ownPath: join(dir, 'own.json'),
        discover: async () => ({ credential: valid, machineId: 'm1', dir: '/qoder' }),
        refresh: async () => { throw new Error('must not refresh a fresh credential') },
      })
      const resolved = await store.resolve()
      assert.equal(resolved.credential.token, 'dt-TOKEN-1')
      assert.equal(resolved.machineId, 'm1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('persists its own copy without touching the discovered dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const ownPath = join(dir, 'own.json')
      const store = new QoderCredentialStore({
        ownPath,
        discover: async () => ({ credential: valid, machineId: 'm1', dir: '/qoder' }),
        refresh: async () => { throw new Error('no refresh needed') },
      })
      await store.resolve()
      await store.saveOwn(valid)
      const written = JSON.parse(await readFile(ownPath, 'utf8'))
      assert.equal(written.credential.token, 'dt-TOKEN-1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('prefers the discovered credential when it is newer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const ownPath = join(dir, 'own.json')
      await writeFile(ownPath, JSON.stringify({
        credential: { ...valid, token: 'dt-OLD' },
        machineId: 'm1',
        savedAt: '2020-01-01T00:00:00.000Z',
      }))
      const store = new QoderCredentialStore({
        ownPath,
        discover: async () => ({
          credential: { ...valid, token: 'dt-NEW' },
          machineId: 'm1',
          dir: '/qoder',
        }),
        refresh: async () => { throw new Error('no refresh needed') },
      })
      const resolved = await store.resolve()
      assert.equal(resolved.credential.token, 'dt-NEW')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('degrades to the cached token when refresh throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const store = new QoderCredentialStore({
        ownPath: join(dir, 'own.json'),
        discover: async () => ({
          // Already expired, so a refresh will be attempted.
          credential: { ...valid, expiresAt: '2000-01-01T00:00:00.000Z' },
          machineId: 'm1',
          dir: '/qoder',
        }),
        refresh: async () => { throw new Error('refresh endpoint unreachable') },
      })
      const resolved = await store.resolve()
      assert.equal(resolved.credential.token, 'dt-TOKEN-1', 'must keep serving the cached token')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('adopts a refreshed token when refresh succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const store = new QoderCredentialStore({
        ownPath: join(dir, 'own.json'),
        discover: async () => ({
          credential: { ...valid, expiresAt: '2000-01-01T00:00:00.000Z' },
          machineId: 'm1',
          dir: '/qoder',
        }),
        refresh: async () => ({ ...valid, token: 'dt-REFRESHED', expiresAt: '2030-01-01T00:00:00.000Z' }),
      })
      const resolved = await store.resolve()
      assert.equal(resolved.credential.token, 'dt-REFRESHED')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('throws a typed not-signed-in error when nothing is discoverable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-store-'))
    try {
      const store = new QoderCredentialStore({
        ownPath: join(dir, 'own.json'),
        discover: async () => null,
        refresh: async () => { throw new Error('n/a') },
      })
      await assert.rejects(() => store.resolve(), /not signed in/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

if (relayMod.__err) {
  console.log('== stream relay ==')
  console.log(`  FAIL import lib/qoder/relay.js :: ${relayMod.__err.code ?? relayMod.__err.message}`)
  fail++
} else {
  console.log('== stream relay ==')
  const { QoderUpstreamClient } = relayMod

  /** Build an SSE body from raw frames. */
  const sse = (...frames) => frames.join('\n\n') + '\n\n'

  await test('returns ok for a normal completion stream', async () => {
    const client = new QoderUpstreamClient({
      fetchImpl: async () => new Response(
        sse(
          'data: {"choices":[{"delta":{"content":"hi"}}]}',
          'data: [DONE]',
        ),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    })
    const result = await client.chatStream({ credential: { token: 't' }, machineId: 'm' }, { model: 'auto' })
    assert.equal(result.ok, true, JSON.stringify(result))
  })

  await test('treats an in-band error frame on a 200 as a failure', async () => {
    const client = new QoderUpstreamClient({
      fetchImpl: async () => new Response(
        sse('event: error\ndata: {"code":"invalid_model_error","message":"Unsupported model \\"nope\\""}'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    })
    const result = await client.chatStream({ credential: { token: 't' }, machineId: 'm' }, { model: 'nope' })
    assert.equal(result.ok, false, 'a 200 carrying event:error must not read as success')
    assert.match(result.message, /Unsupported model/)
  })

  await test('classifies an upstream 401 as auth_error', async () => {
    const client = new QoderUpstreamClient({
      fetchImpl: async () => new Response('nope', { status: 401 }),
    })
    const result = await client.chatStream({ credential: { token: 't' }, machineId: 'm' }, { model: 'auto' })
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'auth_error')
  })

  await test('classifies an upstream 429 as rate_limit', async () => {
    const client = new QoderUpstreamClient({
      fetchImpl: async () => new Response('slow down', { status: 429 }),
    })
    const result = await client.chatStream({ credential: { token: 't' }, machineId: 'm' }, { model: 'auto' })
    assert.equal(result.kind, 'rate_limit')
  })

  await test('classifies a 500 as server_error', async () => {
    const client = new QoderUpstreamClient({
      fetchImpl: async () => new Response('boom', { status: 503 }),
    })
    const result = await client.chatStream({ credential: { token: 't' }, machineId: 'm' }, { model: 'auto' })
    assert.equal(result.kind, 'server_error')
  })

  await test('posts to the verified global endpoint by default', async () => {
    let seen = null
    const client = new QoderUpstreamClient({
      fetchImpl: async (url, init) => {
        seen = { url, init }
        return new Response(sse('data: [DONE]'), { status: 200 })
      },
    })
    await client.chatStream({ credential: { token: 'TOK' }, machineId: 'MACH' }, { model: 'auto' })
    assert.equal(seen.url, 'https://api2-v2.qoder.sh/model/v1/chat/completions')
    assert.equal(seen.init.headers.Authorization, 'Bearer TOK')
    assert.equal(seen.init.headers['Cosy-MachineId'], 'MACH')
    assert.equal(seen.init.method, 'POST')
    assert.equal(typeof seen.init.headers['X-Request-ID'], 'string', 'a request id must be sent')
  })
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
