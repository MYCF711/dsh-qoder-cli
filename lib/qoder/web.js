/**
 * Plugin web routes: account status and the enabled-model allowlist.
 *
 * These back the browser settings card. Both are loopback-gated, because they
 * read the account identity and (for the write route) mutate the user's model
 * selection — neither belongs on a network-reachable surface.
 *
 * The write route additionally requires a loopback `Origin`. A GET can be
 * triggered by any page the user visits, but a mutating POST that a browser
 * sends cross-origin is exactly the shape a local-attack page would take.
 *
 * @module dsh-qoder-cli/web
 */

import { QODER_MODELS_PATH, QODER_STATUS_PATH, QODER_AUTH_START_PATH, QODER_AUTH_POLL_PATH, QODER_CATALOG_DUMP_PATH, QODER_MODEL_OPTIONS_PATH, QODER_ACCOUNTS_LIST_PATH, QODER_ACCOUNTS_ACTIVATE_PATH, QODER_ACCOUNTS_PROBE_PATH } from './constants.js'
import {
  buildCredentialFromDeviceLogin,
  createDeviceLoginAttempt,
  fetchUserInfo,
  QoderDeviceLoginError,
  waitForDeviceToken,
} from './device-login.js'
import { hostIsLoopback, originIsLoopback } from './shim.js'
import { fetchQuotaUsage, fetchUsageStats, fetchCreditsHeatmap, fetchCreditsSummary } from './quota.js'
import { fetchCampaignStatus } from './campaign.js'
import { probeCredential, listAlternateCredentials } from './credential-failover.js'

/** Largest allowlist write accepted. */
const MODELS_BODY_LIMIT = 65536

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Read a bounded request body. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MODELS_BODY_LIMIT) {
        reject(new Error('qoder: request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Build the account-status document.
 *
 * Field names are snake_case to match what the sibling connector's card already
 * knows how to render, so the client half needs no translation layer.
 */
export async function buildStatus(deps) {
  const models = deps.models()
  const enabled = deps.enabledModels()
  let account = null
  let signedIn = false
  let error = null
  let quotaPromise = null
  let usagePromise = null
  let creditsTimelinePromise = null
  let creditsSummaryPromise = null
  let campaignPromise = null
  try {
    const resolved = await deps.store.resolve()
    signedIn = true
    account = {
      user_id: resolved.credential.user?.id ?? null,
      name: resolved.credential.user?.name ?? null,
      email: resolved.credential.user?.email ?? null,
      avatar_url: resolved.credential.user?.avatarUrl ?? null,
      expires_at: resolved.credential.expiresAt ?? null,
      machine_id_present: typeof resolved.machineId === 'string' && resolved.machineId.length > 0,
    }
    // Quota is display-only: fetch all four documents concurrently with the
    // rest of the document and never let a failure surface (all → null).
    if (typeof resolved.credential.token === 'string' && resolved.credential.token.length > 0) {
      const region = { region: deps.region?.() }
      quotaPromise = fetchQuotaUsage(resolved.credential.token, region).catch(() => null)
      usagePromise = fetchUsageStats(resolved.credential.token, region).catch(() => null)
      creditsTimelinePromise = fetchCreditsHeatmap(resolved.credential.token, 371, region).catch(() => null)
      creditsSummaryPromise = fetchCreditsSummary(resolved.credential.token, region).catch(() => null)
      campaignPromise = fetchCampaignStatus(resolved.credential.token, region).catch(() => null)
    }
  } catch (caught) {
    error = safeMessage(caught)
  }
  const [quota, usage, creditsTimeline, creditsSummary, campaign] =
    quotaPromise === null
      ? [null, null, null, null, null]
      : await Promise.all([quotaPromise, usagePromise, creditsTimelinePromise, creditsSummaryPromise, campaignPromise])
  const creditsTimelineDoc = creditsTimeline === null ? null : { ...creditsTimeline, ...(creditsSummary !== null ? { summary: creditsSummary } : {}) }
  return {
    signed_in: signedIn,
    ...(account === null ? {} : { account }),
    ...(error === null ? {} : { error }),
    ...(quota === null ? {} : { quota }),
    ...(usage === null ? {} : { usage }),
    ...(creditsTimelineDoc === null ? {} : { creditsTimeline: creditsTimelineDoc }),
    ...(campaign === null ? {} : { campaign }),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description ?? null,
      ...(model.degraded === undefined ? {} : { degraded: model.degraded }),
      ...(model.priceFactor === undefined ? {} : { priceFactor: model.priceFactor }),
      ...(model.promotion ? { promotion: model.promotion } : {}),
      ...(Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0 ? { reasoningEfforts: model.reasoningEfforts } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
      ...(model.contextOptions ? { contextOptions: model.contextOptions } : {}),
      ...(model.thinkingDefault ? { thinkingDefault: model.thinkingDefault } : {}),
    })),
    enabled_models: enabled,
    model_options: deps.modelOptions?.() ?? {},
    selection_writable: deps.settingsWritable(),
    region: deps.region(),
    provider: deps.provider,
  }
}

/** The status handler (GET). Loopback Host/Origin only; no body. */
export function statusHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      json(res, 200, await buildStatus(deps))
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/** Gate a mutating POST: loopback Host/Origin *and* a JSON content type. */
function checkLoopbackPost(req, res) {
  if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
    json(res, 403, { error: 'request-not-trusted' })
    return false
  }
  if (typeof req.headers.origin !== 'string') {
    json(res, 403, { error: 'origin-required' })
    return false
  }
  const type = req.headers['content-type']
  if (typeof type !== 'string' || !type.trim().toLowerCase().startsWith('application/json')) {
    json(res, 415, { error: 'content-type must be application/json' })
    return false
  }
  return true
}

