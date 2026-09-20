# DEFECT: the CLI device-flow credential source is unreachable

Status: **open** — found by `test/failover.test.mjs` (task t5), NOT fixed there
because that task's scope forbids modifying `lib/`.

Found: 2026-09-20, while writing the offline failover unit tests.
Reproduced by: `node test/failover.test.mjs` (2 named tests pin the behaviour).

## Symptom

`listAlternateCredentials()` in `lib/qoder/credential-failover.js` documents four
credential sources. Source 3 — the CLI device-flow store at
`$QODER_CONFIG_DIR/.auth/user` — **can never yield a credential**, even when a
perfectly valid, correctly encrypted store is present on disk.

The walk silently falls through to source 4 (the explicit file). Because the
whole branch is wrapped in `try { } catch { }`, nothing is logged and nothing
throws: the loss is invisible at runtime.

## Root cause

`lib/qoder/wasm-credential-reader.js:31-32` declares `init(wasmPath)` and passes
`wasmPath` straight to `fs.readFileSync`, with **no default**:

```js
export async function init(wasmPath) {
  const bytes = fs.readFileSync(wasmPath);   // wasmPath === undefined
```

Both production callers invoke it with **no argument**:

- `lib/qoder/credential-failover.js:51` — `await init()`
- `lib/qoder/gate-cache.js:137`       — `await init()`

Measured on this machine:

```
await init()  ->  TypeError [ERR_INVALID_ARG_TYPE]
                  The "path" argument must be of type string or an instance of
                  Buffer or URL. Received undefined
```

The module already exports the correct path as `WASM_PATH`, so the intended
default was presumably `init(wasmPath = WASM_PATH)`.

## Evidence

`test/failover.test.mjs` contains two tests that pin this:

- `DEFECT: the CLI store is unreachable because init() is called with no path`
  — asserts the no-argument call rejects with `ERR_INVALID_ARG_TYPE`.
- `CLI store: a well-formed store still yields nothing while init() lacks its path`
  — writes a genuinely valid ciphertext (produced by the shipped
  `credentialStorageEncrypt` primitive, verified to round-trip) into a temp
  `QODER_CONFIG_DIR`, then asserts the walk yields `[]`.

Both currently pass, i.e. they record the defect rather than fixing it.

The cipher itself is **not** at fault: the same test file proves the WASM
primitive round-trips correctly and that `credential_storage_encrypt` is a real
export of `qoder_auth_wasm_bg.wasm`. The key is the machine id truncated to its
first 16 characters, and a wrong key fails the decrypt loudly.

## Suggested fix (not applied — out of scope for t5)

```js
export async function init(wasmPath = WASM_PATH) {
```

`WASM_PATH` is declared at line 76, after `init`; as a module-level `const` in
the temporal dead zone at definition time, it is still initialised by the time
`init()` is actually called, so the default is safe. Verify `gate-cache.js:137`
benefits from the same fix.

## After fixing

The two tests above must be updated deliberately:

- the `assert.rejects` in the DEFECT test becomes a positive assertion that
  `init()` resolves, and
- the CLI-store walk is expected to yield exactly one `cli-store` candidate.

Leaving them as-is after a fix would turn them red, which is the intended
signal that the pinned behaviour changed.
