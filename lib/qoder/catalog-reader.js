/**
 * Qoder model-catalog reader.
 *
 * The authoritative model catalog is NOT hard-coded by the app: the server
 * pushes it (`/api/v2/model/list?Encode=1`) and the desktop app caches it at
 * `<configHome>/.models/<uid>/catalog-v6` — an AES-GCM payload whose key is the
 * account uid. The decryption lives in Qoder's own auth WASM
 * (`qoder_auth_wasm_bg.wasm`, `model_cache_decrypt(encrypted_b64, uid_b64)`).
 *
 * This module extracts that WASM from the local Qoder install (same evidence
 * chain as every other constant here: read from the install, never guessed),
 * instantiates it with a minimal wasm-bindgen glue reproduced verbatim from the
 * worker bundle, and decrypts the local cache. No network, no signature.
 *
 * Fallback: every path here degrades to the built-in catalog — a missing
 * install, an unreadable cache, or a WASM change must never disable the
 * provider.
 *
 * Evidence: docs/QODER-PROTOCOL.md §4.4; test/live-catalog.test.mjs.
 *
 * @module dsh-qoder-cli/catalog-reader
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Qoder config root (protocol `ii()`: `${home}/.qoder`, CN `.qoder-cn`). */
export function qoderConfigHome(home = homedir()) {
  return process.env.QODER_CONFIG_DIR ?? join(home, '.qoder')
}

/** Where the desktop app writes the model cache (protocol `fpA()`). */
export function catalogPathFor(uid, configHome = qoderConfigHome()) {
  const safe = String(uid).replace(/^\.+/, '') || 'anon'
  return join(configHome, '.models', safe, 'catalog-v6')
}

/** The "current uid + scene" pointer file next to the catalog. */
export function catalogPointerPath(configHome = qoderConfigHome()) {
  return join(configHome, '.models', 'default')
}

/**
 * Candidate locations of Qoder's auth WASM, best first. Desktop installs keep
 * the worker runtime unpacked; CLI installs keep a pkg tree. Every candidate is
 * read, none are written.
 */
export function wasmCandidatePaths(configHome = qoderConfigHome()) {
  const env = process.env.QODER_AUTH_WASM_PATH
  const list = []
  if (env) list.push(env)
  const home = homedir()
  list.push(
    join(home, '.qoder', 'bin', 'qodercli', 'qoder_auth_wasm_bg.wasm'),
    'D:\\Qoder\\resources\\app.asar.unpacked\\node_modules\\@qoder-ai\\qoder-agent-sdk\\dist\\_worker\\qoder_auth_wasm_bg.wasm',
  )
  return list
}

// ---------------------------------------------------------------------------
// Minimal wasm-bindgen glue, reproduced verbatim from the worker bundle
// (qoder-worker-runtime.obf.mjs). Only the shape is ours; every function body
// is the app's own code. The slab protocol (`Cq`/`$Ve`/`kh`/`uvs`) and the
// stack-pointer return convention (4×i32 at -16) are wasm-bindgen standard.
// ---------------------------------------------------------------------------

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
  return (Dfe === null || Dfe.buffer.detached === true || (Dfe.buffer.detached === undefined && Dfe.buffer !== Dn.memory.buffer))
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
function wq(A) { return A == null }
/**
 * wasm-bindgen's error-marshalling wrapper, reproduced verbatim from the app's
 * own bundle (`XVe`, obf offset 431201).
 *
 * Every import handler that can throw must go through this: instead of letting a
 * JS exception cross the wasm boundary, it registers the error object in the
 * reference table and hands it back to wasm via `__wbindgen_export`. The earlier
 * reimplementation dropped this wrapper, so a handler that threw produced an
 * unhandled TypeError *outside* wasm — which the callers' `catch` then misread
 * as "the server rejected us". Restoring it is what makes local failures
 * distinguishable from HTTP failures again.
 */
