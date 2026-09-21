/**
 * Qoder credential storage codec.
 *
 * The plugin's own credential copy (`~/.qoder/.auth/user`, base64) is encrypted
 * by Qoder with AES-128-CBC + PKCS#7, using the account machine id's first 16
 * characters as **both** the key and the IV:
 *
 *   key = utf8(machine_id.slice(0, 16))   // exactly 16 bytes, no KDF
 *   iv  = key                             // the same 16 bytes
 *   out = base64(AES-128-CBC-PKCS7(plaintext))
 *
 * This was originally done by Qoder's own auth WASM. It is reproduced here with
 * `node:crypto` only, which removes a 298 KB binary (and its redistribution
 * question) from the credential path.
 *
 * Evidence: docs/CREDENTIAL-CRYPTO-ANALYSIS.md (algorithm recovery) and
 * docs/CREDENTIAL-WASM-STRINGS.md (binary survey). Verified byte-for-byte
 * against the previous WASM implementation on a real credential file and across
 * ten plaintext lengths (test/wasm-encrypt-helper.mjs keeps that comparison).
 *
 * The model-cache codec (`model_cache_encrypt/decrypt`, key = the account uid)
 * is a *separate* construction. It now runs on pure JS too; the WASM stays in
 * the package as an opt-in cross-check. See MODEL CACHE below.
 *
 * @module dsh-qoder-cli/wasm-credential-reader
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * The pure-JS model-cache codec.
 *
 * Loaded with `createRequire` + `require()` rather than a static ESM `import`,
 * and this is load-bearing, not stylistic:
 *
 *   test/failover.test.mjs copies THIS source into
 *   lib/qoder/wasm/test-fixtures/reader-shim.mjs and imports it from there. That
 *   shim only ever exercises the CREDENTIAL codec, and `./model-cache-crypto.js`
 *   does not exist beside it — a static import would therefore make the shim fail
 *   to load with ERR_MODULE_NOT_FOUND and take four unrelated credential tests
 *   down with it (observed: failover 27 passed / 4 failed).
 *
 *   `require()` is synchronous, so the model-cache wrappers below stay plain
 *   synchronous functions, which their callers depend on (see the SYNCHRONY note
 *   near MODEL CACHE). A dynamic `import()` would be async and would break
 *   test-length.mjs, which calls modelCacheEncrypt without await.
 *
 * Loading is deferred to first use inside a try/catch so that a missing codec is
 * reported by the model-cache functions themselves, not at module load time for
 * unrelated consumers.
 */
const requireFromHere = createRequire(import.meta.url)

let pureCodec = null
let pureCodecError = null

/** Resolve + load the pure-JS codec once; returns null and records why on failure. */
function loadPureCodec() {
  if (pureCodec !== null || pureCodecError !== null) return pureCodec
  try {
    // Resolved relative to THIS file, so the real module always finds its sibling.
    pureCodec = requireFromHere('./model-cache-crypto.js')
  } catch (error) {
    pureCodecError = error
  }
  return pureCodec
}

/**
 * Path of the bundled auth WASM.
 *
 * It is no longer on the model-cache *default* path (see MODEL CACHE below) but
 * is still resolvable here: `modelCache*` keeps a WASM branch for the
 * `QODER_MODEL_CACHE_WASM=1` cross-check, and callers/tests still read this
 * constant. The binary must not be deleted until the user approves it.
 */
export const WASM_PATH = fileURLToPath(new URL('./wasm/qoder_auth_wasm_bg.wasm', import.meta.url))

/**
 * Both codecs are pure JS. Kept exported for the same reason as WASM_PATH: the
 * name is part of this module's public surface (see test/failover.test.mjs,
 * which strips the `export` keyword from this exact line).
 */
export const CREDENTIAL_IS_PURE_JS = true

const CREDENTIAL_ALGO = 'aes-128-cbc'
const BLOCK_BYTES = 16

