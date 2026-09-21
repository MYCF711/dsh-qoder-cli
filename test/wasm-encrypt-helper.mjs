// Test helper: build Qoder wire artefacts from known inputs.
//
// Two codecs live here, mirroring lib/qoder/wasm-credential-reader.js:
//
//   * credentialStorageEncrypt / Decrypt — AES-128-CBC + PKCS#7 where
//     key === IV === utf8(machine_id.slice(0, 16)). Pure node:crypto, no WASM.
//     Verified byte-for-byte against the previous WASM implementation on a real
//     credential and across ten plaintext lengths of 0..1000 bytes.
//     Evidence: docs/CREDENTIAL-CRYPTO-ANALYSIS.md (algorithm recovery),
//     docs/CREDENTIAL-WASM-STRINGS.md (binary survey).
//   * modelCacheEncrypt / Decrypt — the model-cache container is a DIFFERENT
//     construction and has not been ported, so these delegate to the library's
//     own WASM-backed implementation rather than duplicating its glue here.
//
// init() therefore only matters for the model-cache half; the credential half
// needs no setup at all. It is kept (and still accepts the WASM_PATH argument)
// because every existing test calls `await init(WASM_PATH)` up front.

import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

// Re-export the library's WASM-backed model-cache codec so this helper keeps a
// single source of truth for that half. Importing it also means a defect there
// fails here rather than being masked by a copy.
import {
  init,
  getExports,
  modelCacheEncrypt,
  modelCacheDecrypt,
  WASM_PATH,
} from '../lib/qoder/wasm-credential-reader.js'

export { init, getExports, modelCacheEncrypt, modelCacheDecrypt, WASM_PATH }

const CREDENTIAL_ALGO = 'aes-128-cbc'
const BLOCK_BYTES = 16

/** Same contract as the library: the first 16 characters, as UTF-8 bytes. */
function credentialKey(keyText) {
  const text = String(keyText ?? '').slice(0, 16)
  const key = Buffer.from(text, 'utf8')
  if (key.length !== BLOCK_BYTES) {
    throw new Error(`credential key must be 16 bytes, got ${key.length} (prefix: ${JSON.stringify(text)})`)
  }
  return key
}

export function credentialStorageEncrypt(payload, keyText) {
  const key = credentialKey(keyText)
  const cipher = crypto.createCipheriv(CREDENTIAL_ALGO, key, key)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(Buffer.from(String(payload), 'utf8')), cipher.final()]).toString('base64')
}

export function credentialStorageDecrypt(payload, keyText) {
  const key = credentialKey(keyText)
  const raw = Buffer.from(String(payload), 'base64')
  if (raw.length === 0 || raw.length % BLOCK_BYTES !== 0) {
    throw new Error(`credential ciphertext must be a non-empty multiple of 16 bytes, got ${raw.length}`)
  }
  const decipher = crypto.createDecipheriv(CREDENTIAL_ALGO, key, key)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf8')
}

// Kept for callers that used `import { fileURLToPath }`-style path resolution
// through this module; now identical to the library's constant.
export const HELPER_WASM_PATH = fileURLToPath(new URL('../lib/qoder/wasm/qoder_auth_wasm_bg.wasm', import.meta.url))
