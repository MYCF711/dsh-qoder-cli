/**
 * Upstream client for the Qoder model gateway.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 *  1. **A 200 is not success.** Qoder reports `invalid_model_error` as an
 *     `event: error` frame inside an HTTP 200 `text/event-stream`. A client that
 *     trusts the status code hands DSH a stream containing no tokens and no
 *     error, which surfaces as an unexplained empty reply.
 *  2. **Failures are classified, not flattened.** The shim maps the kind onto an
 *     HTTP status, and DSH's retry policy reads the difference between "your
 *     token is bad" (do not retry) and "the server hiccuped" (retry).
 *
 * @module dsh-qoder-cli/relay
 */

import { qoderChatUrl, qoderHeaders } from './wire.js'

/** Timeout for the initial response headers. */
const HEADER_TIMEOUT_MS = 60_000

/** Maximum bytes of head inspected for an in-band error frame. */
const PEEK_LIMIT_BYTES = 4096

/** Map a failure kind onto the HTTP status the shim answers with. */
export const KIND_STATUS = Object.freeze({
  auth_error: 401,
  rate_limit: 429,
  server_error: 502,
  http_error: 502,
  not_signed_in: 401,
})

/** Classify a non-2xx upstream status. */
export function classifyUpstreamStatus(status) {
  if (status === 401 || status === 403) return 'auth_error'
  if (status === 408 || status === 429) return 'rate_limit'
  if (status >= 500 && status < 600) return 'server_error'
  return 'http_error'
}

/** Extract the human message from a Qoder in-band error frame, if present. */
function errorMessageFromFrame(text) {
  const match = text.match(/\{\s*"code"\s*:\s*"[^"]*"[\s\S]*?\}/)
  if (match !== null) {
    try {
      const parsed = JSON.parse(match[0])
      if (typeof parsed.message === 'string') return parsed.message
    } catch {
      // fall through to the raw slice
    }
  }
  return text.slice(0, 400)
}

export class QoderUpstreamClient {
  #fetch
  #machineIdProvider

  constructor(options = {}) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch
    if (typeof this.#fetch !== 'function') {
      throw new Error('qoder: no fetch implementation available')
    }
    this.#machineIdProvider = options.machineIdProvider ?? (async () => null)
  }

  /**
   * Stream one chat completion.
   *
   * @returns {Promise<{ok: true, response: Response} | {ok: false, kind: string, status: number, message: string}>}
   */
  async chatStream({ credential, machineId }, body, signal) {
    const url = qoderChatUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onAbort, { once: true })

    let response
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: qoderHeaders(
          credential,
          machineId ?? null,
          { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        ),
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      return {
        ok: false,
        kind: error?.name === 'AbortError' ? 'server_error' : 'http_error',
        status: 0,
        message: `qoder: request to the model gateway failed: ${error?.message ?? String(error)}`,
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 400)
      } catch {
        // The status alone is enough to classify.
      }
      return {
        ok: false,
        kind: classifyUpstreamStatus(response.status),
        status: response.status,
        message: detail.length > 0 ? detail : `qoder upstream HTTP ${response.status}`,
      }
    }

    // Peek the first frames for an in-band failure before handing the stream on.
    // Only the head is inspected; the rest is piped through untouched so the
    // live stream stays streaming.
    const [head, tail] = response.body.tee()
    const reader = head.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    try {
      // Read only until the first complete SSE frame (or a small ceiling).
      // Stopping at the first frame boundary is what keeps the rest of the
      // stream live: everything unread stays buffered in `tail`.
      while (seen.length < PEEK_LIMIT_BYTES) {
        const { value, done } = await reader.read()
        if (done) break
        seen += decoder.decode(value, { stream: true })
        if (seen.includes('\n\n') || seen.includes('[DONE]')) break
      }
    } catch {
      // A read failure is classified from whatever text was collected.
    } finally {
      reader.cancel().catch(() => {})
    }

    if (seen.includes('event: error') || seen.includes('"type":"invalid_model_error"')) {
      return {
        ok: false,
        kind: 'http_error',
        status: 200,
        message: `qoder reported an in-band error on a 200 stream: ${errorMessageFromFrame(seen)}`,
      }
    }

    return { ok: true, response: new Response(tail, { status: 200, headers: response.headers }) }
  }

  /** Resolve the machine id used by the `Cosy-MachineId` header. */
  machineId() {
    return this.#machineIdProvider()
  }
}
