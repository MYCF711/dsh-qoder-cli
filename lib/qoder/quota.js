/**
 * Qoder quota/usage API client.
 *
 * Endpoint — VERIFIED, docs/QODER-PROTOCOL.md §5.1 (`obf @18993360`):
 *   GET https://openapi.qoder.sh/api/v2/quota/usage
 *   headers: Accept: application/json, Authorization: Bearer <token>
 *   200 → JSON with userId/userType/usageType/totalUsagePercentage/
 *   isQuotaExceeded/expiresAt and userQuota{total,used,remaining,percentage,unit}
 *   /addOnQuota{total,used,remaining,percentage,unit,detailUrl}.
 *
 * Failure policy: any non-OK status, transport error, or unusable body resolves
 * to `null` — quota is display-only data and must never break the status route.
 *
 * @module dsh-qoder-cli/quota
 */

import { QODER_OPENAPI_BASES, QODER_DEFAULT_REGION } from './constants.js'

/** Path of the quota/usage endpoint on the OpenAPI host. VERIFIED (§5.1). */
export const QODER_QUOTA_USAGE_PATH = '/api/v2/quota/usage'

/**
 * Path of the usage-presentation endpoint. VERIFIED (§5.1, `obf @4196749`
 * `getUsagePresentation`) and live-probed 200 on this machine:
 *   GET <openapi>/sash/api/v2/me/usage → {displayMode:"qoder", qoderUsage:{…}}
 * The bundle normalizes it with `normalizeUsagePresentation` and reuses the
 * same quota-usage shape (userQuota/addOnQuota/…), plus `upgradeUrl` and
 * `isPlanQuotaProrated`. It carries NO per-day/per-model breakdowns.
 */
export const QODER_USAGE_PRESENTATION_PATH = '/sash/api/v2/me/usage'

/** Extract the nested quota block, tolerating camelCase/snake_case aliases. */
function pickQuotaBlock(body, camel, snake) {
  const raw = body?.[camel] ?? body?.[snake]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const block = {
    total: num(raw.total),
    used: num(raw.used),
    remaining: num(raw.remaining),
    ...(num(raw.percentage) !== null ? { percentage: num(raw.percentage) } : {}),
  }
  if (block.total === null && block.used === null && block.remaining === null) return null
  if (typeof raw.unit === 'string' && raw.unit.length > 0) block.unit = raw.unit
  if (typeof raw.detailUrl === 'string' && raw.detailUrl.length > 0) block.detailUrl = raw.detailUrl
  return block
}

/**
 * Fetch the caller's quota/usage document.
 *
 * @param {string} token  Bearer token of the resolved credential.
 * @param {object} [options]
 * @param {string} [options.region]  'global' | 'cn' — picks the OpenAPI base.
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests.
 * @returns {Promise<object|null>} the parsed quota document (with `userQuota`
 *   and `addOnQuota` reduced to `{total, used, remaining, percentage?, unit?,
 *   detailUrl?}`), or `null` on any failure (network, non-OK, unusable body).
 */