/**
 * Derive the 16-byte key from the machine id.
 *
 * Qoder takes the first 16 *characters* and uses their UTF-8 bytes verbatim —
 * there is no hashing or stretching. A machine id is normally ASCII (a UUID),
 * so 16 characters are 16 bytes; we assert that rather than silently truncating
 * a multi-byte string, because a silently wrong key would surface only as a
 * decryption failure much further away.
 */
function keyFromMachineId(machineId) {
  const text = String(machineId ?? '').slice(0, 16)
  const key = Buffer.from(text, 'utf8')
  if (key.length !== BLOCK_BYTES) {
    throw new Error(`credential key must be 16 bytes, got ${key.length} (machine id prefix: ${JSON.stringify(text)})`)
  }
  return key
}

/** Decrypt one base64 credential payload. Throws on malformed input. */
export function credentialStorageDecrypt(payload, keyText) {
  const key = keyFromMachineId(keyText)
  const raw = Buffer.from(String(payload), 'base64')
  if (raw.length === 0 || raw.length % BLOCK_BYTES !== 0) {
    throw new Error(`credential ciphertext must be a non-empty multiple of 16 bytes, got ${raw.length}`)
  }
  const decipher = crypto.createDecipheriv(CREDENTIAL_ALGO, key, key)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf8')
}

/** Encrypt one plaintext credential payload into base64. */
export function credentialStorageEncrypt(payload, keyText) {
  const key = keyFromMachineId(keyText)
  const cipher = crypto.createCipheriv(CREDENTIAL_ALGO, key, key)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(Buffer.from(String(payload), 'utf8')), cipher.final()]).toString('base64')
}

// ---------------------------------------------------------------------------
// MODEL CACHE — pure JS by default, WASM retained as an opt-in cross-check.
//
// Status: the pure-JS port is DONE (lib/qoder/model-cache-crypto.js) and is the
// default. This replaces the former TODO that said the model-cache codec "still
// runs on the WASM" — that sentence was true when written and is now false, so
// it lives here corrected rather than deleted.
//
// Why the WASM branch is kept instead of removed:
//   1. The user has NOT approved deleting the binary, so the code path that
//      exercises it must stay reachable (and the file must stay untouched).
//   2. It is the oracle the pure-JS port was validated against. Keeping it
//      reachable means a future regression can be re-checked against the
//      original implementation instead of trusting a green test alone.
//
// FALLBACK POLICY — deliberately NOT a silent runtime fallback.
//   A silent catch-WASM-on-error fallback is the worst option here: it would
//   mask precisely the bugs this port can have. A wrong key derivation or a
//   mis-sliced container would "work" via WASM and the defect would never
//   surface — the failure would be invisible on every machine that ships the
//   binary. So the switch is EXPLICIT and opt-in, and it selects a code path
//   rather than rescuing an error:
//       QODER_MODEL_CACHE_WASM=1  -> use the WASM implementation
//       anything else / unset     -> use the pure-JS implementation (default)
//   Errors from the selected path propagate unchanged; neither path silently
//   delegates to the other. Compare the two by running the same inputs with the
//   env var on and off (test/wasm-encrypt-helper.mjs is the oracle harness).
//
// Resolution note (do not "simplify" this to a bare './model-cache-crypto.js'):
//   test/failover.test.mjs copies THIS file's source into
//   lib/qoder/wasm/test-fixtures/reader-shim.mjs and imports it from there. A
//   relative import would then resolve to wasm/test-fixtures/model-cache-crypto.js
//   and fail to load. Resolving against THIS module's own directory keeps the
//   shim working without changing the test's contract.
//
// SYNCHRONY IS PART OF THE CONTRACT (do not make these functions async):
//   The pre-port functions were plain sync functions, and callers rely on that.
//   `test-length.mjs` does `const b64 = modelCacheEncrypt(pt, uid)` with NO
//   await, so an async version would hand it a Promise and every "length" it
//   printed would be computed from a Promise — silently wrong, with no thrown
//   error. That file is not in test/run-all.mjs, so no suite would have caught
//   it. `node:crypto` is synchronous, and the pure-JS codec is a static import
//   below, so full synchrony is achievable and is the safer contract.
// ---------------------------------------------------------------------------

