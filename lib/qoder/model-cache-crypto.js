/**
 * Qoder model-cache codec — pure JS (no WASM).
 *
 * This replaces the *other* half of the bundled auth WASM. It is a DIFFERENT
 * construction from the credential codec in `wasm-credential-reader.js`; do not
 * mix the two up (see "Why this is not the credential path" below).
 *
 * ## Container layout
 *
 *   magic(4) = 51 4d 43 01 ("QMC\x01")   ‖  nonce(12)  ‖  ciphertext(>=0)  ‖  tag(16)
 *   byte 0..3     4..15                    16..n-17          n-16..n-1
 *
 * The whole container is stored base64-encoded (the on-disk `catalog-v6` file is
 * that base64 *text*, not raw bytes).
 *
 * ## Key derivation
 *
 *   key = HKDF-SHA256(
 *     ikm  = utf8(uid),                 // the account uid string, e.g. "<UID>"
 *     salt = "qoder-model-cache-enc",    // 21 bytes
 *     info = "model-cache-v1",           // 13 bytes
 *     L    = 32                          // => AES-256-GCM, not AES-128
 *   )
 *
 * `salt` and `info` were the single hardest part of the recovery: the two ASCII
 * strings are swappable-looking and only this assignment authenticates. Putting
 * `qoder-model-cache-enc` in `info` (the intuitive reading) yields a 32-byte key
 * of the right *length* that fails only at tag verification — i.e. it looks like
 * "wrong uid" rather than "wrong KDF parameter".
 *
 * ## Cipher
 *
 *   AES-256-GCM, AAD = none (empty), tag = 16 bytes, nonce = the 12 container
 *   bytes at offset 4.
 *
 * ## Why the checks exist (each one is a real failure we hit)
 *
 * - **magic check**: the WASM reads a *versioned* container. A non-container
 *   input that is still valid base64 would otherwise be fed to GCM and rejected
 *   as a tag mismatch, which reads as "wrong uid" and sends the caller chasing
 *   the wrong parameter. Checking the magic first names the actual problem.
 * - **length floor of 32**: 4 magic + 12 nonce + 0 ciphertext + 16 tag is the
 *   smallest well-formed empty-plaintext container. Shorter input means the
 *   buffer is truncated (or base64 decode silently dropped bytes — `Buffer
 *   .from(x, 'base64')` never throws, it just stops), so we reject it up front
 *   instead of slicing a negative-length ciphertext body. A negative `subarray`
 *   range silently yields the wrong slice, not an error.
 * - **random 12-byte nonce**: GCM nonces must never repeat under one key. Qoder
 *   uses the same uid-derived key for the whole lifetime of an account, so a
 *   fixed or counter-based nonce would be a catastrophic reuse. The nonce is
 *   stored in the container, so randomness costs nothing at decrypt time.
 * - **no AAD**: the WASM passes none. Adding AAD (e.g. the uid) would be
 *   *stronger* but would diverge from the oracle and break interop with Qoder's
 *   own writer, which is the thing we must stay byte-compatible with.
 *
 * ## Why this is NOT the credential path
 *
 * The credential codec (`credentialStorageDecrypt/Encrypt`) keys on
 * `machine_id.slice(0,16)` used verbatim as both key and IV with AES-128-CBC and
 * PKCS#7 — no KDF, no tag, no container. This codec keys on the **uid** through
 * **HKDF** and uses **AES-256-GCM** with a **magic-prefixed container**. The two
 * share nothing: different key material, different cipher, different mode,
 * different framing, different base64 role (credential payload *is* the whole
 * file; here the base64 is a wrapper around a binary container). Copying a
 * lesson from one path to the other silently produces "authentication failed"
 * with no hint about which parameter is wrong.
 *
 * Evidence: independently reproduced by the captain from scratch and cross-checked
 * byte-for-byte against the shipped WASM in both directions on real
 * `catalog-v6` samples (`test/wasm-encrypt-helper.mjs` is the oracle).
 *
 * @module dsh-qoder-cli/model-cache-crypto
 */

import crypto from 'node:crypto'

/** Container magic: ASCII "QMC" + format version 1. */
const MAGIC = Buffer.from([0x51, 0x4d, 0x43, 0x01])
const MAGIC_HEX = MAGIC.toString('hex')

const KDF_SALT = Buffer.from('qoder-model-cache-enc', 'utf8')
const KDF_INFO = Buffer.from('model-cache-v1', 'utf8')
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** 4 magic + 12 nonce + 0 plaintext + 16 tag: the smallest valid container. */
const MIN_CONTAINER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES

/**
 * Derive the 32-byte AES-256-GCM key for one account.
 *
 * The ikm is the uid's UTF-8 bytes — uid is a UUID string in practice, so the
 * byte length equals the character length; we do not slice or normalise it.
 * A uid is not secret material on its own, but it is the only input, so a wrong
 * or empty uid produces a key that fails at tag verification, never earlier.
 */
function deriveKey(uid) {
  const text = String(uid ?? '')
  if (text.length === 0) throw new Error('model-cache key requires a non-empty uid')
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(text, 'utf8'), KDF_SALT, KDF_INFO, KEY_BYTES))
}

/** Decode a container that may arrive as base64 text or as raw bytes. */
function toContainer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  // base64 decode never throws: on invalid input it stops early and can return a
  // short buffer. The length check below is therefore also the base64 check.
  return Buffer.from(String(input ?? ''), 'base64')
}

/**
 * Decrypt one model-cache container.
 *
 * @param {string} containerBase64 base64 *text* of the container (as stored on disk)
 * @param {string} uid account uid used as HKDF ikm
 * @returns {Buffer} plaintext bytes (typically UTF-8 JSON)
 * @throws {Error} on bad magic, truncated container, or failed GCM authentication
 */
export function modelCacheDecrypt(containerBase64, uid) {
  const raw = toContainer(containerBase64)
  if (raw.length < MIN_CONTAINER_BYTES || raw.subarray(0, MAGIC.length).toString('hex') !== MAGIC_HEX) {
    throw new Error(
      `not a model-cache container (len=${raw.length}, magic=${raw.subarray(0, MAGIC.length).toString('hex') || 'none'})`,
    )
  }
  const key = deriveKey(uid)
  const nonce = raw.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES)
  const ciphertext = raw.subarray(MAGIC.length + NONCE_BYTES, raw.length - TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES))
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Encrypt one plaintext into a model-cache container.
 *
 * @param {string} plainJson plaintext (UTF-8 JSON text) — the whole buffer is encrypted
 * @param {string} uid account uid used as HKDF ikm
 * @returns {string} base64 text of the container, ready to be written to `catalog-v6`
 */
export function modelCacheEncrypt(plainJson, uid) {
  const key = deriveKey(uid)
  const nonce = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(plainJson ?? ''), 'utf8')), cipher.final()])
  return Buffer.concat([MAGIC, nonce, ciphertext, cipher.getAuthTag()]).toString('base64')
}

/** True when the buffer/text carries the model-cache magic. Cheap pre-check. */
export function isModelCacheContainer(input) {
  const raw = toContainer(input)
  return raw.length >= MIN_CONTAINER_BYTES && raw.subarray(0, MAGIC.length).toString('hex') === MAGIC_HEX
}
