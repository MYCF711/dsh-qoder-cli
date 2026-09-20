// Offline unit tests for lib/qoder/quota.js and the status.quota integration.
//
// Verifies:
// 1. fetchQuotaUsage happy path — correct URL/method/headers, JSON parsed, and
//    userQuota/addOnQuota reduced to {total, used, remaining, ...} fields;
// 2. failure policy — network error, non-OK status, unusable body, missing
//    blocks, and absent token all resolve to null (silent degradation);
// 3. buildStatus integration — status.quota present when quota resolves,
//    absent when it fails, and resolved concurrently with the credential.
//
// Run: node --test test/quota.test.mjs
// (or plain `node test/quota.test.mjs`; process.exitCode set below.)

import assert from 'node:assert/strict'

let pass = 0
let fail = 0
const failures = []

function testAsync(name, fn) {
  return (async () => {
    try {
      await fn()
      pass++
      console.log('  ok   ' + name)
    } catch (error) {
      fail++
      failures.push({ name, error })
      console.log('  FAIL ' + name)
      console.log('       ' + String(error && error.message).split('\n')[0])
    }
  })()
}

console.log('== qoder quota (offline) ==')

let quota = null
let web = null
try {
  quota = await import('../lib/qoder/quota.js')
  web = await import('../lib/qoder/web.js')
} catch (e) {
  console.log(`  FAIL import :: ${e.message}`)
  fail++
  failures.push({ name: 'import', error: e })
}

const SAMPLE = {
  userId: '00000000-0000-0000-0000-000000000000',
  userType: 'personal',
  usageType: 'credits',
  totalUsagePercentage: 12.5,
  isQuotaExceeded: false,
  expiresAt: 1790000000,
  userQuota: { total: 500, used: 62, remaining: 438, percentage: 12.5, unit: 'credits' },
  addOnQuota: { total: 1000, used: 0, remaining: 1000, percentage: 0, unit: 'credits', detailUrl: 'https://qoder.com/usage' },
}

function okFetch(body, { status = 200 } = {}) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }
  }
  return { impl, calls }
}