/**
 * True when the caller explicitly asked for the WASM implementation.
 *
 * Read per call rather than cached at module load: tests flip this env var
 * between runs in one process, and a load-time snapshot would make the switch
 * untestable (the value read would be whichever run happened to import first).
 */
function useWasmModelCache() {
  const flag = process.env.QODER_MODEL_CACHE_WASM
  return flag === '1' || flag === 'true'
}

let Dn = null
let Dfe = null
let zVe = null

let sg = 0
let Ikt = 0
const gvs = 2146435072
const eqe = new TextEncoder()
let LPA = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
LPA.decode()
const Cq = new Array(1024).fill(undefined)
Cq.push(undefined, null, true, false)
let $Ve = Cq.length

function ss() {
  return Dfe === null || Dfe.buffer.detached === true || (Dfe.buffer.detached === undefined && Dfe.buffer !== Dn.memory.buffer)
    ? (Dfe = new DataView(Dn.memory.buffer))
    : Dfe
}
function Mke() {
  return zVe === null || zVe.byteLength === 0 ? (zVe = new Uint8Array(Dn.memory.buffer)) : zVe
}
function wE(A) { return Cq[A] }
function uvs(A) { if (A >= 1028) { Cq[A] = $Ve; $Ve = A } }
function Tke(A, e) { return Mke().subarray(A >>> 0, (A >>> 0) + e) }
function Gb(A) { const e = wE(A); uvs(A); return e }
function kh(A) {
  if ($Ve === Cq.length) Cq.push(Cq.length + 1)
  const e = $Ve
  $Ve = Cq[e]
  Cq[e] = A
  return e
}
function fvs(A, e) {
  Ikt += e
  if (Ikt >= gvs) { LPA = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }); LPA.decode(); Ikt = e }
  return LPA.decode(Mke().subarray(A, A + e))
}
function ZS(A, e) { return fvs(A >>> 0, e) }
function Xx(A, e, t) {
  if (t === undefined) {
    const buf = eqe.encode(A)
    const i = e(buf.length, 1) >>> 0
    Mke().subarray(i, i + buf.length).set(buf)
    sg = buf.length
    return i
  }
  const i0 = A.length
  let n = e(i0, 1) >>> 0
  const r = Mke()
  let o = 0
  for (; o < i0; o++) {
    const c = A.charCodeAt(o)
    if (c > 127) break
    r[n + o] = c
  }
  if (o !== i0) {
    if (o !== 0) A = A.slice(o)
    let i = i0
    n = t(n, i, (i = o + 3 * A.length), 1) >>> 0
    const view = Mke().subarray(n + o, n + i)
    o += eqe.encodeInto(A, view).written
    n = t(n, i, o, 1) >>> 0
  }
  sg = o
  return n
}

