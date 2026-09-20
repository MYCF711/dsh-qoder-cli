/**
 * Qoder device login flow (PKCE, S256).
 *
 * Reproduces the flow read from the Qoder desktop bundle (evidence:
 * `D:\DSH\tmp\qoder-main-index.js`, functions `Ive`/`Cve`/`Eve`/`uve`/`fetchUser`,
 * constants `authClientIds.prod`, `environments.prod`). The flow is:
 *
 *  1. Generate `verifier` (64 chars from the unreserved alphabet) and a random
 *     `nonce`. `challenge` = base64url(sha256(verifier)).
 *  2. Open `https://qoder.com/device/selectAccounts?challenge=…&challenge_method=S256
 *     &nonce=…&machine_id=…&client_id=732aef47-9cf2-46a2-95fe-4cebb5d0d1fa`
 *     in the user's browser. The user signs in there.
 *  3. Poll `https://openapi.qoder.sh/api/v1/deviceToken/poll?nonce=…&verifier=…
 *     &challenge_method=S256`. HTTP 404 means "not yet"; a JSON body with
 *     `token` + `refresh_token` means success. 5-minute overall deadline,
 *     1s poll interval, one retry chain capped at 5 consecutive failures.
 *  4. Fetch `GET /api/v1/userinfo` with the new token to build the same
 *     credential document the Qoder app persists.
 *
 * The credential produced here is written ONLY to the plugin's own store
 * (`$DSH_HOME/.qoder-cli-auth.json`); the Qoder app's files are never touched.
 *
 * @module dsh-qoder-cli/device-login
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  QODER_AUTH_CLIENT_ID,
  QODER_POLL_ENDPOINT_TIMEOUT_MS,
  QODER_POLL_INTERVAL_MS,
  QODER_POLL_DEADLINE_MS,
  QODER_SELECT_ACCOUNTS_PATH,
  QODER_DEVICE_POLL_PATH,
  QODER_USERINFO_PATH,
  QODER_VERIFIER_ALPHABET,
  QODER_VERIFIER_LENGTH,
} from './constants.js'

/** Poll backoff the Qoder app uses between 404s (constant 1s, `xV(BV,…)`). */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Error raised by the device flow, mirroring the app's `zi` error class. */
export class QoderDeviceLoginError extends Error {
  constructor(code, message, retryable = true) {
    super(message)
    this.name = 'QoderDeviceLoginError'
    this.code = code
    this.retryable = retryable
  }
}

/**
 * Create one device-login attempt.
 *
 * `machineId` is the Qoder machine id when one can be read, else a random UUID
 * (the desktop app generates one the same way). `now` is injectable for tests.
 */
export function createDeviceLoginAttempt({ machineId = null, now = Date.now } = {}) {
  const verifier = [...randomBytes(QODER_VERIFIER_LENGTH)]
    .map((b) => QODER_VERIFIER_ALPHABET[b % QODER_VERIFIER_ALPHABET.length])
    .join('')
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url')
  const nonce = randomUUID()

  const url = new URL(QODER_SELECT_ACCOUNTS_PATH, 'https://qoder.com')
  url.search = new URLSearchParams({
    challenge,
    challenge_method: 'S256',
    nonce,
    machine_id: machineId ?? randomUUID(),
    client_id: QODER_AUTH_CLIENT_ID,
  }).toString()

  return { verifier, challenge, nonce, url: url.toString(), startedAt: now() }
}

/**
 * Poll once for the device token.
 *
 * @returns `{ status:'pending' }` on 404 / incomplete body, or
 *          `{ status:'complete', payload }` with the token document.
 */