/**
 * The allowlist write handler (POST).
 *
 * Accepts `{ enabledModels: string[] }`. Ids are intersected with the live
 * catalog, so a stale card cannot persist an id the provider no longer serves.
 * An empty array clears the allowlist, which means "offer everything".
 */
export function enabledModelsHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!checkLoopbackPost(req, res)) return
    if (!deps.settingsWritable()) {
      json(res, 409, { error: 'settings are not writable in this profile' })
      return
    }
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      json(res, 400, { error: safeMessage(error) })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.enabledModels)) {
      json(res, 400, { error: 'enabledModels must be an array of model ids' })
      return
    }
    const known = new Set(deps.models().map((model) => model.id))
    const next = [...new Set(parsed.enabledModels.filter((id) => typeof id === 'string' && known.has(id)))]
    try {
      await deps.setEnabledModels(next)
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
      return
    }
    json(res, 200, { ok: true, enabled_models: next })
  }
}

/**
 * Device-login session registry.
 *
 * One attempt at a time (starting a new one cancels the previous), mirroring
 * the desktop app's "reuse/supersede" behaviour. The verifier lives only in
 * this process's memory; the browser never sees token material.
 */
export function createDeviceLoginRegistry(deps) {
  let current = null

  const start = () => {
    if (current?.controller && !current.controller.signal.aborted) current.controller.abort()
    const controller = new AbortController()
    const machineId = deps.resolveMachineId?.() ?? null
    const attempt = createDeviceLoginAttempt({ machineId })
    current = { attempt, controller, startedAt: Date.now() }
    // Run the wait loop in the background; the card polls /auth/poll.
    void waitForDeviceToken(attempt, { signal: controller.signal, fetchImpl: deps.fetchImpl })
      .then(async (payload) => {
        if (current?.attempt !== attempt) return
        try {
          const user = await fetchUserInfo(payload.token, { fetchImpl: deps.fetchImpl })
          const credential = buildCredentialFromDeviceLogin(payload, user)
          await deps.store.saveOwn(credential, machineId)
          deps.store.invalidate()
          current = current && current.attempt === attempt ? { ...current, outcome: { ok: true } } : current
        } catch (error) {
          current =
            current && current.attempt === attempt
              ? { ...current, outcome: { ok: false, error: safeMessage(error) } }
              : current
        }
      })
      .catch((error) => {
        current =
          current && current.attempt === attempt
            ? {
                ...current,
                outcome: {
                  ok: false,
                  error:
                    error instanceof QoderDeviceLoginError
                      ? error.message
                      : safeMessage(error),
                },
              }
            : current
      })
    return { url: attempt.url, startedAt: current.startedAt }
  }

  const pollStatus = () => {
    if (current === null) return { state: 'idle' }
    if (current.outcome !== undefined) return { state: current.outcome.ok ? 'signed_in' : 'error', error: current.outcome.error }
    return { state: 'pending', url: current.attempt.url, startedAt: current.startedAt }
  }

  const cancel = () => {
    current?.controller?.abort()
    current = null
  }

  return { start, pollStatus, cancel }
}