/** The import object, byte-for-byte the app's own (renamed locals only). */
function Uir() {
  return {
    __proto__: null,
    './qoder_auth_wasm_bg.js': {
      __proto__: null,
      __wbg_Error_2e59b1b37a9a34c3: (A, e) => kh(Error(ZS(A, e))),
      __wbg___wbindgen_is_function_49868bde5eb1e745: (A) => typeof wE(A) === 'function',
      __wbg___wbindgen_is_object_40c5a80572e8f9d3: (A) => { const e = wE(A); return typeof e === 'object' && e !== null },
      __wbg___wbindgen_is_string_b29b5c5a8065ba1a: (A) => typeof wE(A) === 'string',
      __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: (A) => wE(A) === undefined,
      __wbg___wbindgen_throw_81fc77679af83bc6: (A, e) => { throw new Error(ZS(A, e)) },
      __wbg_call_d578befcc3145dee: function () { return kh(wE(A).apply(this, arguments)) },
      __wbg_crypto_38df2bab126b63dc: (A) => kh(wE(A).crypto),
      __wbg_getRandomValues_d49329ff89a07af1: (A) => kh(wE(A).getRandomValues),
      __wbg_getRandomValues_c44a50d8cfdaebeb: (A, e) => wE(A).getRandomValues(wE(e)),
      __wbg_length_0c32cb8543c8e4c8: (A) => wE(A).length,
      __wbg_msCrypto_bd5a034af96bcba6: (A) => kh(wE(A).msCrypto),
      __wbg_new_99cabae501c0a8a0: () => kh(new Map),
      __wbg_new_with_length_9cedd08484b73942: (A) => kh(new Uint8Array(A >>> 0)),
      __wbg_node_84ea875411254db1: (A) => kh(wE(A).node),
      __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
      __wbg_process_44c7a14e11e9f69e: (A) => kh(wE(A).process),
      // The glue below is the shipped wasm-bindgen shape. The previous forms
      // (`wE(A).prototype.set.call`, `kh(self)`, `kh(undefined)` for window)
      // crashed the model-cache path with "reading 'prototype' of undefined"
      // and "self is not defined" — accessors must yield 0 for an absent global.
      __wbg_prototypesetcall_3e05eb9545565046: (A, e, t) => { Uint8Array.prototype.set.call(Tke(A, e), wE(t)) },
      __wbg_randomFillSync_6c25eac9869eb53c: () => { throw new Error('randomFillSync unsupported') },
      __wbg_require_b4edbdcf3e2a1ef0: () => { throw new Error('require unsupported') },
      __wbg_set_08463b1df38a7e29: (A, e, t) => { wE(A)[wE(e)] = wE(t) },
      __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => { const A = typeof globalThis > 'u' ? null : globalThis; return A === null ? 0 : kh(A) },
      __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => { const A = typeof globalThis > 'u' ? null : globalThis; return A === null ? 0 : kh(A) },
      __wbg_static_accessor_SELF_24f78b6d23f286ea: () => { const A = typeof self > 'u' ? null : self; return A === null ? 0 : kh(A) },
      __wbg_static_accessor_WINDOW_59fd959c540fe405: () => { const A = typeof window > 'u' ? null : window; return A === null ? 0 : kh(A) },
      __wbg_subarray_0f98d3fb634508ad: (A, e, t) => kh(wE(A).subarray(e >>> 0, t >>> 0)),
      __wbg_versions_276b2795b1c6a219: (A) => kh(wE(A).versions),
      __wbindgen_cast_0000000000000001: (A, e) => kh(Tke(A, e)),
      __wbindgen_cast_0000000000000002: (A, e) => kh(ZS(A, e)),
      __wbindgen_object_clone_ref: (A) => kh(wE(A)),
      __wbindgen_object_drop_ref: (A) => Gb(A),
    },
  }
}

/**
 * Ensure the model-cache WASM is instantiated.
 *
 * The bundled WASM has been REMOVED from the package (the model-cache and
 * credential codecs are both pure JS now, byte-verified against the WASM before
 * its removal). This function therefore only loads a binary when the caller
 * names one explicitly — i.e. the `QODER_MODEL_CACHE_WASM=1` comparison path
 * pointed at a copy of the removed binary (see backup manifest). The no-
 * argument shape both production callers use is now a no-op that resolves to
 * null: the credential codec never needed setup, and the model-cache codec no
 * longer consults WASM unless explicitly asked.
 */
export async function init(wasmPath = null) {
  if (Dn !== null) return Dn
  if (typeof wasmPath !== 'string' || wasmPath.length === 0) return null
  const bytes = fs.readFileSync(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, Uir())
  Dn = instance.exports
  Dfe = null
  zVe = null
  return Dn
}

export function getExports() { return Dn }

/**
 * Encrypt one model-cache payload via the ORIGINAL WASM implementation.
 *
 * Retained verbatim as the cross-check path (QODER_MODEL_CACHE_WASM=1). Requires
 * `init()` to have run; the WASM glue is not module-load-safe.
 *
 * NAMING IS LOAD-BEARING: the name must NOT begin with the public encrypt
 * wrapper's name. test/failover.test.mjs builds its shim by plain prefix
 * replacement of the two wrapper export lines, so such a name would be
 * rewritten first, leaving the real exported wrapper untouched, and the shim
 * would then fail with a duplicate-export syntax error. (The literal source
 * text of that replacement is deliberately NOT reproduced in this comment:
 * writing it here makes the comment itself the first match, which is exactly
 * how the first attempt at this fix broke the shim.) Verified by the
 * shim-compatibility probe in the wiring test.
 */
