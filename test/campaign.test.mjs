// Offline unit tests for lib/qoder/campaign.js and the credits heatmap/summary
// clients, plus the status.campaign / status.creditsTimeline integration.
//
// Endpoints — VERIFIED (docs/API-RESEARCH-SIGNIN-USAGE.md §1–2, live probes):
//   GET /sash/api/v1/me/campaigns                             → campaign status
//   GET /sash/api/v1/ai-conversations/credits-heatmap?days=N  → per-day credits
//   GET /sash/api/v1/ai-conversations/credits-summary         → totals
//
// Run: node --test test/campaign.test.mjs
// (or plain `node test/campaign.test.mjs`; process.exitCode set below.)

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

console.log('== qoder campaign + credits timeline (offline) ==')

let campaign = null
let quota = null
let web = null
try {
  campaign = await import('../lib/qoder/campaign.js')
  quota = await import('../lib/qoder/quota.js')
  web = await import('../lib/qoder/web.js')
} catch (e) {
  console.log(`  FAIL import :: ${e.message}`)
  fail++
  failures.push({ name: 'import', error: e })
}

const CAMPAIGN_ACTIVE = {
  uid: '00000000-0000-0000-0000-000000000000',
  showCampaign: true,
  claimable: true,
  campaignUrl: 'https://openapi.qoder.sh/growth-page/activity-iframe',
  campaigns: [
    {
      campaignId: '00000000-0000-0000-0000-000000000001',
      campaignKey: 'act-00000000-001',
      actionType: 'CLAIM_BENEFIT',
      startAt: 1789783200,
      endAt: 1789869540,
      claimStatus: 'UNCLAIMED',
      benefit: { kind: 'CREDITS', amount: 100, validity: { mode: 'RELATIVE_DAYS', days: 30 } },
      placements: [{ type: 'POPUP', campaignUrl: 'https://openapi.qoder.sh/growth-page/activity-iframe' }],
    },
  ],
}
const CAMPAIGN_CLAIMED = {
  ...CAMPAIGN_ACTIVE,
  claimable: false,
  campaigns: [{ ...CAMPAIGN_ACTIVE.campaigns[0], claimStatus: 'CLAIMED' }],
}
const CAMPAIGN_EMPTY = { uid: 'u1', showCampaign: false, claimable: false, campaignUrl: '', campaigns: [] }
const HEATMAP = {
  unit: 'credits',
  levels: [408.81, 409.81, 410.81, 411.81],
  items: [
    { date: '2026-09-18', value: 408.8148625 },
    { date: '2026-09-19', value: 0 },
    { date: '2026-09-20', value: 0 },
  ],
  total: 408.8148625,
  year: 2026,
}
const SUMMARY = { peakCredits: 408.8148625, peakDate: '2026-09-18', totalCredits: 408.8148625, unit: 'credits' }

function okFetch(body, { status = 200 } = {}) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { impl, calls }
}