function XVe(A, e) { try { return A.apply(this, e) } catch (A) { Dn.__wbindgen_export(kh(A)) } }
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
  const i = A.length
  let n = e(i, 1) >>> 0
  const r = Mke()
  let o = 0
  for (; o < i; o++) {
    const c = A.charCodeAt(o)
    if (c > 127) break
    r[n + o] = c
  }
  if (o !== i) {
    if (o !== 0) A = A.slice(o)
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
      __wbg_call_d578befcc3145dee: function () { return XVe(function (A, e, t) { return kh(wE(A).call(wE(e), wE(t))) }, arguments) },
      __wbg_crypto_38df2bab126b63dc: (A) => kh(wE(A).crypto),
      __wbg_getRandomValues_d49329ff89a07af1: function () { return XVe(function (A, e) { globalThis.crypto.getRandomValues(Tke(A, e)) }, arguments) },
      __wbg_getRandomValues_c44a50d8cfdaebeb: function () { return XVe(function (A, e) { wE(A).getRandomValues(wE(e)) }, arguments) },
      __wbg_length_0c32cb8543c8e4c8: (A) => wE(A).length,
      __wbg_msCrypto_bd5a034af96bcba6: (A) => kh(wE(A).msCrypto),
      __wbg_new_99cabae501c0a8a0: (A) => kh(new Uint8Array(wE(A))),
      __wbg_new_with_length_9cedd08484b73942: (A) => kh(new Uint8Array(A >>> 0)),
      __wbg_node_84ea875411254db1: (A) => kh(wE(A).node),
      __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
      __wbg_process_44c7a14e11e9f69e: (A) => kh(wE(A).process),
      __wbg_prototypesetcall_3e05eb9545565046: (A, e, t) => { Uint8Array.prototype.set.call(Tke(A, e), wE(t)) },
      __wbg_randomFillSync_6c25eac9869eb53c: function () { return XVe(function (A, e) { wE(A).randomFillSync(Gb(e)) }, arguments) },
      __wbg_require_b4edbdcf3e2a1ef0: function () { return XVe(function () { return kh(module.require) }, arguments) },
      __wbg_set_08463b1df38a7e29: (A, e, t) => { wE(A)[wE(e)] = wE(t) },
      __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => { const A = typeof globalThis > 'u' ? null : globalThis; return wq(A) ? 0 : kh(A) },
      __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => { const A = typeof global > 'u' ? null : global; return wq(A) ? 0 : kh(A) },
      __wbg_static_accessor_SELF_24f78b6d23f286ea: () => { const A = typeof self > 'u' ? null : self; return wq(A) ? 0 : kh(A) },
      __wbg_static_accessor_WINDOW_59fd959c540fe405: () => { const A = typeof window > 'u' ? null : window; return wq(A) ? 0 : kh(A) },
      __wbg_subarray_0f98d3fb634508ad: (A, e, t) => kh(wE(A).subarray(e >>> 0, t >>> 0)),
      __wbg_versions_276b2795b1c6a219: (A) => kh(wE(A).versions),
      __wbindgen_cast_0000000000000001: (A, e) => kh(Tke(A, e)),
      __wbindgen_cast_0000000000000002: (A, e) => kh(ZS(A, e)),
      __wbindgen_object_clone_ref: (A) => kh(wE(A)),
      __wbindgen_object_drop_ref: (A) => Gb(A),
    },
  }
}

let initPromise = null

/**
 * Why the remote tier last failed, and where. Distinguishes a LOCAL failure
 * (wasm instantiation, glue, credential decode — our own bug) from an UPSTREAM
 * one (HTTP non-200, undecryptable or malformed body).
 *
 * Before this existed, both classes collapsed into `return null` and were
 * externally indistinguishable, so a broken wasm import object looked exactly
 * like "the server rejected our signature" for an entire sprint. Callers still
 * degrade to `null`; this only makes the two observable.
 *
 * @returns {{stage: string, kind: 'local'|'upstream', error?: Error}|null}
 */
export function lastRemoteFailure() {
  return remoteFailure
}

