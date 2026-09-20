/**
 * Qoder credential discovery, decryption, and validation.
 *
 * The Qoder desktop app stores its login as an Electron `safeStorage` blob.
 * On Windows that is: a DPAPI-protected AES-256 key inside `Local State`, and
 * an AES-256-GCM file whose bytes are `v10 || nonce(12) || ciphertext || tag(16)`.
 *
 * Both facts are VERIFIED end to end — the decrypt was run against the live
 * install and reproduced the exact schema Qoder's own reader validates
 * (`class jK` in the app bundle). See docs/QODER-PROTOCOL-FINDINGS.md.
 *
 * This module never writes to the Qoder app's own files.
 *
 * @module dsh-qoder-cli/credentials
 */

import { createDecipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  QODER_AUTH_FILENAME,
  QODER_CREDENTIAL_FILENAME,
  QODER_LOCAL_STATE_FILENAME,
  QODER_MACHINE_ID_FILENAME,
  QODER_USER_DATA_DIRNAME,
} from './constants.js'

/** Prefix DPAPI-wrapped keys carry inside `os_crypt.encrypted_key`. */
const DPAPI_PREFIX = 'DPAPI'

/** Prefix every `safeStorage` blob carries on Windows. */
const SAFE_STORAGE_PREFIX = 'v10'

/** AES-GCM nonce length in bytes. */
const NONCE_BYTES = 12

/** AES-GCM authentication tag length in bytes. */
const TAG_BYTES = 16

/**
 * Candidate Qoder user-data directories, most specific first.
 *
 * `env` is injectable so the ordering can be tested without touching the real
 * filesystem. Windows is the only platform the app ships this layout for; the
 * macOS and Linux paths mirror Electron's own `userData` convention and are
 * UNVERIFIED.
 */
export function candidateUserDataDirs(env = process.env) {
  const out = []
  if (env.APPDATA) out.push(join(env.APPDATA, QODER_USER_DATA_DIRNAME))
  if (process.platform === 'darwin') {
    out.push(join(homedir(), 'Library', 'Application Support', QODER_USER_DATA_DIRNAME))
  } else if (process.platform === 'linux') {
    out.push(join(homedir(), '.config', QODER_USER_DATA_DIRNAME))
  }
  out.push(join(homedir(), 'AppData', 'Roaming', QODER_USER_DATA_DIRNAME))
  return [...new Set(out)]
}

/**
 * Validate the decrypted credential document.
 *
 * Field checks mirror Qoder's own reader so a credential this plugin accepts is
 * one the app would also accept. The optional `profileOverlay` and
 * `firstLoginOnboardingSeen` fields are deliberately not required: the app
 * treats them as optional, and requiring them would reject valid credentials.
 *
 * @returns the normalized credential, or `null` when the document is unusable.
 */
export function parseQoderCredential(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.schemaVersion !== 1) return null
  if (typeof value.token !== 'string' || value.token.length === 0) return null
  if (typeof value.refreshToken !== 'string' || value.refreshToken.length === 0) return null
  const user = value.user
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return null
  if (typeof user.id !== 'string' || user.id.length === 0) return null
  return {
    schemaVersion: 1,
    token: value.token,
    refreshToken: value.refreshToken,
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.refreshTokenExpiresAt === 'string'
      ? { refreshTokenExpiresAt: value.refreshTokenExpiresAt }
      : {}),
    user: {
      id: user.id,
      ...(typeof user.name === 'string' ? { name: user.name } : {}),
      ...(typeof user.email === 'string' ? { email: user.email } : {}),
      ...(typeof user.avatarUrl === 'string' ? { avatarUrl: user.avatarUrl } : {}),
    },
  }
}

/**
 * Extract the AES key from an Electron `Local State` document.
 *
 * `unprotect` is the DPAPI primitive, injected so this stays testable and so the
 * native call lives in exactly one place. It receives the key bytes *without*
 * the 5-byte `DPAPI` prefix, matching what `CryptUnprotectData` expects.
 */