if (campaign && quota && web) {
  const { fetchCampaignStatus } = campaign
  const { fetchCreditsHeatmap, fetchCreditsSummary } = quota
  const { buildStatus } = web

  // ------------------------------
  // fetchCampaignStatus
  // ------------------------------
  await testAsync('fetchCampaignStatus: GET me/campaigns with Bearer+UA; active campaign reduced', async () => {
    const { impl, calls } = okFetch(CAMPAIGN_ACTIVE)
    const result = await fetchCampaignStatus('tok', { fetchImpl: impl })
    assert.equal(calls[0], 'https://openapi.qoder.sh/sash/api/v1/me/campaigns')
    assert.equal(result.hasCampaign, true)
    assert.equal(result.claimable, true)
    assert.equal(result.campaignId, '00000000-0000-0000-0000-000000000001')
    assert.equal(result.campaignKey, 'act-00000000-001')
    assert.equal(result.actionType, 'CLAIM_BENEFIT')
    assert.equal(result.claimStatus, 'UNCLAIMED')
    assert.equal(result.campaignUrl, 'https://openapi.qoder.sh/growth-page/activity-iframe')
    assert.deepEqual(result.benefit, { kind: 'CREDITS', amount: 100, validity: { mode: 'RELATIVE_DAYS', days: 30 } })
  })

  await testAsync('fetchCampaignStatus: CLAIMED campaign keeps claimStatus for the claimed state', async () => {
    const { impl } = okFetch(CAMPAIGN_CLAIMED)
    const result = await fetchCampaignStatus('tok', { fetchImpl: impl })
    assert.equal(result.hasCampaign, true)
    assert.equal(result.claimStatus, 'CLAIMED')
  })

  await testAsync('fetchCampaignStatus: empty campaigns → hasCampaign:false (not null)', async () => {
    const { impl } = okFetch(CAMPAIGN_EMPTY)
    const result = await fetchCampaignStatus('tok', { fetchImpl: impl })
    assert.deepEqual(result, {
      fetchedAt: result.fetchedAt,
      hasCampaign: false,
      showCampaign: false,
      claimable: false,
    })
  })

  await testAsync('fetchCampaignStatus: 401 / network error / bad JSON / missing campaigns → null', async () => {
    const { impl } = okFetch(CAMPAIGN_ACTIVE, { status: 401 })
    assert.equal(await fetchCampaignStatus('tok', { fetchImpl: impl }), null)
    assert.equal(await fetchCampaignStatus('tok', { fetchImpl: async () => { throw new Error('down') } }), null)
    const bad = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    assert.equal(await fetchCampaignStatus('tok', { fetchImpl: bad }), null)
    const noArray = async () => ({ ok: true, status: 200, json: async () => ({ uid: 'u1' }) })
    assert.equal(await fetchCampaignStatus('tok', { fetchImpl: noArray }), null)
  })

  await testAsync('fetchCampaignStatus: absent token → null without fetch', async () => {
    let called = 0
    const impl = async () => { called++; return { ok: true, status: 200, json: async () => ({}) } }
    assert.equal(await fetchCampaignStatus('', { fetchImpl: impl }), null)
    assert.equal(called, 0)
  })

  // ------------------------------
  // fetchCreditsHeatmap / fetchCreditsSummary
  // ------------------------------
  await testAsync('fetchCreditsHeatmap: GET with days param; items/total/levels reduced', async () => {
    const { impl, calls } = okFetch(HEATMAP)
    const result = await fetchCreditsHeatmap('tok', 371, { fetchImpl: impl })
    assert.equal(calls[0], 'https://openapi.qoder.sh/sash/api/v1/ai-conversations/credits-heatmap?organization_id=&days=371')
    assert.deepEqual(result.items, HEATMAP.items)
    assert.equal(result.total, 408.8148625)
    assert.deepEqual(result.levels, [408.81, 409.81, 410.81, 411.81])
    assert.equal(result.unit, 'credits')
    assert.equal(result.days, 371)
  })

  await testAsync('fetchCreditsHeatmap: contract violations → null (wrong unit / bad date / negative value)', async () => {
    const bad = (body) => async () => ({ ok: true, status: 200, json: async () => body })
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: bad({ ...HEATMAP, unit: 'usd' }) }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: bad({ ...HEATMAP, items: [{ date: '2026/09/18', value: 1 }] }) }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: bad({ ...HEATMAP, items: [{ date: '2026-09-18', value: -1 }] }) }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: bad({ ...HEATMAP, total: null }) }), null)
  })

  await testAsync('fetchCreditsHeatmap: 401 / network / bad days → null', async () => {
    const { impl } = okFetch(HEATMAP, { status: 401 })
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: impl }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 7, { fetchImpl: async () => { throw new Error('x') } }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 0, { fetchImpl: impl }), null)
    assert.equal(await fetchCreditsHeatmap('tok', 1.5, { fetchImpl: impl }), null)
  })

  await testAsync('fetchCreditsSummary: GET credits-summary and reduce totals', async () => {
    const { impl, calls } = okFetch(SUMMARY)
    const result = await fetchCreditsSummary('tok', { fetchImpl: impl })
    assert.equal(calls[0], 'https://openapi.qoder.sh/sash/api/v1/ai-conversations/credits-summary')
    assert.equal(result.totalCredits, 408.8148625)
    assert.equal(result.peakCredits, 408.8148625)
    assert.equal(result.peakDate, '2026-09-18')
    assert.equal(result.unit, 'credits')
  })

  await testAsync('fetchCreditsSummary: empty body / 401 / network → null', async () => {
    const { impl } = okFetch({}, { status: 401 })
    assert.equal(await fetchCreditsSummary('tok', { fetchImpl: impl }), null)
    const empty = async () => ({ ok: true, status: 200, json: async () => ({}) })
    assert.equal(await fetchCreditsSummary('tok', { fetchImpl: empty }), null)
    assert.equal(await fetchCreditsSummary('tok', { fetchImpl: async () => { throw new Error('x') } }), null)
  })

  // ------------------------------
  // buildStatus integration
  // ------------------------------
  function mockDeps() {
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
            token: 'tok-123',
            refreshToken: 'r',
            user: { id: 'u1', name: 'Alice', email: 'a@b.c', avatarUrl: 'x' },
          },
          machineId: 'mid',
        }),
        saveOwn: async () => {},
        invalidate: () => {},
      },
    }
  }

  const routeJson = (routes) => async (url) => {
    for (const [needle, body] of routes) {
      if (String(url).includes(needle)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }

  await testAsync('buildStatus: campaign + creditsTimeline wired from the four endpoints', async () => {
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    const seen = []
    globalThis.fetch = async (url) => {
      seen.push(String(url))
      return routeJson([
        ['/sash/api/v1/me/campaigns', CAMPAIGN_ACTIVE],
        ['credits-heatmap', HEATMAP],
        ['credits-summary', SUMMARY],
        ['/api/v2/quota/usage', { userId: 'u1', userQuota: { total: 500, used: 62, remaining: 438, unit: 'credits' } }],
        ['/sash/api/v2/me/usage', { displayMode: 'enterprise', enterpriseUsage: {} }],
      ])(url)
    }
    try {
      const status = await buildStatus(deps)
      assert.ok(seen.some((u) => u.includes('/sash/api/v1/me/campaigns')), 'campaigns must be requested')
      assert.ok(seen.some((u) => u.includes('credits-heatmap')), 'heatmap must be requested')
      assert.ok(status.campaign, 'status.campaign present')
      assert.equal(status.campaign.hasCampaign, true)
      assert.equal(status.campaign.claimStatus, 'UNCLAIMED')
      assert.equal(status.campaign.benefit.amount, 100)
      assert.ok(status.creditsTimeline, 'status.creditsTimeline present')
      assert.equal(status.creditsTimeline.items.length, 3)
      assert.equal(status.creditsTimeline.total, 408.8148625)
      assert.equal(status.creditsTimeline.summary.totalCredits, 408.8148625, 'summary nested under creditsTimeline')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await testAsync('buildStatus: campaign/creditsTimeline omitted (not error fields) when endpoints fail', async () => {
    const deps = mockDeps()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('network down') }
    try {
      const status = await buildStatus(deps)
      assert.equal(status.campaign, undefined)
      assert.equal(status.creditsTimeline, undefined)
      assert.equal(status.signed_in, true, 'status itself must survive the failures')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
} else {
  console.log('  SKIP all tests (import failed)')
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
