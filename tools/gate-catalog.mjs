#!/usr/bin/env node
/**
 * Gate catalog model probe script.
 *
 * Discovers Qoder credentials, builds the local catalog, and probes every unique
 * key against the chat gateway endpoint. Classifies responses as accepted (200),
 * rejected (400 + invalid_model_error), or unknown (anything else).
 *
 * Writes test/catalog-fixtures/gate-result.json and prints a human-readable table.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { discoverCredential } from '../lib/qoder/credentials.js'
import { dpapiUnprotect } from '../lib/qoder/native.js'
import { buildCatalog } from '../lib/qoder/models.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')

// ---------------------------------------------------------------------------
// 1. Acquire credential
// ---------------------------------------------------------------------------

let token = null
let credSource = 'plugin-discovery'
try {
  const credResult = await discoverCredential(dpapiUnprotect, process.env)
  if (credResult?.credential?.token) {
    token = credResult.credential.token
  }
} catch {
  // fall through to CLI credential path
}
if (!token) {
  // CLI device-flow credential: <configHome>/.auth/user is
  // credential_storage_encrypt(JSON, machineId.slice(0,16)) — same WASM family.
  try {
    const configHome = process.env.QODER_CONFIG_DIR ?? join(homedir(), '.qoder')
    const raw = readFileSync(join(configHome, '.auth', 'user'), 'utf8')
    const machineId = readFileSync(join(configHome, '.auth', 'machine_id'), 'utf8').trim()
    const helperModule = await import('./gate-wasm-helper.mjs')
    const { init, credentialStorageDecrypt } = helperModule
    await init(helperModule.WASM_PATH)
    const userInfo = JSON.parse(await credentialStorageDecrypt(raw, machineId.slice(0, 16)))
    token = userInfo.security_oauth_token ?? userInfo.access_token
    credSource = 'cli-device-flow'
  } catch (e) {
    console.log(`SKIP: no credential (plugin discovery and CLI store both failed: ${e.message})`)
    process.exit(3)
  }
}
if (!token) {
  console.log('SKIP: no credential')
  process.exit(3)
}
console.log(`[OK] credential acquired from ${credSource}`)

// ---------------------------------------------------------------------------
// 2. Build catalog (all keys, degraded or not)
// ---------------------------------------------------------------------------

const catalog = await buildCatalog()
console.log(`[OK] built catalog with ${catalog.length} models`)

// Collect unique keys (preserve first-seen order for probing)
const seenKeys = new Set()
const uniqueEntries = []
for (const entry of catalog) {
  if (!seenKeys.has(entry.id)) {
    seenKeys.add(entry.id)
    uniqueEntries.push(entry)
  }
}
console.log(`[OK] ${uniqueEntries.length} unique model keys to probe`)

// ---------------------------------------------------------------------------
// 3. Probe each key with sequential POST, 300ms gap
// ---------------------------------------------------------------------------

const results = []
let consecutive200 = 0

for (const entry of uniqueEntries) {
  const reqBody = JSON.stringify({
    model: entry.id,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
    stream: false,
  })

  try {
    const resp = await fetch('https://api2-v2.qoder.sh/model/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'qoder-worker/1.1.57',
      },
      body: reqBody,
    })

    const rawBody = await resp.text()
    let httpStatus = resp.status
    let bodyHead = rawBody.slice(0, 120)

    // Classification logic
    let status = 'accepted'
    let extra = undefined

    if (httpStatus === 200) {
      status = 'accepted'
      consecutive200++
    } else if (httpStatus === 400 && rawBody.includes('invalid_model_error')) {
      status = 'rejected'
      consecutive200 = 0
    } else {
      status = 'unknown'
      extra = {
        httpStatus,
        bodyHead,
      }
      consecutive200 = 0
    }

    results.push({
      key: entry.id,
      displayName: entry.name || entry.id,
      status,
      ...(extra ? extra : {}),
    })
  } catch (error) {
    results.push({
      key: entry.id,
      displayName: entry.name || entry.id,
      status: 'unknown',
      httpStatus: null,
      bodyHead: error?.message ?? 'request failed',
    })
  }

  // Rate limit: 300ms between requests
  if (entry !== uniqueEntries[uniqueEntries.length - 1]) {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

console.log(`[OK] probed all ${results.length} models`)

// ---------------------------------------------------------------------------
// 4. Write JSON result file
// ---------------------------------------------------------------------------

const outputDir = join(ROOT_DIR, 'test', 'catalog-fixtures')
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true })
}

const outputPath = join(outputDir, 'gate-result.json')
const jsonOutput = JSON.stringify(
  {
    measuredAt: new Date().toISOString(),
    results,
  },
  null,
  2,
)
writeFileSync(outputPath, jsonOutput, 'utf8')
console.log(`[OK] wrote ${outputPath}`)

// ---------------------------------------------------------------------------
// 5. Print human-readable table
// ---------------------------------------------------------------------------

const WIDTH_KEY = 16
const WIDTH_NAME = 28
const WIDTH_STATUS = 12

console.log('\n=== Model Gate Probe Results ===\n')

const header = ['KEY', 'DISPLAY NAME', 'STATUS'].map((h) => h.padEnd(Math.max(WIDTH_KEY, WIDTH_NAME, WIDTH_STATUS))).join(' | ')
const sep = Array.from({ length: header.length }).fill('-').join('')
console.log(header)
console.log(sep)

const lines = []
for (const r of results) {
  const keyStr = String(r.key).slice(0, WIDTH_KEY).padEnd(WIDTH_KEY)
  const nameStr = (r.displayName || '').slice(0, WIDTH_NAME).padEnd(WIDTH_NAME)
  const statusColor = r.status === 'accepted' ? '[ACCEPTED]' : r.status === 'rejected' ? '[REJECTED]' : '[UNKNOWN]'
  const statusStr = statusColor.padEnd(WIDTH_STATUS)
  lines.push(`${keyStr} | ${nameStr} | ${statusStr}`)
  if (r.status === 'unknown' && r.httpStatus !== null) {
    const headPreview = String(r.bodyHead).replace(/\n/g, '\\n').slice(0, 60)
    console.log(`      HTTP ${r.httpStatus}: ${headPreview}`)
  }
}

console.log(lines.join('\n'))
console.log('')

console.log(`Exit 0 — written ${outputPath}`)
