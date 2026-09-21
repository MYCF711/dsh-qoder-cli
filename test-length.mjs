// Channel 1: Length Analysis - Direct WASM call
import { modelCacheEncrypt, init } from './lib/qoder/wasm-credential-reader.js'

const PLAINTEXTS = [
  'x',
  'xxxxxxxxxx',
  Buffer.alloc(16).toString(),
  Buffer.alloc(17).fill('x').toString(),
  Buffer.alloc(32).toString(),
  Buffer.alloc(33).fill('x').toString(),
  Buffer.alloc(64).toString(),
]

async function main() {
  console.log('=' .repeat(80))
  console.log('CHANNEL 1: LENGTH ANALYSIS')
  console.log('=' .repeat(80))
  console.log('\nGoal: Determine fixed overhead and padding behavior\n')
  
  const wasmPath = new URL('./lib/qoder/wasm/qoder_auth_wasm_bg.wasm', import.meta.url)
  await init(wasmPath)
  
  // Test with two UIDs to cross-validate
  const uids = ['test-account-uid', 'another-test-uid']
  
  for (const uid of uids) {
    console.log(`UID: ${uid}`)
    console.log('-'.repeat(80))
    
    for (const pt of PLAINTEXTS) {
      try {
        const b64 = modelCacheEncrypt(pt, uid)
        const raw = Buffer.from(b64, 'base64')
        const delta = raw.length - pt.length
        const blocks = Math.round(raw.length / 16)
        console.log(`  ${pt.length.toString().padStart(3)}B → ${raw.length.toString().padStart(3)}B (+${delta}b, ~${blocks} blocks)`)
      } catch (e) {
        console.log(`  ${pt.length.toString().padStart(3)}B → ERROR: ${e.message}`)
      }
    }
    
    console.log()
  }
  
  console.log('=' .repeat(80))
  console.log('ANALYSIS EXPECTATIONS:')
  console.log('=' .repeat(80))
  console.log('[GCM minimum]: 1B + 12B nonce + 16B tag = minimum 29B output')
  console.log('[CBC standard]: Only padding overhead; IV typically embedded in ciphertext')
  console.log('[No header]: If 1B→16B exactly, then no prefix/suffix headers')
  console.log('\nIf 1B→16B, 17B→32B, 32B→32B → Pure PKCS#7, no extra overhead')
  console.log('If all ciphertexts are multiples of 16: Block cipher confirmed')
}

main().catch(console.error)