export async function pollDeviceToken(attempt, { fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(QODER_DEVICE_POLL_PATH, 'https://openapi.qoder.sh')
  url.search = new URLSearchParams({
    nonce: attempt.nonce,
    verifier: attempt.verifier,
    challenge_method: 'S256',
  }).toString()

  let response
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new QoderDeviceLoginError(
      'NETWORK',
      `无法连接登录服务：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (response.status === 404) return { status: 'pending' }
  if (!response.ok) {
    throw new QoderDeviceLoginError('SERVER_ERROR', `登录服务返回异常（HTTP ${response.status}）。`)
  }
  const body = await response.json().catch(() => null)
  if (
    body === null ||
    typeof body !== 'object' ||
    typeof body.token !== 'string' ||
    body.token.length === 0 ||
    typeof body.refresh_token !== 'string'
  ) {
    return { status: 'pending' }
  }
  return { status: 'complete', payload: body }
}

/**
 * Fetch the account document for a fresh token.
 *
 * Mirrors the app's `fetchUser`: tolerant of field aliases, strict on the id.
 */
export async function fetchUserInfo(token, { fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(QODER_USERINFO_PATH, 'https://openapi.qoder.sh')
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new QoderDeviceLoginError(
      'NETWORK',
      `读取账号信息失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new QoderDeviceLoginError('UNAUTHORIZED', '登录凭证无效，请重新登录。', false)
  }
  if (!response.ok) {
    throw new QoderDeviceLoginError('SERVER_ERROR', `读取账号信息失败（HTTP ${response.status}）。`)
  }
  const body = await response.json().catch(() => null)
  if (body === null || typeof body !== 'object') {
    throw new QoderDeviceLoginError('SERVER_ERROR', '账号信息响应格式无效。')
  }
  const pick = (keys) => {
    for (const key of keys) {
      const value = body[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }
  const id = pick(['id', 'user_id', 'uid'])
  if (id === undefined) {
    throw new QoderDeviceLoginError('SERVER_ERROR', '账号信息缺少用户标识。')
  }
  return {
    id,
    ...(pick(['name', 'username', 'user_name']) !== undefined
      ? { name: pick(['name', 'username', 'user_name']) }
      : {}),
    ...(pick(['email']) !== undefined ? { email: pick(['email']) } : {}),
    ...(pick(['avatar_url', 'avatar', 'image_url']) !== undefined
      ? { avatarUrl: pick(['avatar_url', 'avatar', 'image_url']) }
      : {}),
  }
}

/**
 * Run the whole wait loop: poll until the token arrives or the deadline hits.
 *
 * The timeout constants mirror the app: 1s interval, 5-minute deadline,
 * 30s per-request ceiling enforced by the caller's fetch, and cancellation via
 * an external `AbortSignal` (the card's "cancel" button).
 */
export async function waitForDeviceToken(attempt, { signal, fetchImpl, now = Date.now } = {}) {
  const deadline = now() + QODER_POLL_DEADLINE_MS
  let firstError = null
  while (now() < deadline) {
    if (signal?.aborted) throw new QoderDeviceLoginError('LOGIN_CANCELLED', '登录已取消。', false)
    try {
      const result = await pollDeviceToken(attempt, { fetchImpl })
      if (result.status === 'complete') return result.payload
    } catch (error) {
      if (error instanceof QoderDeviceLoginError && !error.retryable) throw error
      firstError = firstError ?? error
    }
    await sleep(QODER_POLL_INTERVAL_MS)
  }
  if (signal?.aborted) throw new QoderDeviceLoginError('LOGIN_CANCELLED', '登录已取消。', false)
  throw firstError ?? new QoderDeviceLoginError('LOGIN_TIMEOUT', '登录等待已超时，请重新发起登录。', false)
}

/**
 * Build the plugin's credential document from a poll payload + userinfo.
 *
 * Shape matches `parseQoderCredential`, so the store accepts it unchanged and
 * the arbitration logic ("newest wins") applies to it naturally.
 */
export function buildCredentialFromDeviceLogin(payload, user, { now = new Date() } = {}) {
  const expiresAt =
    typeof payload.expires_at === 'string' && payload.expires_at.length > 0
      ? payload.expires_at
      : typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? new Date(now.getTime() + payload.expires_in * 1000).toISOString()
        : new Date(now.getTime() + 3600 * 1000).toISOString()
  return {
    schemaVersion: 1,
    token: payload.token,
    refreshToken: payload.refresh_token,
    expiresAt,
    ...(typeof payload.refresh_token_expires_at === 'string'
      ? { refreshTokenExpiresAt: payload.refresh_token_expires_at }
      : typeof payload.refresh_token_expires_in === 'number' &&
          payload.refresh_token_expires_in > 0
        ? {
            refreshTokenExpiresAt: new Date(
              now.getTime() + payload.refresh_token_expires_in * 1000,
            ).toISOString(),
          }
        : {}),
    user,
  }
}

/** Timeout budget for one upstream request, matching the app's 30s ceiling. */
export { QODER_POLL_ENDPOINT_TIMEOUT_MS as POLL_REQUEST_TIMEOUT_MS }
