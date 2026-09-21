/**
 * Qoder credential store: discovery, freshness arbitration, refresh, fallback.
 *
 * Design rules this module holds to:
 *
 *  - **Never write to Qoder's own files.** The app owns `auth.v1.dat`; a second
 *    writer would corrupt its lock protocol. Refreshed tokens go to the plugin's
 *    own copy under `$DSH_HOME`.
 *  - **Either side may be fresher.** The user can re-login in the Qoder app at
 *    any time; the plugin copies a refreshed token too. The newest wins rather
 *    than whichever was read first.
 *  - **A failed refresh must not fail the request.** An unreachable refresh
 *    endpoint leaves the still-valid cached token in place. Throwing here would
 *    turn a transient network problem into "provider broken".
 *
 * @module dsh-qoder-cli/store
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { getMachineId } from './native.js'

/** Error code the shim maps to HTTP 401. */
export const NOT_SIGNED_IN_CODE = 'NOT_SIGNED_IN'

/** Raised when no usable Qoder credential can be found. */
export class QoderNotSignedInError extends Error {
  constructor(detail) {
    super(
      `Qoder is not signed in: ${detail}. Sign in with the Qoder desktop app or CLI first` +
        ' (the credential is read from its own store).',
    )
    this.name = 'QoderNotSignedInError'
    this.code = NOT_SIGNED_IN_CODE
  }
}

/** Milliseconds before expiry at which a token is considered stale. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

function expiryMs(credential) {
  if (typeof credential?.expiresAt !== 'string') return null
  const parsed = Date.parse(credential.expiresAt)
  return Number.isFinite(parsed) ? parsed : null
}

/** True when the credential is absent, undated, or within the skew window. */
export function isStale(credential, now = Date.now()) {
  const at = expiryMs(credential)
  if (at === null) return true
  return at - REFRESH_SKEW_MS <= now
}

/**
 * Owns the plugin's credential view.
 */
export class QoderCredentialStore {
  #ownPath
  #discover
  #refresh
  #readOwn
  #writeOwn
  #cache = null
  #lastSavedAt = null

  constructor(options) {
    this.#ownPath = options.ownPath
    this.#discover = options.discover
    this.#refresh = options.refresh
    this.#readOwn = options.readOwn ?? (async (path) => {
      try {
        return JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        // A corrupt own-copy must not disable the provider; the discovered
        // credential is still authoritative.
        return null
      }
    })
    this.#writeOwn = options.writeOwn ?? (async (path, document) => {
      // Write to a sibling temp file and rename into place: a reader never sees
      // a half-written credential, and a crash mid-write cannot destroy the
      // previous copy.
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(document), 'utf8')
      await rename(temporary, path)
    })
  }

  get ownPath() {
    return this.#ownPath
  }

  /**
   * Resolve a usable credential, refreshing when stale and degrading gracefully.
   */
  async resolve() {
    const own = await this.#readOwn(this.#ownPath).catch(() => null)
    const discovered = await this.#discover().catch(() => null)

    const candidates = []
    if (own?.credential) {
      candidates.push({
        credential: own.credential,
        machineId: own.machineId ?? null,
        savedAt: Date.parse(own.savedAt ?? '') || 0,
      })
    }
    if (discovered?.credential) {
      candidates.push({
        credential: discovered.credential,
        machineId: discovered.machineId ?? null,
        savedAt: this.#lastSavedAt ?? 0,
      })
    }

    if (candidates.length === 0) {
      if (this.#cache !== null) return this.#cache
      throw new QoderNotSignedInError('no credential found in any known location')
    }

    // Newest wins; a tie prefers the discovered credential, since the user
    // re-logging in through Qoder is the more authoritative event.
    candidates.sort((a, b) => b.savedAt - a.savedAt)
    let chosen = discovered?.credential
      ? candidates.find((c) => c.credential === discovered.credential) ?? candidates[0]
      : candidates[0]

    if (isStale(chosen.credential)) {
      try {
        const refreshed = await this.#refresh(chosen.credential, chosen.machineId)
        if (refreshed !== null && refreshed !== undefined) {
          chosen = { ...chosen, credential: refreshed }
          this.#lastSavedAt = Date.now()
          await this.saveOwn(refreshed, chosen.machineId).catch(() => {})
        }
      } catch {
        // Deliberate: keep serving the cached token. See module docs.
      }
    }

    this.#cache = chosen
    return chosen
  }

  /** Persist the plugin's own credential copy. Never touches Qoder's files. */
  async saveOwn(credential, machineId) {
    const document = {
      credential,
      machineId: machineId ?? null,
      savedAt: new Date().toISOString(),
    }
    await this.#writeOwn(this.#ownPath, document)
    this.#lastSavedAt = Date.now()
  }

  /** Forget the in-process cache; the next resolve re-reads every source. */
  invalidate() {
    this.#cache = null
  }
}

/** Resolve the machine id used by the `Cosy-MachineId` header. */
export async function resolveMachineId(dir) {
  return getMachineId(dir)
}
