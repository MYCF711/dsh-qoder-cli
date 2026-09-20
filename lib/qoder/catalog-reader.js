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
      __wbg_call_d578befcc3145dee: function () { return kh(wE(A).apply(this, arguments)) },
      __wbg_crypto_38df2bab126b63dc: (A) => kh(wE(A).crypto),
      __wbg_getRandomValues_d49329ff89a07af1: (A) => kh(wE(A).getRandomValues),
      __wbg_getRandomValues_c44a50d8cfdaebeb: (A, e) => wE(A).getRandomValues(wE(e)),
      __wbg_length_0c32cb8543c8e4c8: (A) => wE(A).length,
      __wbg_msCrypto_bd5a034af96bcba6: (A) => kh(wE(A).msCrypto),
      __wbg_new_99cabae501c0a8a0: (A) => kh(new Uint8Array(wE(A))),
      __wbg_new_with_length_9cedd08484b73942: (A) => kh(new Uint8Array(A >>> 0)),
      __wbg_node_84ea875411254db1: (A) => kh(wE(A).node),
      __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
      __wbg_process_44c7a14e11e9f69e: (A) => kh(wE(A).process),
      __wbg_prototypesetcall_3e05eb9545565046: (A, e, t) => { wE(A).prototype.set.call(wE(e), wE(t)) },
      __wbg_randomFillSync_6c25eac9869eb53c: () => { throw new Error('randomFillSync unsupported') },
      __wbg_require_b4edbdcf3e2a1ef0: () => { throw new Error('require unsupported') },
      __wbg_set_08463b1df38a7e29: (A, e, t) => { wE(A)[wE(e)] = wE(t) },
      __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => kh(globalThis),
      __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => kh(globalThis),
      __wbg_static_accessor_SELF_24f78b6d23f286ea: () => kh(self),
      __wbg_static_accessor_WINDOW_59fd959c540fe405: () => kh(undefined),
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
 * Instantiate the auth WASM. Idempotent; rejects when no candidate loads.
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
 * Decrypt the local model cache. Returns the parsed catalog document
 * (`{ [scene]: RawModel[] }`), verbatim from Qoder's own decryption.
 */
export async function decryptCatalog(encryptedBase64, uid) {
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
    input: raw.is_vl === true ? ['text', 'image'] : ['text'],
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
