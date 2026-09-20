/**
 * Windows-native primitives the Qoder connector needs.
 *
 * `safeStorage` on Windows protects its AES key with DPAPI in the *current
 * user's* scope, so the key can only be unwrapped by the same Windows account
 * that Qoder ran as. Node has no built-in DPAPI binding, so this module calls
 * `CryptUnprotectData` from `crypt32.dll` in-process through koffi.
 *
 * An in-process call is deliberate. Spawning a helper process would need either
 * a native executable or a PowerShell child, and the DSH runtime refuses piped
 * stdio to child processes — so a child-process design would work in a terminal
 * and fail inside the harness. Calling the exported function directly has no
 * such failure mode.
 *
 * Non-Windows platforms get a clear error rather than a silent `null`: the
 * credential genuinely cannot be read there, and reporting "not signed in"
 * would send the user hunting for a login problem that does not exist.
 *
 * @module dsh-qoder-cli/native
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Lazily loaded koffi binding; `undefined` until first use. */
let crypt32 = null

const require = createRequire(import.meta.url)

/**
 * Resolve the `koffi` FFI binding.
 *
 * A plain `require('koffi')` is correct once the plugin is installed into a DSH
 * profile: `profiles/node_modules/koffi` is a link the runtime maintains, so
 * normal upward resolution finds it. It does NOT resolve when the plugin is
 * being run straight out of a source checkout outside the DSH tree, which is
 * exactly how the test suite runs it.
 *
 * The fallback therefore probes the DSH install root explicitly. It is a
 * convenience for development only — the plain require is tried first, so an
 * installed profile never takes the fallback path.
 */
function loadKoffi() {
  if (koffiBinding !== null) return koffiBinding
  try {
    koffiBinding = require('koffi')
    return koffiBinding
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
  }

  const dshHome = process.env.DSH_HOME
  const candidates = []
  if (typeof dshHome === 'string' && dshHome.length > 0) {
    candidates.push(join(dshHome, 'profiles', 'node_modules', 'koffi'))
    candidates.push(join(dshHome, '..', 'node_modules', 'koffi'))
  }
  // The desktop app's own dependency tree, discovered from this file's location
  // when the plugin is loaded from inside the install.
  candidates.push(join('D:', 'DSH Desktop', 'resources', 'app', 'node_modules', 'koffi'))

  for (const dir of candidates) {
    const entry = join(dir, 'index.cjs')
    if (!existsSync(entry)) continue
    // `require` of an absolute path works for CJS; koffi's entry is CJS.
    koffiBinding = require(entry)
    return koffiBinding
  }

  throw new Error(
    'qoder: the FFI binding "koffi" could not be resolved. It ships with the DSH runtime;' +
      ' if this plugin is being run outside a DSH install, install koffi alongside it.',
  )
}

/** Cached koffi binding, shared by {@link loadKoffi} and the DPAPI wrapper. */
let koffiBinding = null

/**
 * Expose the FFI binding for diagnostics.
 *
 * A `doctor`-style command needs to report *which* koffi was loaded before it
 * can explain a DPAPI failure, so this is a supported entry point rather than a
 * test-only escape hatch.
 */
export function loadFfiBinding() {
  return loadKoffi()
}

/**
 * Load `crypt32.dll` and return a bound `CryptUnprotectData`.
 *
 * Loading is cached: the DLL handle and function binding are process-wide.
 */
function loadDpapi() {
  if (crypt32 !== null) return crypt32
  if (process.platform !== 'win32') {
    throw new Error(
      `qoder: reading the Qoder credential needs Windows DPAPI; this platform is ${process.platform}`,
    )
  }
  const koffi = loadKoffi()
  const crypt = koffi.load('crypt32.dll')
  const kernel = koffi.load('kernel32.dll')

  // koffi's type registry is process-global and rejects a duplicate name. A
  // plugin reload (HMR) would re-run this initialiser in the same process, so
  // the struct name is made unique per module instance rather than fixed.
  const structName = `QODER_DATA_BLOB_${process.pid}_${Math.random().toString(36).slice(2, 10)}`
  const DATA_BLOB = koffi.struct(structName, { cbData: 'uint32', pbData: 'void *' })
  const localFree = kernel.func('void *LocalFree(void *hMem)')
  const cryptUnprotectData = crypt.func(
    `bool CryptUnprotectData(${structName} *pDataIn, void *ppszDataDescr, ${structName} *pOptionalEntropy,` +
      ` void *pvReserved, void *pPromptStruct, uint32 dwFlags, _Out_ ${structName} *pDataOut)`,
  )

  crypt32 = { koffi, DATA_BLOB, localFree, cryptUnprotectData }
  return crypt32
}

/**
 * Unprotect a DPAPI `CurrentUser` blob.
 *
 * @param {Buffer} blob  Bytes previously protected for this Windows user.
 * @returns {Buffer}     The plaintext.
 * @throws when DPAPI refuses the blob (wrong user, wrong machine, tampering).
 */
export function dpapiUnprotect(blob) {
  const { koffi, DATA_BLOB, localFree, cryptUnprotectData } = loadDpapi()
  const input = { cbData: blob.length, pbData: blob }
  const output = { cbData: 0, pbData: null }
  const ok = cryptUnprotectData(input, null, null, null, null, 0, output)
  if (!ok) {
    const code = koffi.errno()
    throw new Error(
      `qoder: CryptUnprotectData failed (Win32 error ${code}). The credential can only be` +
        ' unwrapped by the Windows user account that signed in to Qoder.',
    )
  }
  try {
    return Buffer.from(koffi.decode(output.pbData, 'uint8', output.cbData))
  } finally {
    localFree(output.pbData)
  }
}

/**
 * Read the plaintext machine id from a Qoder user-data directory.
 *
 * Kept here rather than in `credentials.js` so every filesystem-touching native
 * concern lives in one module. Returns `null` when the file is absent, because
 * the header it feeds is optional.
 */
export async function getMachineId(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return null
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const raw = await readFile(join(dir, 'auth.machine-id'), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