/** Clear the recorded remote failure (diagnostics / tests). */
export function clearRemoteFailure() {
  remoteFailure = null
}

let remoteFailure = null

/**
 * Human-readable reason for a local failure.
 *
 * Verifier finding: `lastRemoteFailure()` used to carry the raw Error, which
 * serialises to `{}` over JSON — so the single most important diagnosis ("this
 * build ships without the auth WASM") was invisible exactly where it mattered.
 * A plain string survives serialisation and tells the reader what to do.
 */
function describeLocalError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/no qoder auth wasm candidate found/i.test(message)) {
    return 'auth WASM not available in this build: the remote-catalog tier is disabled by design. ' +
      'This build intentionally ships without Qoder\'s 298KB auth WASM, so endpoint election and ' +
      'model/list cannot run. The three-tier local chain (bundled catalog) is unaffected. ' +
      'To enable it, supply the WASM via QODER_AUTH_WASM_PATH or place it at lib/qoder/wasm/.'
  }
  return message
}

function noteLocalFailure(stage, error) {
  remoteFailure = {
    stage,
    kind: 'local',
    reason: describeLocalError(error),
    error: error instanceof Error ? error : new Error(String(error)),
  }
  return null
}
function noteUpstreamFailure(stage, detail) {
  remoteFailure = {
    stage,
    kind: 'upstream',
    reason: String(detail ?? 'unavailable'),
    error: new Error(String(detail ?? 'unavailable')),
  }
  return null
}

/**
 * Instantiate the auth WASM. Idempotent; rejects when no candidate loads.
 *
 * Single-flight, with the failure-clearing branch: a FAILED attempt resets the
 * guard so a later call retries, while a successful one leaves `Dn` set and
 * short-circuits. Dropping the `catch` would wedge the tier permanently after
 * one transient error (see docs/REVIEW-final-integration.md §2.5).
 */
