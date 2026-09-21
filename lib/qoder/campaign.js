/**
 * Qoder campaign (sign-in benefit) status client.
 *
 * Endpoint — VERIFIED: PC-client Electron log `[Campaign] 活动状态请求发出/返回`
 * and live probe (docs/API-RESEARCH-SIGNIN-USAGE.md §1):
 *   GET https://openapi.qoder.sh/sash/api/v1/me/campaigns
 *   headers: Accept, Authorization: Bearer <token>, User-Agent: Qoder
 *   200 → {uid, showCampaign, claimable, campaignUrl, campaigns:[{
 *     campaignId, campaignKey, actionType:"CLAIM_BENEFIT", startAt, endAt,
 *     claimStatus:"CLAIMED"|…, benefit:{kind:"CREDITS", amount, validity},
 *     placements:[…]}]}
 *
 * IMPORTANT — the CLAIM action itself is NOT a REST endpoint: the desktop
 * app opens `campaignUrl` in an iframe (growth-page) and the webpage drives
 * the claim. This client therefore only reads status; claiming means opening
 * the campaign page. There is deliberately no fetchSignIn/claim here.
 *
 * Failure policy: any non-OK status, transport error, or unusable body
 * resolves to `null` — display-only data, never breaks the status route.
 *
 * @module dsh-qoder-cli/campaign
 */

import { QODER_OPENAPI_BASES, QODER_DEFAULT_REGION } from './constants.js'

/** Campaign status path. VERIFIED (PC-client log + live probe 200). */
export const QODER_CAMPAIGN_PATH = '/sash/api/v1/me/campaigns'

const CAMPAIGN_WINDOW_MS = 5 * 60 * 1000

/** Reduce one raw campaign entry; null when the entry is unusable. */
function reduceCampaign(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.campaignId !== 'string' || raw.campaignId.length === 0) return null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const benefitRaw = raw.benefit
  let benefit = null
  if (benefitRaw !== null && typeof benefitRaw === 'object' && !Array.isArray(benefitRaw)) {
    const amount = num(benefitRaw.amount)
    benefit = {
      ...(typeof benefitRaw.kind === 'string' ? { kind: benefitRaw.kind } : {}),
      ...(amount !== null ? { amount } : {}),
      ...(benefitRaw.validity !== null && typeof benefitRaw.validity === 'object' && !Array.isArray(benefitRaw.validity)
        ? { validity: benefitRaw.validity }
        : {}),
    }
  }
  return {
    campaignId: raw.campaignId,
    ...(typeof raw.campaignKey === 'string' ? { campaignKey: raw.campaignKey } : {}),
    ...(typeof raw.actionType === 'string' ? { actionType: raw.actionType } : {}),
    ...(typeof raw.claimStatus === 'string' ? { claimStatus: raw.claimStatus } : {}),
    ...(num(raw.startAt) !== null ? { startAt: raw.startAt } : {}),
    ...(num(raw.endAt) !== null ? { endAt: raw.endAt } : {}),
    ...(benefit !== null ? { benefit } : {}),
  }
}

/**
 * Fetch the campaign (sign-in benefit) status document.
 *
 * @param {string} token  Bearer token of the resolved credential.
 * @param {object} [options]
 * @param {string} [options.region]  'global' | 'cn' — picks the OpenAPI base.
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests.
 * @returns {Promise<object|null>} `{hasCampaign, campaignId, campaignKey,
 *   actionType, claimStatus, claimable, campaignUrl, benefit:{kind,amount,
 *   validity}, fetchedAt}` or `null` on any failure. `hasCampaign:false`
 *   covers both "no active window" (`campaigns:[]`) and unusable payloads.
 */
export async function fetchCampaignStatus(token, { region = QODER_DEFAULT_REGION, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null
  const base = QODER_OPENAPI_BASES[region] ?? QODER_OPENAPI_BASES[QODER_DEFAULT_REGION]
  let response
  try {
    response = await fetchImpl(`${base}${QODER_CAMPAIGN_PATH}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'Qoder' },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const campaignUrl = typeof body.campaignUrl === 'string' && body.campaignUrl.length > 0 ? body.campaignUrl : null
  if (!Array.isArray(body.campaigns)) return null
  const reduced = body.campaigns.map(reduceCampaign).filter((c) => c !== null)
  const primary = reduced.find((c) => c.actionType === 'CLAIM_BENEFIT') ?? reduced[0] ?? null
  return {
    fetchedAt: new Date().toISOString(),
    hasCampaign: primary !== null,
    showCampaign: body.showCampaign === true,
    claimable: body.claimable === true,
    ...(campaignUrl !== null ? { campaignUrl } : {}),
    ...(primary !== null ? primary : {}),
  }
}

/** Client-side cache window, mirroring the desktop app's 5-minute status cache. */
export const CAMPAIGN_CACHE_WINDOW_MS = CAMPAIGN_WINDOW_MS