/** The auth start handler (POST). Loopback Host/Origin only. */
export function authStartHandler(deps) {
  return (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      json(res, 200, deps.deviceLogin.start())
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/** The auth poll handler (GET). Loopback Host/Origin only. */
export function authPollHandler(deps) {
  return (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    json(res, 200, deps.deviceLogin.pollStatus())
  }
}

/** The opt-in catalog-dump handler (GET). Loopback Host/Origin only. Returns
 *  the effective catalog plus probe metadata — product data only, no
 *  credentials, no uid, no machine identity. */
export function catalogDumpHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      const entries = typeof deps.catalogDump === 'function' ? await deps.catalogDump() : null
      if (entries === null) {
        json(res, 503, { error: 'catalog unavailable' })
        return
      }
      json(res, 200, {
        version: 1,
        dumpedAt: new Date().toISOString(),
        platform: process.platform,
        models: entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
          input: entry.input,
          reasoning: entry.reasoning === true,
          reasoningEfforts: entry.reasoningEfforts ?? [],
          degraded: entry.degraded ?? null,
          source: entry.source ?? null,
        })),
      })
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/** The per-model options write handler (POST {id, contextLabel?, thinkingEffort?}). */
export function modelOptionsHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!checkLoopbackPost(req, res)) return
    if (!deps.settingsWritable()) {
      json(res, 409, { error: 'settings are not writable in this profile' })
      return
    }
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      json(res, 400, { error: safeMessage(error) })
      return
    }
    if (body === null || typeof body !== 'object' || typeof body.id !== 'string' || body.id === '') {
      json(res, 400, { error: 'expected {id, contextLabel?, thinkingEffort?}' })
      return
    }
    try {
      const ok = await deps.setModelOptions(body.id, {
        ...(typeof body.contextLabel === 'string' ? { contextLabel: body.contextLabel } : {}),
        ...(typeof body.thinkingEffort === 'string' ? { thinkingEffort: body.thinkingEffort } : {}),
      })
      json(res, ok ? 200 : 503, ok ? { ok: true } : { error: 'settings unavailable' })
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/**
 * Sanitize account data: strip all sensitive fields, only expose UID/email/name/isCurrent/credentialFreshness.
 */
function sanitizeAccount(credentialWithMetadata) {
  const cred = credentialWithMetadata.credential ?? {}
  const user = cred.user ?? {}
  // NEVER include token / refreshToken / machineId
  const freshAt = credentialWithMetadata.freshAt ?? Date.now()
  return {
    uid: user.id ?? null,
    email: user.email ?? null,
    name: user.name ?? null,
    isCurrent: credentialWithMetadata.isCurrent ?? false,
    credentialFreshness: freshAt,
  }
}

/**
 * List all discovered accounts.
 *
 * Sources (in priority order):
 *  1. The plugin's own credential copy (always current)
 *  2. The IDE/desktop store via DPAPI
 *  3. The CLI device-flow store (~/.qoder/.auth/user, WASM AES)
 *  4. An explicit file via QODER_CLI_AUTH_FILE
 */
export async function listAccounts(dprism) {
  const deps = dprism.deps
  const discover = dprism.discover
  const dpapiUnprotect = dprism.dpapiUnprotect
  const results = []

  // 1. Plugin's own credential (always first and always "current")
  try {
    const resolved = await deps.store.resolve()
    results.push({
      credential: resolved.credential,
      source: 'plugin-own',
      isCurrent: true,
      freshAt: Date.now(),
    })
  } catch {
    // No usable credential found yet
  }

  // 2-4. Alternate credentials from failover list
  for await (const candidate of deps.listAlternateCredentials?.(discover, dpapiUnprotect) ?? []) {
    // Probe availability
    const available = await probeCredential(candidate.token, candidate.machineId)

    // Fetch minimal user info for display
    let userInfo = null
    try {
      userInfo = await fetchUserInfo(candidate.token, { fetchImpl: deps.fetchImpl }).catch(() => null)
    } catch {
      // Ignore fetch errors
    }

    // Extract user info fields or use candidate.metadata if provided
    const user = userInfo ?? { id: null, name: candidate.name ?? null, email: candidate.email ?? null, avatarUrl: candidate.avatarUrl ?? null }

    results.push({
      credential: { user, token: candidate.token }, // Will be sanitized later
      source: candidate.source ?? null,
      isCurrent: false,
      freshAt: Date.now(),
      available: available,
    })
  }

  return results.map((r) => sanitizeAccount(r))
}

/**
 * Activate an account by switching to its credential.
 * Expects POST body: { uid: string }
 */
export async function activateAccount(deps, uid) {
  const discover = deps.discover
  const dpapiUnprotect = deps.dpapiUnprotect
  const store = deps.store

  // Collect all credentials with their UIDs
  const candidates = []

  // Get current stored credential
  try {
    const resolved = await store.resolve()
    if (resolved.credential?.user?.id === uid) {
      // Already the current credential
      return { success: true, message: 'already current' }
    }
    candidates.push({ credential: resolved.credential, machineId: resolved.machineId, source: 'plugin-own' })
  } catch {
    // Ignore
  }

  // Collect alternate credentials
  for await (const candidate of listAlternateCredentials(discover, dpapiUnprotect)) {
    // Try to get user info to match UID
    try {
      const userInfo = await fetchUserInfo(candidate.token, { fetchImpl: deps.fetchImpl }).catch(() => null)
      if (userInfo?.user?.id === uid || userInfo?.id === uid) {
        candidates.push({
          credential: { user: userInfo.user ?? userInfo, token: candidate.token },
          machineId: candidate.machineId,
          source: candidate.source ?? 'alternate',
        })
        break
      }
    } catch {
      // Skip candidates where we can't resolve UID
    }
  }

  // If we found a matching credential, switch to it
  const matched = candidates.find((c) => c.credential?.user?.id === uid)
  if (matched) {
    await store.saveOwn(matched.credential, matched.machineId)
    store.invalidate()
    return { success: true, message: 'activated' }
  }

  throw new Error(`Account with uid "${uid}" not found`)
}

/**
 * Check if the current active credential has network access.
 * Expects POST body: {} or undefined
 */
export function probeCurrentAccount(deps) {
  return async () => {
    try {
      const resolved = await deps.store.resolve()
      const available = await probeCredential(resolved.credential.token, resolved.machineId)
      return { available }
    } catch (error) {
      return { available: false, error: safeMessage(error) }
    }
  }
}

/**
 * Probe a specific account's availability.
 * Expects POST body: { uid: string }
 */
export async function probeSpecificAccount(deps, uid) {
  const discover = deps.discover
  const dpapiUnprotect = deps.dpapiUnprotect

  for await (const candidate of listAlternateCredentials(discover, dpapiUnprotect)) {
    try {
      const userInfo = await fetchUserInfo(candidate.token, { fetchImpl: deps.fetchImpl }).catch(() => null)
      if (userInfo?.user?.id === uid || userInfo?.id === uid) {
        const available = await probeCredential(candidate.token, candidate.machineId)
        return { available }
      }
    } catch {
      // Skip this candidate
    }
  }

  throw new Error(`Account with uid "${uid}" not found`)
}

/**
 * Account list handler (GET). Loopback Host/Origin only.
 * Returns sanitized account list without any sensitive tokens.
 */
export function accountsListHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      const accounts = await listAccounts(deps)
      json(res, 200, accounts)
    } catch (error) {
      json(res, 500, { error: safeMessage(error) })
    }
  }
}