export function extractSafeStorageKey(localStateText, unprotect) {
  const doc = JSON.parse(localStateText)
  const encoded = doc?.os_crypt?.encrypted_key
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('qoder: Local State has no os_crypt.encrypted_key')
  }
  const wrapped = Buffer.from(encoded, 'base64')
  if (wrapped.length <= DPAPI_PREFIX.length) {
    throw new Error('qoder: encrypted_key is too short to carry a key')
  }
  const prefix = wrapped.subarray(0, DPAPI_PREFIX.length).toString('ascii')
  if (prefix !== DPAPI_PREFIX) {
    throw new Error(`qoder: encrypted_key prefix is "${prefix}", expected "${DPAPI_PREFIX}"`)
  }
  const key = unprotect(wrapped.subarray(DPAPI_PREFIX.length))
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(`qoder: DPAPI returned ${key?.length ?? 'no'} key bytes, expected 32`)
  }
  return key
}

/**
 * Decrypt one Electron `safeStorage` blob.
 *
 * `key` must be the 32-byte AES key from {@link extractSafeStorageKey}. A wrong
 * key, a corrupted body, or a tampered tag all fail loudly — AES-GCM
 * authenticates, so a silent wrong-answer is not possible.
 */
export function decryptSafeStorage(blob, key) {
  if (!Buffer.isBuffer(blob) || blob.length <= SAFE_STORAGE_PREFIX.length + NONCE_BYTES + TAG_BYTES) {
    throw new Error('qoder: safeStorage blob is too short to be well formed')
  }
  const prefix = blob.subarray(0, SAFE_STORAGE_PREFIX.length).toString('ascii')
  if (prefix !== SAFE_STORAGE_PREFIX) {
    throw new Error(`qoder: blob prefix is "${prefix}", expected "${SAFE_STORAGE_PREFIX}"`)
  }
  const nonce = blob.subarray(SAFE_STORAGE_PREFIX.length, SAFE_STORAGE_PREFIX.length + NONCE_BYTES)
  const tag = blob.subarray(blob.length - TAG_BYTES)
  const ciphertext = blob.subarray(SAFE_STORAGE_PREFIX.length + NONCE_BYTES, blob.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Read and decrypt the Qoder credential from a user-data directory.
 *
 * @param {string} dir                Qoder user-data directory.
 * @param {(buf: Buffer) => Buffer} unprotect  DPAPI CurrentUser unprotect.
 * @returns {Promise<object|null>}    Parsed credential, or `null` when absent.
 */
export async function readCredentialFromUserDataDir(dir, unprotect) {
  let blob
  try {
    blob = await readFile(join(dir, QODER_CREDENTIAL_FILENAME))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const localState = await readFile(join(dir, QODER_LOCAL_STATE_FILENAME), 'utf8')
  const key = extractSafeStorageKey(localState, unprotect)
  const plaintext = decryptSafeStorage(blob, key)
  return parseQoderCredential(JSON.parse(plaintext.toString('utf8')))
}

/**
 * Read the plaintext machine id, or `null` when absent.
 *
 * VERIFIED: `auth.machine-id` is a 37-byte plaintext UUID string.
 */
export async function readMachineId(dir) {
  try {
    const raw = await readFile(join(dir, QODER_MACHINE_ID_FILENAME), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Locate a usable credential across the candidate directories.
 *
 * @returns {Promise<{credential: object, machineId: string|null, dir: string}|null>}
 */
export async function discoverCredential(unprotect, env = process.env) {
  const explicit = env.QODER_AUTH_FILE_ENV?.trim()
  if (explicit) {
    const raw = await readFile(explicit, 'utf8')
    const credential = parseQoderCredential(JSON.parse(raw))
    if (credential === null) throw new Error(`qoder: ${explicit} is not a usable credential`)
    return { credential, machineId: null, dir: explicit }
  }
  for (const dir of candidateUserDataDirs(env)) {
    try {
      const credential = await readCredentialFromUserDataDir(dir, unprotect)
      if (credential === null) continue
      return { credential, machineId: await readMachineId(dir), dir }
    } catch (error) {
      // A malformed store in one candidate must not hide a valid one later.
      if (error?.code === 'ENOENT') continue
      continue
    }
  }
  return null
}

/** Path the plugin owns for its refreshed credential copy. */
export function qoderOwnAuthPath(dshHome) {
  return join(dshHome, QODER_AUTH_FILENAME)
}

export {
  DPAPI_PREFIX,
  SAFE_STORAGE_PREFIX,
  NONCE_BYTES,
  TAG_BYTES,
}
