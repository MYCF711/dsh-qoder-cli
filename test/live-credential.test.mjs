// End-to-end proof that the Qoder credential decrypt works from the plugin's
// own module graph, in-process, with no child process.
//
// This is the check that matters most: every other module can be verified with
// fake data, but only this one proves the plugin can actually read the user's
// real Qoder login on this machine.

import assert from 'node:assert/strict'

let pass = 0
let fail = 0
let skipped = 0
const failures = []

/** Marks a test as environment-gated: skipped, not failed, when absent. */
async function liveTest(name, fn) {
  if (!hasLiveCredential) {
    skipped++
    console.log(`  SKIP ${name}  (no live Qoder credential on this machine)`)
    return
  }
  await test(name, fn)
}

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

const credMod = await import('../lib/qoder/credentials.js')
const nativeMod = await import('../lib/qoder/native.js')

console.log('== live credential decryption ==')

// Precondition probe: the live-credential tests require a signed-in Qoder
// desktop install on this machine. When it is absent (the user signed out, or
// the plugin has not run a device login yet), the tests SKIP with an explicit
// reason instead of reporting a red that looks like a code regression.
const hasLiveCredential = (await credMod.discoverCredential(nativeMod.dpapiUnprotect)) !== null

await test('dpapiUnprotect is callable and returns a Buffer for a valid blob', async () => {
  // Round-trip through DPAPI itself, so this validates the binding rather than
  // depending on Qoder's file being present. The binding is obtained through the
  // plugin's own resolver, so this test fails for the same reason the plugin
  // would fail — not for a different one.
  const koffi = nativeMod.loadFfiBinding()
  const crypt32 = koffi.load('crypt32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  // koffi's type registry is process-global, so this struct must NOT reuse the
  // name the plugin itself registers — doing so throws "Duplicate type name".
  const DATA_BLOB = koffi.struct('DATA_BLOB_PROBE', { cbData: 'uint32', pbData: 'void *' })
  const localFree = kernel32.func('void *LocalFree(void *hMem)')
  const encrypt = crypt32.func(
    'bool CryptProtectData(DATA_BLOB_PROBE *pDataIn, void *szDataDescr, DATA_BLOB_PROBE *pOptionalEntropy,' +
      ' void *pvReserved, void *pPromptStruct, uint32 dwFlags, _Out_ DATA_BLOB_PROBE *pDataOut)',
  )
  const secret = Buffer.from('qoder-round-trip-probe', 'utf8')
  const input = { cbData: secret.length, pbData: secret }
  const output = { cbData: 0, pbData: null }
  assert.equal(encrypt(input, null, null, null, null, 0, output), true, 'CryptProtectData failed')
  let protectedBlob
  try {
    protectedBlob = Buffer.from(koffi.decode(output.pbData, 'uint8', output.cbData))
  } finally {
    localFree(output.pbData)
  }
  const roundTripped = nativeMod.dpapiUnprotect(protectedBlob)
  assert.ok(Buffer.isBuffer(roundTripped), 'expected a Buffer')
  assert.equal(roundTripped.toString('utf8'), secret.toString('utf8'))
})

await test('rejects a DPAPI blob that was never protected', () => {
  assert.throws(() => nativeMod.dpapiUnprotect(Buffer.from('not protected at all', 'utf8')))
})

await liveTest('discovers and decrypts the real Qoder credential on this machine', async () => {
  const found = await credMod.discoverCredential(nativeMod.dpapiUnprotect)
  assert.ok(found !== null, 'expected a Qoder credential to be discoverable')
  assert.equal(typeof found.credential.token, 'string')
  assert.ok(found.credential.token.length > 0, 'token must be non-empty')
  assert.equal(typeof found.credential.refreshToken, 'string')
  assert.equal(typeof found.credential.user.id, 'string')
  assert.equal(found.credential.schemaVersion, 1)
  // Report only non-secret facts.
  console.log(`       dir=${found.dir}`)
  console.log(`       user=${found.credential.user.name} tokenLen=${found.credential.token.length}`)
  console.log(`       expiresAt=${found.credential.expiresAt}`)
  console.log(`       machineId=${found.machineId === null ? '<none>' : found.machineId}`)
})

await liveTest('the discovered credential is not accidentally a placeholder', async () => {
  const found = await credMod.discoverCredential(nativeMod.dpapiUnprotect)
  assert.ok(found !== null)
  assert.notEqual(found.credential.token, 'dt-TOKEN-1', 'must not be the test fixture value')
  assert.equal(typeof found.machineId, 'string', 'a machine id is expected on this install')
  assert.match(found.machineId, /^[0-9a-f-]{36}$/i)
})

console.log('')
console.log(`== ${pass} passed, ${fail} failed${skipped > 0 ? `, ${skipped} skipped` : ''} ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