/**
 * Account activate handler (POST). Loopback Host/Origin only.
 * Accepts { uid: string }, switches active credential.
 */
export function accountsActivateHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!checkLoopbackPost(req, res)) return
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      json(res, 400, { error: safeMessage(error) })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.uid !== 'string') {
      json(res, 400, { error: 'uid must be a string' })
      return
    }
    try {
      const result = await activateAccount(deps, parsed.uid)
      json(res, 200, result)
    } catch (error) {
      json(res, 404, { error: safeMessage(error) })
    }
  }
}

/**
 * Account probe handler (POST). Loopback Host/Origin only.
 * Accepts { uid: string }, probes the account's availability.
 */
export function accountsProbeHandler(deps) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!checkLoopbackPost(req, res)) return
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      json(res, 400, { error: safeMessage(error) })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.uid !== 'string') {
      json(res, 400, { error: 'uid must be a string' })
      return
    }
    try {
      const result = await probeSpecificAccount(deps, parsed.uid)
      json(res, 200, result)
    } catch (error) {
      json(res, 404, { error: safeMessage(error) })
    }
  }
}

/** Register all routes on the host web server, tied to the plugin fiber. */
export function registerQoderRoutes(ctx, deps) {
  ctx.effect(() => {
    const disposables = [
      ctx.webServer.register({ kind: 'exact', path: QODER_STATUS_PATH, handler: statusHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_MODELS_PATH, handler: enabledModelsHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_AUTH_START_PATH, handler: authStartHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_AUTH_POLL_PATH, handler: authPollHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_CATALOG_DUMP_PATH, handler: catalogDumpHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_MODEL_OPTIONS_PATH, handler: modelOptionsHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_ACCOUNTS_LIST_PATH, handler: accountsListHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_ACCOUNTS_ACTIVATE_PATH, handler: accountsActivateHandler(deps) }),
      ctx.webServer.register({ kind: 'exact', path: QODER_ACCOUNTS_PROBE_PATH, handler: accountsProbeHandler(deps) }),
    ]
    return () => {
      for (const dispose of disposables) dispose()
      deps.deviceLogin?.cancel()
    }
  }, 'dsh-qoder-cli: Web routes')
}