export async function fetchQuotaUsage(token, { region = QODER_DEFAULT_REGION, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null
  const base = QODER_OPENAPI_BASES[region] ?? QODER_OPENAPI_BASES[QODER_DEFAULT_REGION]
  let response
  try {
    response = await fetchImpl(`${base}${QODER_QUOTA_USAGE_PATH}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const userQuota = pickQuotaBlock(body, 'userQuota', 'user_quota')
  const addOnQuota = pickQuotaBlock(body, 'addOnQuota', 'add_on_quota')
  if (userQuota === null && addOnQuota === null) return null
  return {
    fetchedAt: new Date().toISOString(),
    ...(typeof body.userId === 'string' ? { userId: body.userId } : {}),
    ...(typeof body.userType === 'string' ? { userType: body.userType } : {}),
    ...(typeof body.usageType === 'string' ? { usageType: body.usageType } : {}),
    ...(typeof body.totalUsagePercentage === 'number' ? { totalUsagePercentage: body.totalUsagePercentage } : {}),
    ...(typeof body.isQuotaExceeded === 'boolean' ? { isQuotaExceeded: body.isQuotaExceeded } : {}),
    ...(typeof body.expiresAt === 'string' || typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
    ...(userQuota !== null ? { userQuota } : {}),
    ...(addOnQuota !== null ? { addOnQuota } : {}),
  }
}

/**
 * Fetch the usage-presentation document (`/sash/api/v2/me/usage`).
 *
 * VERIFIED live (200): returns the same quota accounting as
 * `fetchQuotaUsage` (userQuota/addOnQuota with total/used/remaining), plus
 * `upgradeUrl` and `isPlanQuotaProrated`. There is deliberately no
 * `range` parameter — the endpoint has no per-day/7-day/monthly breakdown
 * and no per-model decomposition (bundle-wide scan: the only usage paths
 * are `quota/usage`, `me/usage`, `user/plan`; none accepts a range).
 *
 * @returns {Promise<object|null>} same failure policy as fetchQuotaUsage.
 */
export async function fetchUsageStats(token, { region = QODER_DEFAULT_REGION, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null
  const base = QODER_OPENAPI_BASES[region] ?? QODER_OPENAPI_BASES[QODER_DEFAULT_REGION]
  let response
  try {
    response = await fetchImpl(`${base}${QODER_USAGE_PRESENTATION_PATH}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  // The wrapper mirrors the bundle's `normalizeUsagePresentation`: only the
  // "qoder" display mode carries usable accounting; "enterprise" is a
  // deep-link payload with no numbers, so it degrades to null as well.
  const usage = body.qoderUsage ?? body.qoder_usage
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null
  const userQuota = pickQuotaBlock(usage, 'userQuota', 'user_quota')
  const addOnQuota = pickQuotaBlock(usage, 'addOnQuota', 'add_on_quota')
  if (userQuota === null && addOnQuota === null) return null
  return {
    fetchedAt: new Date().toISOString(),
    ...(typeof usage.userId === 'string' ? { userId: usage.userId } : {}),
    ...(typeof usage.userType === 'string' ? { userType: usage.userType } : {}),
    ...(typeof usage.usageType === 'string' ? { usageType: usage.usageType } : {}),
    ...(typeof usage.totalUsagePercentage === 'number' ? { totalUsagePercentage: usage.totalUsagePercentage } : {}),
    ...(typeof usage.isQuotaExceeded === 'boolean' ? { isQuotaExceeded: usage.isQuotaExceeded } : {}),
    ...(typeof usage.isPlanQuotaProrated === 'boolean' ? { isPlanQuotaProrated: usage.isPlanQuotaProrated } : {}),
    ...(typeof usage.expiresAt === 'string' || typeof usage.expiresAt === 'number' ? { expiresAt: usage.expiresAt } : {}),
    ...(typeof usage.upgradeUrl === 'string' ? { upgradeUrl: usage.upgradeUrl } : {}),
    ...(userQuota !== null ? { userQuota } : {}),
    ...(addOnQuota !== null ? { addOnQuota } : {}),
  }
}

const CREDITS_HEATMAP_PATH = '/sash/api/v1/ai-conversations/credits-heatmap'
const CREDITS_SUMMARY_PATH = '/sash/api/v1/ai-conversations/credits-summary'

/**
 * Fetch the per-day credits heatmap (`/sash/api/v1/ai-conversations/credits-heatmap`).
 *
 * VERIFIED live (200, days=7 and days=371): `{unit:"credits", levels:[4 numbers],
 * items:[{date:"YYYY-MM-DD", value:number}], total, year}`. Contract validated
 * by the bundle's own parser (asar `function eKe(`): `unit` must be "credits",
 * `levels` exactly 4 ascending, `items` unique non-negative dates.
 *
 * @param {number} days  window size (the desktop app uses 371).
 * @returns {Promise<object|null>} `{fetchedAt, days, unit, total, levels,
 *   items:[{date,value}]}` or null per the shared failure policy.
 */
export async function fetchCreditsHeatmap(token, days = 371, { region = QODER_DEFAULT_REGION, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null
  if (!Number.isSafeInteger(days) || days <= 0) return null
  const base = QODER_OPENAPI_BASES[region] ?? QODER_OPENAPI_BASES[QODER_DEFAULT_REGION]
  let response
  try {
    response = await fetchImpl(`${base}${CREDITS_HEATMAP_PATH}?organization_id=&days=${days}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  if (body.unit !== 'credits') return null
  if (!Array.isArray(body.items)) return null
  const items = []
  for (const raw of body.items) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0) return null
    items.push({ date: raw.date, value: raw.value })
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const total = num(body.total)
  if (total === null || total < 0) return null
  let levels = null
  if (Array.isArray(body.levels) && body.levels.length === 4) {
    const parsed = body.levels.map(num)
    if (parsed.every((v) => v !== null)) levels = parsed
  }
  return {
    fetchedAt: new Date().toISOString(),
    days,
    unit: 'credits',
    total,
    ...(levels !== null ? { levels } : {}),
    items,
  }
}

/**
 * Fetch the credits summary (`/sash/api/v1/ai-conversations/credits-summary`).
 *
 * VERIFIED live (200): `{totalCredits, peakCredits, peakDate:"YYYY-MM-DD", unit:"credits"}`.
 *
 * @returns {Promise<object|null>} `{fetchedAt, totalCredits, peakCredits,
 *   peakDate, unit}` or null per the shared failure policy.
 */
export async function fetchCreditsSummary(token, { region = QODER_DEFAULT_REGION, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null
  const base = QODER_OPENAPI_BASES[region] ?? QODER_OPENAPI_BASES[QODER_DEFAULT_REGION]
  let response
  try {
    response = await fetchImpl(`${base}${CREDITS_SUMMARY_PATH}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const totalCredits = num(body.totalCredits)
  const peakCredits = num(body.peakCredits)
  if (totalCredits === null && peakCredits === null) return null
  return {
    fetchedAt: new Date().toISOString(),
    unit: 'credits',
    ...(totalCredits !== null ? { totalCredits } : {}),
    ...(peakCredits !== null ? { peakCredits } : {}),
    ...(typeof body.peakDate === 'string' ? { peakDate: body.peakDate } : {}),
  }
}