export async function initAuthWasm() {
  if (Dn !== null) return Dn
  if (initPromise === null) {
    initPromise = (async () => {
      // Prefer the copy shipped inside this plugin package.
      const bundled = join(fileURLToPath(new URL('.', import.meta.url)), 'wasm', 'qoder_auth_wasm_bg.wasm')
      const candidates = [bundled, ...wasmCandidatePaths()]
      let lastError
      for (const path of candidates) {
        try {
          if (!existsSync(path)) continue
          const bytes = await readFile(path)
          const { instance } = await WebAssembly.instantiate(bytes, Uir())
          Dn = instance.exports
          Dfe = null
          zVe = null
          return Dn
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('no qoder auth wasm candidate found')
    })()
    initPromise.catch(() => { initPromise = null })
  }
  return initPromise
}

/**
 * Mirror of the switch in `wasm-credential-reader.js`: WASM is an explicit
 * opt-in for comparison, never a silent fallback. Read fresh on every call so
 * the two paths can be toggled within one process (tests, forensics).
 */
function useWasmModelCache() {
  const v = process.env.QODER_MODEL_CACHE_WASM
  return v === '1' || v === 'true'
}

/**
 * Decrypt the local model cache. Returns the parsed catalog document
 * (`{ [scene]: RawModel[] }`), verbatim from Qoder's own decryption.
 *
 * Since the model-cache codec was ported to pure JS
 * (`lib/qoder/model-cache-crypto.js`, byte-verified against the WASM in both
 * directions), this function no longer needs the auth WASM at all. It keeps its
 * `async` signature and its JSON-returning contract so callers
 * (`readLocalCatalog`, tests) are untouched. The WASM path remains available
 * for comparison via `QODER_MODEL_CACHE_WASM=1` — same switch as
 * `wasm-credential-reader.js`.
 */
export async function decryptCatalog(encryptedBase64, uid) {
  if (useWasmModelCache()) {
    const wasm = await initAuthWasm()
    let t, i
    try {
      const g = wasm.__wbindgen_add_to_stack_pointer(-16)
      const c = Xx(encryptedBase64, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
      const B = sg
      const Q = Xx(uid, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
      const E = sg
      wasm.model_cache_decrypt(g, c, B, Q, E)
      const n = ss().getInt32(g + 0, true)
      const r = ss().getInt32(g + 4, true)
      const o = ss().getInt32(g + 8, true)
      const s = ss().getInt32(g + 12, true)
      let a = n
      let l = r
      if (s) { a = 0; l = 0; throw Gb(o) }
      t = a
      i = l
      return JSON.parse(ZS(a, l))
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16)
    }
  }
  const { modelCacheDecrypt } = await import('./model-cache-crypto.js')
  return JSON.parse(modelCacheDecrypt(encryptedBase64, uid).toString('utf8'))
}

// ---------------------------------------------------------------------------
// Remote catalog: endpoint election + COSY-signed model/list.
//
// The signing chain below is a faithful port of the worker bundle's
// `QoderContext` usage, validated by tmp/qoder-catalog/try4.mjs (election 200)
// and re-verified in docs/FINDING-t12-remote-tier-403.md. Constants are read
// from the install/logs, never guessed.
// ---------------------------------------------------------------------------

/** Center host serving the endpoint-election endpoint (prod). */
const CENTER_HOST = 'https://center.qoder.sh'
/** Election path; `sign` mode, anonymous. */
const ELECTION_PATH = '/api/v3/service/region/endpoints'
/** Fallback inference host when election yields nothing. */
const INFERENCE_HOST = 'https://api3.qoder.sh'
/** The server catalogue endpoint (protocol §4.4). */
const MODEL_LIST_PATH = '/api/v2/model/list?Encode=1'
/** COSY version sent in the signed context; matches this machine's runtime-info. */
const COSY_VERSION = '1.1.57'
/** Signed request context body (bundle's `kg()`). */
const COSY_CONTEXT = JSON.stringify({
  client_type: '5',
  business_product: 'cli',
  business_type: 'agent',
  scene: 'assistant',
})
/** Election runs with an empty user: anonymous, no credential needed. */
const EMPTY_USER_SIGN = JSON.stringify({ uid: '', encrypt_user_info: '', key: '' })

/**
 * Read the CLI device-flow credential from `configHome`.
 *
 * Uses the plugin's own `wasm-credential-reader` instance — the CLI store is
 * AES-encrypted with the machine id's first 16 characters. Returns `null` when
 * anything is missing, so callers degrade silently.
 */
async function readCliUserInfo(configHome) {
  try {
    const machineId = (
      await readFile(join(configHome, '.auth', 'machine_id'), 'utf8')
    ).trim()
    const payload = await readFile(join(configHome, '.auth', 'user'), 'utf8')
    if (machineId.length < 16 || payload.length === 0) return null
    const { init, credentialStorageDecrypt } = await import('./wasm-credential-reader.js')
    const bundled = join(fileURLToPath(new URL('.', import.meta.url)), 'wasm', 'qoder_auth_wasm_bg.wasm')
    await init(bundled)
    const userInfo = JSON.parse(credentialStorageDecrypt(payload, machineId.slice(0, 16)))
    if (userInfo === null || typeof userInfo !== 'object') return null
    return { machineId, userInfo }
  } catch {
    return null
  }
}

/**
 * `qodercontext_new(machineId, cosyVersion, userInfoJson, contextJson)`.
 *
 * wasm-bindgen return convention: an i32 pointer, with the error triple at
 * +4/+8 of the -16 stack slot.
 */
function newQoderContext(wasm, machineId, userInfoJson, contextJson) {
  const g = wasm.__wbindgen_add_to_stack_pointer(-16)
  try {
    const l = Xx(machineId, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const lg = sg
    const c = Xx(COSY_VERSION, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const cg = sg
    const Q = Xx(userInfoJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const Qg = sg
    const n = Xx(contextJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const ng = sg
    wasm.qodercontext_new(g, l, lg, c, cg, Q, Qg, n, ng)
    const ptr = ss().getInt32(g + 0, true)
    const errObj = ss().getInt32(g + 4, true)
    const isErr = ss().getInt32(g + 8, true)
    if (isErr) throw normalizeWasmError(Gb(errObj))
    return ptr >>> 0
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
  }
}

/**
 * `qodercontext_prepareRequest(...)` → `{ url, headers }`.
 *
 * The WASM computes the COSY `Authorization` ciphertext AND returns the final
 * URL (including the elected host and `/algo` prefix), so the caller must use
 * the returned URL rather than reconstructing it.
 */
function prepareQoderRequest(wasm, ctx, endpoint, path, method, authMode, body, headersJson) {
  const B = wasm.__wbindgen_add_to_stack_pointer(-16)
  try {
    const Q = Xx(endpoint, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const Qg = sg
    const I = Xx(path, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const Ig = sg
    const u = Xx(method, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const ug = sg
    const w = Xx(authMode, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const wg = sg
    const o = wq(body) ? 0 : Xx(body, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const og = sg
    const a = wq(headersJson) ? 0 : Xx(headersJson, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const ag = sg
    wasm.qodercontext_prepareRequest(B, ctx, Q, Qg, I, Ig, u, ug, w, wg, o, og, a, ag)
    const rr = ss().getInt32(B + 0, true)
    const errObj = ss().getInt32(B + 4, true)
    const isErr = ss().getInt32(B + 8, true)
    if (isErr) throw normalizeWasmError(Gb(errObj))
    const ptr = rr >>> 0
    return { url: requestResultUrl(wasm, ptr), headers: Gb(wasm.requestresult_headers(ptr)) }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
  }
}

/** `requestresult_url(ptr)` → the final signed URL string. */
function requestResultUrl(wasm, ptr) {
  const n = wasm.__wbindgen_add_to_stack_pointer(-16)
  try {
    wasm.requestresult_url(n, ptr)
    return ZS(ss().getInt32(n + 0, true), ss().getInt32(n + 4, true))
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
  }
}

/** `decrypt_server_response(text)` → plaintext JSON string. */
function decryptServerResponse(wasm, text) {
  const l = wasm.__wbindgen_add_to_stack_pointer(-16)
  try {
    const g = Xx(text, wasm.__wbindgen_export2, wasm.__wbindgen_export3)
    const c = sg
    wasm.decrypt_server_response(l, g, c)
    const i = ss().getInt32(l + 0, true)
    const n = ss().getInt32(l + 4, true)
    const r = ss().getInt32(l + 8, true)
    const o = ss().getInt32(l + 12, true)
    if (o) throw normalizeWasmError(Gb(r))
    return ZS(i, n)
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
  }
}

/** WASM errors arrive as thrown JS values; normalise to an Error. */
function normalizeWasmError(value) {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * High-level: read and decrypt the freshest local catalog.
 * Returns `{ scene: RawModel[] }` or `null` when nothing readable exists
 * (no pointer, no cache, decrypt failure) — callers fall back to the
 * built-in catalog on `null`.
 */
export async function readLocalCatalog(configHome = qoderConfigHome()) {
  try {
    let uid
    try {
      const pointer = JSON.parse(await readFile(catalogPointerPath(configHome), 'utf8'))
      uid = typeof pointer?.uid === 'string' ? pointer.uid : undefined
    } catch {
      // pointer unreadable: scan the .models directory for any catalog
      uid = undefined
    }
    if (uid !== undefined) {
      try {
        const raw = await readFile(catalogPathFor(uid, configHome), 'utf8')
        return await decryptCatalog(raw, uid)
      } catch {
        // fall through to scan
      }
    }
    // scan: first decryptable catalog wins
    const modelsDir = join(configHome, '.models')
    if (!existsSync(modelsDir)) return null
    const { readdir } = await import('node:fs/promises')
    for (const entry of await readdir(modelsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'default') continue
      try {
        const raw = await readFile(join(modelsDir, entry.name, 'catalog-v6'), 'utf8')
        return await decryptCatalog(raw, entry.name)
      } catch {
        // keep scanning
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Endpoint-election response, decrypted. Returns `null` when unreadable.
 *
 * Election runs in `sign` mode against the CENTER host with an empty user —
 * anonymous: no credential, no login state. Reproduced live on 2026-09-20:
 * HTTP 200, payload naming `https://api3.qoder.sh` as the inference node.
 */
export async function electInferenceEndpoint(configHome, fetchImpl = fetch) {
  try {
    const wasm = await initAuthWasm()
    const user = await readCliUserInfo(configHome)
    if (user === null) return null
    const ctx = newQoderContext(wasm, user.machineId, EMPTY_USER_SIGN, COSY_CONTEXT)
    const request = prepareQoderRequest(
      wasm,
      ctx,
      CENTER_HOST,
      ELECTION_PATH,
      'GET',
      'sign',
      undefined,
      undefined,
    )
    const response = await fetchImpl(request.url, { headers: request.headers })
    if (response.status !== 200) return noteUpstreamFailure('election', `HTTP ${response.status}`)
    const plain = decryptServerResponse(wasm, await response.text())
    const parsed = JSON.parse(plain)
    const nodes = parsed?.inferNodes
    if (!Array.isArray(nodes) || typeof nodes[0] !== 'string') {
      return noteUpstreamFailure('election', 'no inferNodes in decrypted body')
    }
    return { inferNodes: nodes, raw: parsed }
  } catch (error) {
    // A local failure (wasm instantiation / glue / credential decode) must NOT
    // be reported as an upstream rejection — see lastRemoteFailure().
    return noteLocalFailure('election', error)
  }
}

/**
 * Read the online model catalog from Qoder's servers.
 *
 * Flow, as validated by docs/experiment-endpoint-election.md: endpoint election
 * (sign) → COSY-signed `model/list` (auth) → `decrypt_server_response`.
 *
 * @returns `{ [scene]: RawModel[] }` on success, **`null` on every failure**.
 *
 * ⚠️ MEASURED LIMITATION (2026-09-20, independently reproduced): step 2 does not
 * currently succeed. `GET /algo/api/v2/model/list?Encode=1` answers **403
 * `{"code":"101","message":"Signature invalid"}`** for every input permutation
 * tried this sprint — both COSY versions, wide/narrow/empty/regen user forms,
 * explicit `/algo` endpoint and path, and regardless of which elected host is
 * used (api3, api2, api2-v2 → 403/403/404). Election itself returns 200, which
 * proves the replication of the WASM signing chain is sound; the rejection is
 * upstream of the signing inputs.
 *
 * Therefore **this function currently always returns `null`** in practice, and
 * the four-tier chain behaves as the three-tier one did. It is kept (rather than
 * removed) because the pipeline is the hard part and the only missing piece is
 * an upstream answer; see docs/FINDING-t12-remote-tier-403.md §6 for the two
 * experiments that would close it. Every failure path degrades silently — a
 * network error, a bad election, a 403, or an undecryptable body must never
 * disable the provider.
 */
export async function readRemoteCatalog(configHome = qoderConfigHome(), fetchImpl = fetch) {
  try {
    const user = await readCliUserInfo(configHome)
    if (user === null) return null

    const elected = await electInferenceEndpoint(configHome, fetchImpl)
    const host = elected?.inferNodes?.[0] ?? INFERENCE_HOST
    if (typeof host !== 'string' || host.length === 0) return null

    const wasm = await initAuthWasm()
    const ctx = newQoderContext(wasm, user.machineId, JSON.stringify(user.userInfo), COSY_CONTEXT)
    const request = prepareQoderRequest(
      wasm,
      ctx,
      host.replace(/\/+$/, ''),
      MODEL_LIST_PATH,
      'GET',
      'auth',
      undefined,
      undefined,
    )
    const response = await fetchImpl(request.url, { headers: request.headers })
    if (response.status !== 200) return noteUpstreamFailure('model-list', `HTTP ${response.status}`)

    const plain = decryptServerResponse(wasm, await response.text())
    const parsed = JSON.parse(plain)
    return parsed !== null && typeof parsed === 'object'
      ? parsed
      : noteUpstreamFailure('model-list', 'decrypted body is not an object')
  } catch (error) {
    // Local (wasm/glue/credential) failure — recorded, never reported as an
    // upstream rejection. The caller still sees `null`, so the four-tier chain
    // is unchanged.
    return noteLocalFailure('model-list', error)
  }
}

/**
 * Map one raw catalog entry (protocol §4.2 field table) onto our display
 * model shape. Context window comes from `context_config.<default window>` or
 * `max_input_tokens`. Reasoning efforts come from `thinking_config`.
 */
export function rawModelToCatalogEntry(raw) {
  const windows = raw.context_config ?? {}
  let contextWindow = typeof raw.max_input_tokens === 'number' && raw.max_input_tokens > 0 ? raw.max_input_tokens : 200000
  let contextLabel
  for (const [label, cfg] of Object.entries(windows)) {
    if (cfg && typeof cfg.token_count === 'number') {
      if (cfg.is_default || contextLabel === undefined) {
        contextLabel = label
        contextWindow = cfg.token_count
      }
    }
  }
  // Full context-window ladder: every labelled tier the server offers, so the
  // card can offer a switch (200K default ×0.2, 400K, 1M …) instead of a fixed
  // number. Shape: [{label, tokens, isDefault}].
  const contextOptions = Object.entries(windows)
    .filter(([, cfg]) => cfg && typeof cfg.token_count === 'number')
    .map(([label, cfg]) => ({ label, tokens: cfg.token_count, isDefault: cfg.is_default === true }))
  const efforts = []
  const thinking = raw.thinking_config
  if (thinking && typeof thinking === 'object') {
    const enabled = thinking.enabled
    if (enabled && typeof enabled === 'object') {
      const list = enabled.efforts ?? {}
      for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
        if (list[level] !== undefined) efforts.push(level)
      }
      if (efforts.length === 0 && enabled.is_default) efforts.push('medium')
    }
  }
  const promo = raw.promotion?.active
    ? {
        active: true,
        badge: raw.promotion.badge,
        description: raw.promotion.description,
        window: raw.promotion.window_start && raw.promotion.window_end
          ? `${raw.promotion.window_start}-${raw.promotion.window_end}`
          : undefined,
        discountFactor: raw.promotion.discount_factor,
      }
    : undefined
  return {
    id: raw.key,
    name: raw.display_name ?? raw.key,
    contextWindow,
    maxTokens: typeof raw.max_output_tokens === 'number' && raw.max_output_tokens > 0 ? raw.max_output_tokens : 32768,
    // Text only, even for `is_vl` models. The catalog records that the *server*
    // model accepts images, but this connector has no attachment plumbing: the
    // shim forwards text messages only. Declaring `image` here made pi-ai
    // refuse the whole request up front with UNSUPPORTED_CONTENT
    // ("pi-ai image input requires the durable attachment service") before it
    // ever reached the plugin — measured on qfmodel, which is `is_vl: true`.
    // Advertising a capability we cannot serve is worse than not advertising it.
    input: ['text'],
    reasoning: raw.is_reasoning === true || efforts.length > 0,
    reasoningEfforts: efforts,
    isFree: raw.is_free === true,
    isNew: raw.is_new === true,
    priceFactor: raw.price_factor,
    promotion: promo,
    contextOptions,
    /** thinking_config 的默认档（disabled 或 effort 名） */
    thinkingDefault: thinking && typeof thinking === 'object'
      ? (thinking.disabled && thinking.disabled.is_default) || (thinking.is_default === false && thinking.disabled)
        ? 'off'
        : (thinking.enabled?.efforts && Object.entries(thinking.enabled.efforts).find(([, cfg]) => cfg.is_default))?.[0] ?? (thinking.enabled?.is_default ? 'medium' : undefined)
      : undefined,
    /** Present only when measured on the chat gateway; see gateLive. */
    degraded: undefined,
  }
}
