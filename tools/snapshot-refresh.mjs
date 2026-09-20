#!/usr/bin/env node
/**
 * Refresh the bundled catalog snapshot (lib/qoder/catalog-snapshot.json).
 *
 * Decrypts the freshest local Qoder model cache (`catalog-v6`) via
 * lib/qoder/catalog-reader.js `readLocalCatalog()`, picks the first non-empty
 * scene (assistant preferred, then chat/app/qwake — the same priority order
 * lib/qoder/models.js uses when consuming the snapshot), and writes it as the
 * shipped snapshot so users without a local Qoder install still see the full
 * server directory.
 *
 * Usage:
 *   node tools/snapshot-refresh.mjs
 * Env:
 *   QODER_SNAPSHOT_OUT — override the output path (tests write into
 *   test/catalog-fixtures/); defaults to lib/qoder/catalog-snapshot.json.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { readLocalCatalog } from '../lib/qoder/catalog-reader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const DEFAULT_OUT = join(ROOT_DIR, 'lib', 'qoder', 'catalog-snapshot.json')

/** Scene priority — must stay in sync with lib/qoder/models.js SCENES. */
const SCENES = ['assistant', 'chat', 'app', 'qwake']

// ---------------------------------------------------------------------------
// 1. Decrypt the freshest local catalog
// ---------------------------------------------------------------------------

const catalog = await readLocalCatalog()
if (!catalog || typeof catalog !== 'object') {
  console.error('ERROR: no readable local catalog (no Qoder install/login, or decrypt failed)')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Pick the first non-empty scene, assistant first
// ---------------------------------------------------------------------------

let scene = null
let models = null
for (const name of SCENES) {
  if (Array.isArray(catalog[name]) && catalog[name].length > 0) {
    scene = name
    models = catalog[name]
    break
  }
}
if (scene === null) {
  console.error(`ERROR: local catalog has no non-empty scene (looked at: ${SCENES.join(', ')})`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Write the snapshot (UTF-8, 2-space indent, same single-scene shape the
//    shipped file uses — buildCatalog picks the scene back out on load)
// ---------------------------------------------------------------------------

const outEnv = process.env.QODER_SNAPSHOT_OUT
const outPath = outEnv
  ? (isAbsolute(outEnv) ? outEnv : resolve(process.cwd(), outEnv))
  : DEFAULT_OUT

writeFileSync(outPath, `${JSON.stringify({ [scene]: models }, null, 2)}\n`, 'utf8')
console.log(`[OK] refreshed snapshot from scene "${scene}" (${models.length} models) -> ${outPath}`)