export function wasmModelCacheEncrypt(plainJson, uid) {
  let t, i
  try {
    const g = Dn.__wbindgen_add_to_stack_pointer(-16)
    const c = Xx(plainJson, Dn.__wbindgen_export2, Dn.__wbindgen_export3)
    const B = sg
    const Q = Xx(uid, Dn.__wbindgen_export2, Dn.__wbindgen_export3)
    const E = sg
    Dn.model_cache_encrypt(g, c, B, Q, E)
    const n = ss().getInt32(g + 0, true), r = ss().getInt32(g + 4, true)
    const o = ss().getInt32(g + 8, true), s = ss().getInt32(g + 12, true)
    let a = n, l = r
    if (s) { a = 0; l = 0; throw Gb(o) }
    t = a; i = l
    return ZS(a, l)
  } finally { Dn.__wbindgen_add_to_stack_pointer(16) }
}

/**
 * Decrypt one model-cache container via the ORIGINAL WASM implementation.
 *
 * Retained verbatim as the cross-check path. Note the WASM returns a STRING;
 * the pure-JS codec returns a Buffer. The public wrappers below own that
 * difference so callers see one stable shape (see modelCacheDecrypt).
 * See wasmModelCacheEncrypt for why the name must not start with `modelCache`.
 */
export function wasmModelCacheDecrypt(encryptedBase64, uid) {
  let t, i
  try {
    const g = Dn.__wbindgen_add_to_stack_pointer(-16)
    const c = Xx(encryptedBase64, Dn.__wbindgen_export2, Dn.__wbindgen_export3)
    const B = sg
    const Q = Xx(uid, Dn.__wbindgen_export2, Dn.__wbindgen_export3)
    const E = sg
    Dn.model_cache_decrypt(g, c, B, Q, E)
    const n = ss().getInt32(g + 0, true), r = ss().getInt32(g + 4, true)
    const o = ss().getInt32(g + 8, true), s = ss().getInt32(g + 12, true)
    let a = n, l = r
    if (s) { a = 0; l = 0; throw Gb(o) }
    t = a; i = l
    return ZS(a, l)
  } finally { Dn.__wbindgen_add_to_stack_pointer(16) }
}

/**
 * Encrypt a model-cache payload into a base64 container.
 *
 * Contract is UNCHANGED from the WASM-only era: `(plainJson: string, uid: string)
 * -> base64 string`, and it is still SYNCHRONOUS (see the SYNCHRONY note above).
 * Default path is pure JS; set QODER_MODEL_CACHE_WASM=1 to take the WASM path
 * for comparison. There is no silent fallback between them.
 */
export function modelCacheEncrypt(plainJson, uid) {
  if (useWasmModelCache()) return wasmModelCacheEncrypt(plainJson, uid)
  const codec = loadPureCodec()
  if (codec === null) throw new Error(`pure-JS model-cache codec unavailable: ${pureCodecError?.message ?? 'unknown'}`)
  return codec.modelCacheEncrypt(plainJson, uid)
}

/**
 * Decrypt a model-cache container.
 *
 * Contract is UNCHANGED from the WASM-only era: `(encryptedBase64: string,
 * uid: string) -> string` — the *plaintext text*, not a Buffer — and still
 * SYNCHRONOUS. The pure-JS codec returns bytes, so this wrapper decodes them as
 * UTF-8; converting here (rather than at every call site) is what keeps the two
 * code paths interchangeable for existing callers, including
 * catalog-reader/decryptCatalog which JSON.parses this result directly.
 */
export function modelCacheDecrypt(encryptedBase64, uid) {
  if (useWasmModelCache()) return wasmModelCacheDecrypt(encryptedBase64, uid)
  const codec = loadPureCodec()
  if (codec === null) throw new Error(`pure-JS model-cache codec unavailable: ${pureCodecError?.message ?? 'unknown'}`)
  return codec.modelCacheDecrypt(encryptedBase64, uid).toString('utf8')
}
