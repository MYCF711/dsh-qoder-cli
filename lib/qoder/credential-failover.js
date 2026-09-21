/**
 * Credential failover: when a request fails with an auth/model-availability
 * error, walk every discoverable Qoder credential until one works.
 *
 * Sources, in priority order (all read-only):
 *  1. the plugin's own credential copy (already what `store.resolve()` does);
 *  2. the IDE/desktop store (`auth.v1.dat`, DPAPI);
 *  3. the CLI device-flow store (`~/.qoder/.auth/user`, WASM AES);
 *  4. an explicit file via `QODER_CLI_AUTH_FILE`.
 *
 * A credential that survives a probe is memoised for the process lifetime so
 * subsequent requests skip the walk. Everything here degrades silently: if no
 * credential works the caller's original error stands.
 *
 * @module dsh-qoder-cli/credential-failover
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Chat gateway endpoint used to validate a candidate credential. */
const PROBE_URL = 'https://api2-v2.qoder.sh/model/v1/chat/completions'

/** Error kinds that a different credential might fix. */
export const FAILOVER_KINDS = new Set(['not_signed_in', 'unauthorized', 'forbidden'])

/** True when the upstream answer means "this credential can't use this". */
export function isCredentialFailure(status, message = '') {
  if (status === 401 || status === 403) return true
  return typeof message === 'string' && message.includes('invalid_model_error')
}

/** Every alternate credential source that yields a token, lazily. */
export async function* listAlternateCredentials(discover, dpapiUnprotect, env = process.env) {
  // 2. IDE/desktop store via DPAPI
  try {
    const found = await discover(dpapiUnprotect, env)
    if (found?.credential?.token) {
      yield { token: found.credential.token, machineId: found.machineId ?? null, source: 'ide-store' }
    }
  } catch {
    // no IDE store or DPAPI unavailable
  }
  // 3. CLI device-flow store (WASM AES, key = machineId[0..16])
  try {
    const configHome = env.QODER_CONFIG_DIR ?? join(homedir(), '.qoder')
    const raw = await readFile(join(configHome, '.auth', 'user'), 'utf8')
    const machineId = (await readFile(join(configHome, '.auth', 'machine_id'), 'utf8')).trim()
    const { init, credentialStorageDecrypt } = await import('./wasm-credential-reader.js')
    await init()
    const userInfo = JSON.parse(await credentialStorageDecrypt(raw, machineId.slice(0, 16)))
    const token = userInfo.security_oauth_token ?? userInfo.access_token
    if (token) yield { token, machineId, source: 'cli-store' }
  } catch {
    // no CLI store
  }
  // 4. explicit file
  const explicit = env.QODER_CLI_AUTH_FILE
  if (explicit) {
    try {
      const parsed = JSON.parse(await readFile(explicit, 'utf8'))
      const token = parsed.token ?? parsed.security_oauth_token ?? parsed.access_token
      if (typeof token === 'string' && token) {
        yield { token, machineId: null, source: 'explicit-file' }
      }
    } catch {
      // unreadable explicit file
    }
  }
}

/**
 * Probe one credential: a 1-token chat request. Returns true when the gateway
 * accepts it (HTTP 200).
 */
export async function probeCredential(token, machineId, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(PROBE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'qoder-worker/1.1.57',
        ...(machineId ? { 'cosy-machine-id': machineId } : {}),
      },
      body: JSON.stringify({
        model: 'qmodel',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })
    return response.status === 200
  } catch {
    return false
  }
}

/**
 * Walk all alternate credentials, returning the first one whose probe passes,
 * or null when none do (or the walk itself fails). Memoised per process: once
 * a credential wins, later calls return it directly.
 */
let memoised = null

export async function findWorkingCredential(discover, dpapiUnprotect, fetchImpl = fetch) {
  if (memoised) return memoised
  for await (const candidate of listAlternateCredentials(discover, dpapiUnprotect)) {
    const ok = await probeCredential(candidate.token, candidate.machineId, fetchImpl)
    if (ok) {
      memoised = candidate
      return candidate
    }
  }
  return null
}

/** Test hook: clear the memoised credential. */
export function resetFailoverMemo() {
  memoised = null
}
