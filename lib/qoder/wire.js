/**
 * Qoder wire protocol: endpoint resolution, request headers, body preparation.
 *
 * The Qoder model gateway speaks an OpenAI-Chat-Completions-shaped SSE stream,
 * VERIFIED against the live endpoint: a minimal POST returned
 * `data: {"choices":[{"delta":{"content":"P",...}}]}` … `data: [DONE]`.
 *
 * Two Qoder-specific details the sibling CodeBuddy connector does not have:
 *
 *  1. The gateway needs the `Cosy-*` header family. It rejects or misroutes
 *     without them, and pi-ai's provider descriptor has no per-request header
 *     hook — which is *why* a loopback shim exists at all.
 *  2. Failures arrive as `event: error` frames inside an HTTP **200** stream.
 *     A client that only checks the status code reads a hard failure as success.
 *
 * @module dsh-qoder-cli/wire
 */

import { randomUUID } from 'node:crypto'
import {
  QODER_CHAT_HOST,
  QODER_CHAT_PATH,
  QODER_MODEL_HOST_ENV,
} from './constants.js'

/**
 * Resolve the chat-completion URL.
 *
 * The host is NOT region-dependent: the Qoder bundle's host table carries no
 * `.cn` variant, so both regions reach the gateway through the same `.qoder.sh`
 * host. The one override the bundle honours is `QODER_MODEL_SERVER_HOST`, which
 * is applied here too so an operator can redirect the route without a code
 * change. The URL is rebuilt on every call so an environment change takes effect
 * without a restart.
 */
export function qoderChatUrl(env = process.env) {
  const override = typeof env?.[QODER_MODEL_HOST_ENV] === 'string'
    ? env[QODER_MODEL_HOST_ENV].trim()
    : ''
  const host = override.length > 0
    ? override.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    : QODER_CHAT_HOST
  return `https://${host}${QODER_CHAT_PATH}`
}

/**
 * Headers every authenticated Qoder gateway request carries.
 *
 * `Cosy-ClientType` / `Cosy-Version` / `Cosy-MachineId` are reproduced from the
 * Qoder app's own request log (main.log, `[Campaign] 活动状态请求发出 …`), not
 * guessed. `Cosy-MachineId` is omitted entirely when unknown, so the gateway
 * sees an absent header rather than an empty one.
 */
export function qoderHeaders(credential, machineId, extra = {}) {
  const headers = {
    Authorization: `Bearer ${credential.token}`,
    Accept: 'application/json',
    'User-Agent': 'Qoder',
    'Cosy-ClientType': '10',
    'Cosy-Version': '0.2.5',
    'X-Request-ID': randomUUID(),
  }
  if (typeof machineId === 'string' && machineId.length > 0) {
    headers['Cosy-MachineId'] = machineId
  }
  return { ...headers, ...extra }
}

/**
 * Model keys whose reasoning can be switched off, measured live.
 *
 * Turning reasoning off is the single largest cost lever on this gateway: it
 * removes the `reasoning_tokens` that dominate `completion_tokens`. Measured
 * 2026-09-21 with `enable_thinking:false` at a fixed prompt and max_tokens:
 *
 *   qmodel  1024 -> 3 completion tokens   (~340x)
 *   qmodel   207 -> 10                    (~20x)
 *   gmodel    64 -> 6
 *
 * `kmodel` and `dmodel` are deliberately ABSENT: they ignored every switch we
 * tried (`enable_thinking`, `chat_template_kwargs`, `thinking_budget:0`,
 * `reasoning_effort:none`, `reasoning:{enabled:false}`) and kept emitting
 * reasoning tokens. Sending a flag that is silently ignored would be worse than
 * sending nothing, because it would look like the setting worked.
 *
 * NOTE: this is measured on the REST gateway only. Whether the CLI channel
 * (`agent_chat_generation`) honours it is UNVERIFIED.
 */
export const THINKING_DISABLEABLE_MODELS = Object.freeze(
  new Set(['qmodel', 'qfmodel', 'qmodel_38max', 'qmodel_38flash', 'gmodel', 'gfmodel']),
)

/**
 * Apply the cost-saving knobs to an outgoing body.
 *
 * Only ever ADDS `enable_thinking:false`, and only for a model measured to
 * accept it. An explicit caller-supplied value always wins, so a user who wants
 * reasoning can still ask for it.
 *
 * @param {object} body  A parsed OpenAI-shaped chat body (mutated in place).
 * @returns {object} the same body, for chaining.
 */
export function applyCostControls(body) {
  if (body === null || typeof body !== 'object') return body
  if (body.enable_thinking !== undefined) return body
  if (typeof body.model !== 'string' || !THINKING_DISABLEABLE_MODELS.has(body.model)) return body
  body.enable_thinking = false
  return body
}

/**
 * Validate and normalize a chat body forwarded from the shim.
 *
 * The shim sits between DSH and the gateway, so a malformed body is caught here
 * instead of being relayed. Rejecting loudly matters more than being permissive:
 * the gateway reports model errors inside a 200 stream, so a locally-detected
 * malformed request is the only place a clear error can be produced.
 */
export function prepareChatBody(raw) {
  const parsed = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('qoder: chat body must be a JSON object')
  }
  if (typeof parsed.model !== 'string' || parsed.model.length === 0) {
    throw new Error('qoder: chat body must name a model')
  }
  if (!Array.isArray(parsed.messages)) {
    throw new Error('qoder: chat body must carry a messages array')
  }
  return applyCostControls(parsed)
}

/**
 * True when a stream chunk contains a Qoder in-band failure frame.
 *
 * The gateway answers HTTP 200 and then reports the failure INSIDE the stream,
 * so the status line proves nothing. The original check matched four literals
 * and therefore missed the OpenAI-standard error envelope
 * (`data: {"error":{"code":...}}`), which is both the most likely real-world
 * shape and the one an OpenAI-compatible client expects.
 *
 * The predicate stays conservative: a chunk only counts as an error when a
 * `data:` frame parses as JSON AND carries an error signal. Prose that merely
 * mentions the word "error" must not trip it.
 */
export function isQoderErrorFrame(chunk) {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  if (text.includes('event: error')) return true
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice('data:'.length).trim()
    if (payload.length === 0 || payload === '[DONE]') continue
    let parsed
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object') continue
    if (parsed.error !== undefined && parsed.error !== null) return true
    if (typeof parsed.type === 'string' && parsed.type.toLowerCase().includes('error')) return true
    if (typeof parsed.code === 'string' && /invalid_model_error|rate_limit|aborted/i.test(parsed.code)) return true
  }
  return false
}

/**
 * True when a stream chunk terminates the completion.
 */
export function isQoderDoneFrame(chunk) {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  return text.includes('[DONE]')
}

/**
 * Parse one SSE `data:` payload from a Qoder stream, or `null` when the line is
 * not a data frame.
 */
export function parseSseDataFrame(line) {
  const trimmed = typeof line === 'string' ? line.trim() : ''
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice('data:'.length).trim()
  if (payload.length === 0 || payload === '[DONE]') return null
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}