if (quota && web) {
  const { fetchQuotaUsage } = quota
  const { buildStatus } = web

  // ------------------------------
  // GROUP 1: fetchQuotaUsage happy path
  // ------------------------------
  await testAsync('fetchQuotaUsage: GET openapi base + path with Bearer and Accept headers', async () => {
    const { impl, calls } = okFetch(SAMPLE)
    const result = await fetchQuotaUsage('tok-123', { fetchImpl: impl })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://openapi.qoder.sh/api/v2/quota/usage')
    assert.equal(calls[0].init.method, undefined, 'fetch defaults to GET; method must not be set')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-123')
    assert.equal(calls[0].init.headers.Accept, 'application/json')
    assert.ok(result !== null)
  })

  await testAsync('fetchQuotaUsage: reduces userQuota/addOnQuota to total/used/remaining(+meta)', async () => {
    const { impl } = okFetch(SAMPLE)
    const result = await fetchQuotaUsage('tok-123', { fetchImpl: impl })
    assert.deepEqual(result.userQuota, { total: 500, used: 62, remaining: 438, percentage: 12.5, unit: 'credits' })
    assert.deepEqual(result.addOnQuota, { total: 1000, used: 0, remaining: 1000, percentage: 0, unit: 'credits', detailUrl: 'https://qoder.com/usage' })
    assert.equal(result.userId, SAMPLE.userId)
    assert.equal(result.totalUsagePercentage, 12.5)
    assert.equal(result.isQuotaExceeded, false)
    assert.equal(typeof result.fetchedAt, 'string')
  })

  await testAsync('fetchQuotaUsage: tolerates snake_case aliases', async () => {
    const { impl } = okFetch({
      user_id: 'u1',
      user_type: 'personal',
      user_quota: { total: 10, used: 1, remaining: 9 },
      add_on_quota: { total: 20, used: 2, remaining: 18 },
    })
    const result = await fetchQuotaUsage('tok', { fetchImpl: impl })
    assert.deepEqual(result.userQuota, { total: 10, used: 1, remaining: 9 })
    assert.deepEqual(result.addOnQuota, { total: 20, used: 2, remaining: 18 })
  })

  await testAsync('fetchQuotaUsage: region cn picks openapi.qoder.com.cn', async () => {
    const { impl, calls } = okFetch(SAMPLE)
    await fetchQuotaUsage('tok', { region: 'cn', fetchImpl: impl })
    assert.equal(calls[0].url, 'https://openapi.qoder.com.cn/api/v2/quota/usage')
  })

  // ------------------------------
  // GROUP 2: failure policy — everything degrades to null
  // ------------------------------
  await testAsync('fetchQuotaUsage: network error → null', async () => {
    const result = await fetchQuotaUsage('tok', { fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
    assert.equal(result, null)
  })

  await testAsync('fetchQuotaUsage: 401 → null', async () => {
    const { impl } = okFetch({}, { status: 401 })
    assert.equal(await fetchQuotaUsage('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchQuotaUsage: 500 → null', async () => {
    const { impl } = okFetch({}, { status: 500 })
    assert.equal(await fetchQuotaUsage('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchQuotaUsage: invalid JSON body → null', async () => {
    const impl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid json') } })
    assert.equal(await fetchQuotaUsage('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchQuotaUsage: body without quota blocks → null', async () => {
    const { impl } = okFetch({ userId: 'u1' })
    assert.equal(await fetchQuotaUsage('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchQuotaUsage: non-finite numbers dropped; empty blocks → null', async () => {
    const { impl } = okFetch({ userQuota: { total: 'x', used: null }, addOnQuota: {} })
    assert.equal(await fetchQuotaUsage('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchQuotaUsage: absent/empty token → null without any fetch', async () => {
    let called = 0
    const impl = async () => { called++; return { ok: true, status: 200, json: async () => ({}) } }
    assert.equal(await fetchQuotaUsage(undefined, { fetchImpl: impl }), null)
    assert.equal(await fetchQuotaUsage('', { fetchImpl: impl }), null)
    assert.equal(called, 0)
  })

  // ------------------------------
  // GROUP 2b: fetchUsageStats (usage presentation, /sash/api/v2/me/usage)
  // ------------------------------
  const { fetchUsageStats } = quota
  const USAGE_PRESENTATION = {
    displayMode: 'qoder',
    qoderUsage: {
      userId: 'u1',
      userType: 'personal_professional_trial',
      usageType: 'credits',
      totalUsagePercentage: 0.82,
      isQuotaExceeded: false,
      isPlanQuotaProrated: false,
      expiresAt: 1790924191537,
      upgradeUrl: 'https://qoder.com/pricing?client=qoder',
      userQuota: { total: 300, used: 300, remaining: 0, percentage: 1, unit: 'credits' },
      addOnQuota: { total: 200, used: 109, remaining: 91, percentage: 0.55, unit: 'credits', detailUrl: 'https://qoder.com/account/usage' },
    },
  }

  await testAsync('fetchUsageStats: GET /sash/api/v2/me/usage and unwraps qoderUsage', async () => {
    const { impl, calls } = okFetch(USAGE_PRESENTATION)
    const result = await fetchUsageStats('tok', { fetchImpl: impl })
    assert.equal(calls[0].url, 'https://openapi.qoder.sh/sash/api/v2/me/usage')
    assert.ok(result !== null)
    assert.deepEqual(result.userQuota, { total: 300, used: 300, remaining: 0, percentage: 1, unit: 'credits' })
    assert.deepEqual(result.addOnQuota, { total: 200, used: 109, remaining: 91, percentage: 0.55, unit: 'credits', detailUrl: 'https://qoder.com/account/usage' })
    assert.equal(result.upgradeUrl, 'https://qoder.com/pricing?client=qoder')
    assert.equal(result.isPlanQuotaProrated, false)
    assert.equal(typeof result.fetchedAt, 'string')
  })

  await testAsync('fetchUsageStats: enterprise displayMode (no accounting) → null', async () => {
    const { impl } = okFetch({ displayMode: 'enterprise', enterpriseUsage: { openMode: 'externalBrowser', detailUrl: 'https://x' } })
    assert.equal(await fetchUsageStats('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchUsageStats: 401 → null', async () => {
    const { impl } = okFetch({}, { status: 401 })
    assert.equal(await fetchUsageStats('tok', { fetchImpl: impl }), null)
  })

  await testAsync('fetchUsageStats: network error → null', async () => {
    const result = await fetchUsageStats('tok', { fetchImpl: async () => { throw new Error('down') } })
    assert.equal(result, null)
  })

  await testAsync('fetchUsageStats: absent token → null without fetch', async () => {
    let called = 0
    const impl = async () => { called++; return { ok: true, status: 200, json: async () => ({}) } }
    assert.equal(await fetchUsageStats('', { fetchImpl: impl }), null)
    assert.equal(called, 0)
  })

  // ------------------------------
  // GROUP 3: buildStatus integration
  // ------------------------------
  function mockDeps({ token = 'tok-123', quotaImpl } = {}) {
    return {
      provider: 'qoder',
      region: () => 'global',
      settingsWritable: () => true,
      models: () => [{ id: 'm1', name: 'M1' }],
      enabledModels: () => [],
      modelOptions: () => ({}),
      store: {
        resolve: async () => ({
          credential: {
            token,
            refreshToken: 'r',
            expiresAt: '2026-10-01T00:00:00.000Z',
            user: { id: 'u1', name: 'Alice', email: 'a@b.c', avatarUrl: 'x' },
          },
          machineId: 'mid',
        }),
        saveOwn: async () => {},
        invalidate: () => {},
      },
      ...(quotaImpl ? { fetchQuotaUsage: quotaImpl } : {}),
    }
  }

  await testAsync('buildStatus: quota field present with resolved blocks when API succeeds', async () => {
    // The integration imports fetchQuotaUsage directly, so mock at network level.
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    const seenUrls = []
    globalThis.fetch = async (url, init) => {
      seenUrls.push(String(url))
      if (String(url).includes('/api/v2/quota/usage')) {
        return { ok: true, status: 200, json: async () => SAMPLE }
      }
      return { ok: true, status: 200, json: async () => ({ displayMode: 'enterprise', enterpriseUsage: {} }) }
    }
    try {
      const status = await buildStatus(deps)
      assert.ok(seenUrls.includes('https://openapi.qoder.sh/api/v2/quota/usage'), 'quota endpoint must be requested')
      assert.ok(status.quota, 'status.quota must be present')
      assert.equal(status.quota.userQuota.total, 500)
      assert.equal(status.quota.userQuota.used, 62)
      assert.equal(status.quota.userQuota.remaining, 438)
      assert.equal(status.quota.addOnQuota.total, 1000)
      assert.equal(status.quota.addOnQuota.remaining, 1000)
      assert.equal(status.signed_in, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: quota field absent when quota API fails (silent)', async () => {
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('network down') }
    try {
      const status = await buildStatus(deps)
      assert.equal(status.quota, undefined, 'failed quota must be omitted, never an error field')
      assert.equal(status.signed_in, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: no quota fetch when credential carries no token', async () => {
    const deps = mockDeps({ token: '' })
    let called = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { called++; return { ok: true, status: 200, json: async () => SAMPLE } }
    try {
      const status = await buildStatus(deps)
      assert.equal(called, 0, 'no network call without a token')
      assert.equal(status.quota, undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: signed-out status has no quota and resolves fast', async () => {
    const deps = mockDeps()
    deps.store.resolve = async () => { throw new Error('no credential found') }
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('should not be called') }
    try {
      const status = await buildStatus(deps)
      assert.equal(status.signed_in, false)
      assert.equal(status.quota, undefined)
      assert.equal(status.error, 'no credential found')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: usage field present when me/usage succeeds', async () => {
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    const seen = []
    globalThis.fetch = async (url) => {
      seen.push(String(url))
      if (String(url).includes('/sash/api/v2/me/usage')) {
        return { ok: true, status: 200, json: async () => USAGE_PRESENTATION }
      }
      return { ok: true, status: 200, json: async () => SAMPLE }
    }
    try {
      const status = await buildStatus(deps)
      assert.ok(seen.some((u) => u.includes('/sash/api/v2/me/usage')), 'me/usage must be requested')
      assert.ok(status.usage, 'status.usage must be present')
      assert.equal(status.usage.userQuota.total, 300)
      assert.equal(status.usage.addOnQuota.remaining, 91)
      assert.equal(status.usage.upgradeUrl, 'https://qoder.com/pricing?client=qoder')
      assert.ok(status.quota, 'quota stays present alongside usage')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: usage field absent when me/usage fails (silent)', async () => {
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).includes('/sash/api/v2/me/usage')) {
        return { ok: true, status: 200, json: async () => ({ displayMode: 'enterprise', enterpriseUsage: {} }) }
      }
      return { ok: true, status: 200, json: async () => SAMPLE }
    }
    try {
      const status = await buildStatus(deps)
      assert.equal(status.usage, undefined, 'failed usage must be omitted')
      assert.ok(status.quota, 'quota unaffected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
} else {
  console.log('  SKIP all quota tests (import failed)')
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
