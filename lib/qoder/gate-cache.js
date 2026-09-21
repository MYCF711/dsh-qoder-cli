/**
 * Per-account gate cache: what this account's chat gateway actually accepts.
 *
 * The bundled catalog snapshot shows every model the server currently offers,
 * but the chat gateway greys models per account. This module records one
 * lightweight probe round (1 token per model) so the settings card can mark
 * each entry with THIS account's measured reality instead of the snapshot's
 * snapshot-of-a-different-account.
 *
 * Cache lives beside the plugin's own credential copy under $DSH_HOME and is
 * valid for 24h; a stale cache triggers a background re-probe, never a block.
 *
 * @module dsh-qoder-cli/gate-cache
 */

import { readFile, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'

/** Probe results older than this are re-measured (ms). */
export const GATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Chat gateway endpoint used by the probe (same as the shim's chat path). */
const CHAT_HOST = 'https://api2-v2.qoder.sh'
const CHAT_PATH = '/model/v1/chat/completions'

/** Milliseconds between consecutive probe requests (be gentle). */
const PROBE_INTERVAL_MS = 300

/** Max tokens per probe request — this is a reachability check, not a chat. */
const PROBE_MAX_TOKENS = 1

export function gateCachePath(dshHome) {
  return join(dshHome, '.qoder-cli-gate-cache.json')
}

/** Load a previously measured cache; null when absent/corrupt/expired. */
export async function loadGateCache(dshHome, now = Date.now()) {
  try {
    const doc = JSON.parse(await readFile(gateCachePath(dshHome), 'utf8'))
    // `typeof null` and `typeof []` are both 'object', so check for a plain
    // object explicitly: a null/array `results` is a different tool's file, not
    // a measurement, and must degrade to null (re-probe) rather than be trusted.
    const results = doc?.results
    if (doc?.measuredAt && typeof results === 'object' && results !== null && !Array.isArray(results)) {
      const age = now - Date.parse(doc.measuredAt)
      if (Number.isFinite(age) && age >= 0 && age <= GATE_CACHE_TTL_MS) return doc
    }
    return null
  } catch {
    return null
  }
}

/** Persist a probe round atomically (temp + rename, same as the store). */
export async function saveGateCache(dshHome, results, now = Date.now()) {
  const doc = { version: 1, measuredAt: new Date(now).toISOString(), results }
  const path = gateCachePath(dshHome)
  const tmp = `${path}.${process.pid}.tmp`
  await mkdirSafe(dirname(path))
  await writeFile(tmp, JSON.stringify(doc), 'utf8')
  await rename(tmp, path)
}

async function mkdirSafe(dir) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
}

/**
 * Probe one model key against the chat gateway.
 * Returns 'accepted' | 'rejected' | 'unknown'.
 */
export async function probeModelKey(key, token, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(CHAT_HOST + CHAT_PATH, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'qoder-worker/1.1.57',
      },
      body: JSON.stringify({
        model: key,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
      }),
    })
    if (response.status === 200) return 'accepted'
    if (response.status === 400) {
      const body = await response.text().catch(() => '')
      return body.includes('invalid_model_error') ? 'rejected' : 'unknown'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Probe a whole catalog (unique keys only, gently spaced).
 * Returns `{ [key]: status }`.
 */
export async function probeCatalog(entries, token, fetchImpl = fetch) {
  const seen = new Set()
  const results = {}
  let first = true
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    if (!first) await sleep(PROBE_INTERVAL_MS)
    first = false
    results[entry.id] = await probeModelKey(entry.id, token, fetchImpl)
  }
  return results
}

/**
 * Resolve a usable Bearer token for probing, trying the plugin credential
 * chain first, then the CLI device-flow store (same fallback as the gate tool).
 * Returns null when neither path yields a live token.
 */
export async function resolveProbeToken(discover, dpapiUnprotect, configHome = null) {
  try {
    const found = await discover(dpapiUnprotect, process.env)
    if (found?.credential?.token) return found.credential.token
  } catch {
    // fall through to the CLI store
  }
  try {
    const { readFile } = await import('node:fs/promises')
    const home = configHome ?? process.env.QODER_CONFIG_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.qoder')
    const raw = await readFile(join(home, '.auth', 'user'), 'utf8')
    const machineId = (await readFile(join(home, '.auth', 'machine_id'), 'utf8')).trim()
    const { init, credentialStorageDecrypt } = await import('./wasm-credential-reader.js')
    await init()
    const userInfo = JSON.parse(await credentialStorageDecrypt(raw, machineId.slice(0, 16)))
    return userInfo.security_oauth_token ?? userInfo.access_token ?? null
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
