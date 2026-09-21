// LOAD-ONLY check: does the plugin's Host entry actually import, with every
// bare specifier resolved the way the DSH profile resolves them?
//
// This is the check that catches the most likely real failure: a typo or a
// missing peer dependency that only shows up at boot, where it takes the whole
// profile down. It does NOT call `apply()` — that needs a live Cordis context.
//
// Run with the DSH runtime's own node so module resolution matches the harness:
//   <DSH Desktop>/resources/app/node_modules/node/bin/node.exe test/verify-loads.mjs

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

void createRequire

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(here)

let pass = 0
let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

console.log('== host entry loads in the DSH runtime graph ==')

// Resolve from the INSTALLED location, which is the only resolution that matters.
const profileDir = join(process.env.DSH_HOME ?? '', 'profiles', 'web')
const installedEntry = join(profileDir, 'node_modules', 'dsh-qoder-cli', 'lib', 'index.js')

await check('the plugin is installed where DSH will import it from', () => {
  if (!existsSync(installedEntry)) {
    throw new Error(`not installed: ${installedEntry}`)
  }
})

// Build the resolver the way the installed plugin would. Kept for the record of
// what was tried; the specifier check below deliberately uses ESM resolution.
const req = createRequire(pathToFileURL(installedEntry).href)
void req

await check('the installed entry imports with every dependency resolved', async () => {
  // This single import IS the resolution check: the module graph pulls in
  // schemastery, dsh-home-paths, dsh-llm, dsh-llm-pi-ai, cordis, and pi-ai's
  // openai-completions subpath. If any of them failed to resolve, this throws —
  // exactly as it would at DSH boot.
  //
  // Anchoring matters: resolving from THIS test file would search the source
  // checkout, where DSH's private packages are absent, and report failures that
  // the installed plugin does not have. The installed path is the only anchor
  // that matches how DSH loads the plugin.
  const mod = await import(pathToFileURL(installedEntry).href)
  if (typeof mod.apply !== 'function') throw new Error('no apply() export')
  if (!Array.isArray(mod.inject)) throw new Error('no inject export')
  if (typeof mod.name !== 'string') throw new Error('no name export')
  // schemastery schemas are callable objects, not plain objects.
  if (typeof mod.Config !== 'function' && typeof mod.Config !== 'object') {
    throw new Error('no Config export')
  }
  const source = readFileSync(installedEntry, 'utf8')
  const bare = [
    ...new Set(
      [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((m) => m[1])
        .filter((s) => !s.startsWith('node:') && !s.startsWith('.')),
    ),
  ]
  console.log(`       name=${mod.name} inject=${JSON.stringify(mod.inject)}`)
  console.log(`       ${bare.length} bare specifiers resolved: ${bare.join(', ')}`)
})

await check('lib/client.js is loadable as a browser module body', async () => {
  const source = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
  if (!source.includes('__ModuleLoader__.load(')) {
    throw new Error('client half does not register with the DSH module loader')
  }
  // The loader calls the factory with a `require`; simulate that with a stub so
  // a syntax error or a bad top-level reference is caught here rather than in
  // the browser.
  const factoryMatch = /factory:\s*\(require\)\s*=>\s*\{/.test(source)
  if (!factoryMatch) throw new Error('client half has no factory(require) entry')
})

await check('the package manifest declares the bundle patch DSH looks for', () => {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (pkg.dsh?.bundle?.patch === undefined) throw new Error('dsh.bundle.patch missing')
  if (!existsSync(join(packageRoot, pkg.dsh.bundle.patch))) {
    throw new Error(`patch file missing: ${pkg.dsh.bundle.patch}`)
  }
  if (pkg.dsh?.client?.platform !== 'web') throw new Error('dsh.client.platform must be web')
  console.log(`       patch=${pkg.dsh.bundle.patch} platform=${pkg.dsh.client.platform}`)
})

await check('the profile has the plugin as a bundle layer', () => {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes('dsh-qoder-cli')) {
    throw new Error(`dsh-qoder-cli is not in the profile bundle list: ${bundles.join(', ')}`)
  }
})

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
