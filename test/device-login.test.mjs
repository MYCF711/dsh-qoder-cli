/**
 * Tests for the device login flow (offline, fetch injected).
 *
 * @module dsh-qoder-cli/test/device-login
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  buildCredentialFromDeviceLogin,
  createDeviceLoginAttempt,
  fetchUserInfo,
  pollDeviceToken,
  QoderDeviceLoginError,
  waitForDeviceToken,
} from '../lib/qoder/device-login.js'
import { createDeviceLoginRegistry } from '../lib/qoder/web.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('attempt: url carries challenge/nonce/client_id, S256(verifier)', () => {
  const attempt = createDeviceLoginAttempt({ machineId: 'test-machine' })
  const url = new URL(attempt.url)
  assert.equal(url.origin + url.pathname, 'https://qoder.com/device/selectAccounts')
  assert.equal(url.searchParams.get('client_id'), '732aef47-9cf2-46a2-95fe-4cebb5d0d1fa')
  assert.equal(url.searchParams.get('challenge_method'), 'S256')
  assert.equal(url.searchParams.get('machine_id'), 'test-machine')
  assert.equal(
    url.searchParams.get('challenge'),
    createHash('sha256').update(attempt.verifier, 'utf8').digest('base64url'),
  )
  assert.ok(attempt.nonce.length > 0)
})

test('pollDeviceToken: 404 → pending', async () => {
  const attempt = createDeviceLoginAttempt({})
  const result = await pollDeviceToken(attempt, {
    fetchImpl: async () => ({ status: 404, ok: false }),
  })
  assert.deepEqual(result, { status: 'pending' })
})

test('pollDeviceToken: token body → complete', async () => {
  const attempt = createDeviceLoginAttempt({})
  const result = await pollDeviceToken(attempt, {
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      json: async () => ({ token: 'dt-abc', refresh_token: 'drt-xyz' }),
    }),
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.payload.token, 'dt-abc')
})

test('pollDeviceToken: 500 → SERVER_ERROR', async () => {
  const attempt = createDeviceLoginAttempt({})
  await assert.rejects(
    pollDeviceToken(attempt, { fetchImpl: async () => ({ status: 500, ok: false }) }),
    (error) => error instanceof QoderDeviceLoginError && error.code === 'SERVER_ERROR',
  )
})

test('fetchUserInfo: maps aliases and requires id', async () => {
  const user = await fetchUserInfo('t', {
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      json: async () => ({ user_id: 'u1', username: 'tester', email: 'e@x.com', avatar: 'a.png' }),
    }),
  })
  assert.deepEqual(user, { id: 'u1', name: 'tester', email: 'e@x.com', avatarUrl: 'a.png' })

  await assert.rejects(
    fetchUserInfo('t', {
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ nope: 1 }) }),
    }),
    (error) => error instanceof QoderDeviceLoginError && error.code === 'SERVER_ERROR',
  )
})

test('waitForDeviceToken: completes when the token appears', async () => {
  const attempt = createDeviceLoginAttempt({})
  let calls = 0
  const payload = await waitForDeviceToken(
    attempt,
    {
      fetchImpl: async () => {
        calls += 1
        return calls < 3
          ? { status: 404, ok: false }
          : { status: 200, ok: true, json: async () => ({ token: 'dt-1', refresh_token: 'drt-1' }) }
      },
    },
  )
  assert.equal(payload.token, 'dt-1')
  assert.ok(calls >= 3)
})

test('waitForDeviceToken: abort → LOGIN_CANCELLED', async () => {
  const attempt = createDeviceLoginAttempt({})
  const controller = new AbortController()
  const promise = waitForDeviceToken(attempt, {
    signal: controller.signal,
    fetchImpl: async () => ({ status: 404, ok: false }),
  })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(
    promise,
    (error) => error instanceof QoderDeviceLoginError && error.code === 'LOGIN_CANCELLED',
  )
})

test('buildCredentialFromDeviceLogin: expires_in → ISO date, schema 1', () => {
  const fixed = new Date('2026-01-01T00:00:00Z')
  const credential = buildCredentialFromDeviceLogin(
    { token: 'dt-1', refresh_token: 'drt-1', expires_in: 3600 },
    { id: 'u1', name: 'tester' },
    { now: fixed },
  )
  assert.equal(credential.schemaVersion, 1)
  assert.equal(credential.expiresAt, '2026-01-01T01:00:00.000Z')
  assert.deepEqual(credential.user, { id: 'u1', name: 'tester' })
})

test('registry: start → pending with url; a fake completed flow → signed_in', async () => {
  const saved = []
  const store = {
    saveOwn: async (credential, machineId) => {
      saved.push({ credential, machineId })
    },
    invalidate: () => {},
  }
  let pollCalls = 0
  const registry = createDeviceLoginRegistry({
    store,
    resolveMachineId: () => 'machine-1',
    fetchImpl: async (url) => {
      const target = String(url)
      if (target.includes('/userinfo')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ id: 'u-live', name: 'Live User', email: 'live@x.com' }),
        }
      }
      pollCalls += 1
      return pollCalls < 2
        ? { status: 404, ok: false }
        : {
            status: 200,
            ok: true,
            json: async () => ({ token: 'dt-live', refresh_token: 'drt-live', expires_in: 3600 }),
          }
    },
  })

  const started = registry.start()
  assert.ok(started.url.includes('/device/selectAccounts'))

  let status = registry.pollStatus()
  assert.equal(status.state, 'pending')

  // Wait for the background loop to complete (fast: fake fetch, real 1s sleep).
  for (let i = 0; i < 15 && registry.pollStatus().state === 'pending'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  status = registry.pollStatus()
  assert.equal(status.state, 'signed_in')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].credential.token, 'dt-live')
  assert.equal(saved[0].machineId, 'machine-1')
})

test('registry: new start cancels the previous attempt', async () => {
  const registry = createDeviceLoginRegistry({
    store: { saveOwn: async () => {}, invalidate: () => {} },
    fetchImpl: async () => ({ status: 404, ok: false }),
  })
  registry.start()
  registry.start()
  const status = registry.pollStatus()
  assert.equal(status.state, 'pending')
  registry.cancel()
  assert.equal(registry.pollStatus().state, 'idle')
})

let failures = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  FAIL ${name}`)
    console.error(error)
  }
}
console.log(`\n== ${tests.length - failures} passed, ${failures} failed ==`)
if (failures === 0) console.log('ALL ASSERTIONS PASSED')
if (failures > 0) process.exit(1)
