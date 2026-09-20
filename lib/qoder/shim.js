/**
 * The loopback shim that sits between DSH and the Qoder gateway.
 *
 * Why a shim exists at all: pi-ai's provider descriptor can set static headers,
 * but the Qoder gateway needs `Cosy-*` headers whose values are resolved per
 * request from the live credential, and it needs them on every call. pi-ai has
 * no per-request header hook, so the connector terminates the request locally,
 * adds the headers, and relays upstream.
 *
 * Security posture, mirroring the sibling CodeBuddy connector:
 *  - The listener binds `127.0.0.1` on an ephemeral port, so it is unreachable
 *    from the network and cannot collide with a fixed port.
 *  - Every call must present a per-process random bearer, compared in constant
 *    time. DSH resolves it through `resolveApiKey`, so it never leaves the
 *    process in configuration.
 *  - `Host` and `Origin` must both be loopback, which blocks a browser page from
 *    reaching the shim via DNS rebinding.
 *
 * @module dsh-qoder-cli/shim
 */

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { KIND_STATUS } from './relay.js'
import { findWorkingCredential, isCredentialFailure } from './credential-failover.js'
import { prepareChatBody } from './wire.js'

/** Loopback hostnames a request may address. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Largest request body accepted, matching the sibling connector. */
const REQUEST_BODY_LIMIT = 64 * 1024 * 1024

/** True when a `Host` header names the loopback interface. */
export function hostIsLoopback(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  // Strip the port; a bracketed IPv6 literal keeps its brackets.
  const bare = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0]
  return LOOPBACK_HOSTS.has(bare)
}

/** True when an `Origin` header is absent or names the loopback interface. */
export function originIsLoopback(origin) {
  if (origin === undefined || origin === null) return true
  if (typeof origin !== 'string' || origin.length === 0) return true
  try {
    const parsed = new URL(origin)
    return LOOPBACK_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function writeOpenAiError(res, status, kind, message) {
  writeJson(res, status, {
    error: { message, type: kind, code: kind, param: null },
  })
}

function isJsonContentType(req) {
  const value = req.headers['content-type']
  if (typeof value !== 'string') return false
  return value.split(';')[0].trim().toLowerCase() === 'application/json'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > REQUEST_BODY_LIMIT) {
        reject(new Error('qoder: request body exceeds the shim limit'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Start the shim.
 *
 * @param {object} options
 * @param {object} options.store     Credential store (`resolve()`).
 * @param {object} options.client    Upstream client (`chatStream()`).
 * @param {() => object[]} options.catalog  Current model catalog.
 * @param {object} [options.logger]
 */
export function createQoderShim(options) {
  const { store, client, catalog, failover = false, failoverDiscover = null, failoverUnprotect = null, logger: shimLogger } = options
  const logger = options.logger
  const SHARED_SECRET = randomBytes(32).toString('base64url')

  /** Constant-time bearer check; absent or mismatched bearers are rejected. */
  function bearerOk(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string') return false
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match === null) return false
    const presented = Buffer.from(match[1])
    const expected = Buffer.from(SHARED_SECRET)
    if (presented.length !== expected.length) return false
    return timingSafeEqual(presented, expected)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) writeOpenAiError(res, 500, 'internal', String(error))
      else res.end()
    })
  })

  const ready = new Promise((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })

  server.listen(0, '127.0.0.1')

  const baseUrl = () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('qoder: shim has no listening address')
    }
    return `http://127.0.0.1:${address.port}`
  }

  async function handle(req, res) {
    if (!hostIsLoopback(req.headers.host)) {
      writeOpenAiError(res, 403, 'host_not_allowed', 'Host header must name the loopback interface')
      return
    }
    if (!originIsLoopback(req.headers.origin)) {
      writeOpenAiError(res, 403, 'origin_not_allowed', 'Origin must be a loopback origin')
      return
    }
    if (!bearerOk(req)) {
      writeOpenAiError(res, 401, 'unauthorized', 'missing or invalid Authorization bearer')
      return
    }

    const url = req.url ?? '/'
    if (req.method === 'GET' && (url === '/healthz' || url === '/healthz/')) {
      writeJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      writeJson(res, 200, {
        object: 'list',
        data: catalog().map((model) => ({
          id: model.id,
          object: 'model',
          created: 0,
          owned_by: 'qoder',
        })),
      })
      return
    }
    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      await chatCompletions(req, res)
      return
    }
    writeOpenAiError(res, 404, 'not_found', `no such route: ${req.method} ${url}`)
  }

  async function chatCompletions(req, res) {
    if (!isJsonContentType(req)) {
      writeOpenAiError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json')
      return
    }

    let resolved
    try {
      resolved = await store.resolve()
    } catch (error) {
      writeOpenAiError(res, 401, 'not_signed_in', String(error?.message ?? error))
      return
    }

    let body
    try {
      body = prepareChatBody((await readBody(req)).toString('utf8'))
    } catch (error) {
      writeOpenAiError(res, 400, 'invalid_request', String(error?.message ?? error))
      return
    }

    const controller = new AbortController()
    req.on('close', () => controller.abort())

    const result = await client.chatStream(
      { credential: resolved.credential, machineId: resolved.machineId },
      body,
      controller.signal,
    )

    if (!result.ok) {
      const status = KIND_STATUS[result.kind] ?? 502
      // Credential failover: an auth/model rejection might succeed with a
      // different discoverable credential (IDE store vs CLI store vs explicit
      // file). Walk them once; the first survivor is memoised for the process.
      if (failover === true && failoverDiscover && isCredentialFailure(status, result.message ?? '')) {
        const alternate = await findWorkingCredential(failoverDiscover, failoverUnprotect).catch(() => null)
        if (alternate && (!resolved || resolved.credential?.token !== alternate.token)) {
          const retry = await client.chatStream(
            { credential: { ...resolved.credential, token: alternate.token }, machineId: alternate.machineId ?? resolved.machineId },
            body,
            controller.signal,
          )
          if (retry.ok) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            })
            const retryStream = Readable.fromWeb(retry.response.body)
            retryStream.on('error', (error) => {
              logger?.warn?.('dsh-qoder-cli: failover stream failed mid-flight', error)
              if (res.writable) res.end()
            })
            retryStream.pipe(res)
            return
          }
        }
      }
      writeOpenAiError(res, status, result.kind, result.message)
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const stream = Readable.fromWeb(result.response.body)
    stream.on('error', (error) => {
      logger?.warn?.('dsh-qoder-cli: upstream stream failed mid-flight', error)
      if (res.writable) res.end()
    })
    stream.pipe(res)
  }

  return {
    ready,
    baseUrl,
    token: () => SHARED_SECRET,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(() => resolve())
        server.closeAllConnections()
        server.once('error', reject)
      }),
  }
}
