# DEFECT — `modelCacheEncrypt` throws on non-ASCII input (`const` reassignment)

**Found by:** ds-b, while running the full suite for t12 (unrelated to t12's edits)
**File:** `lib/qoder/wasm-credential-reader.js` — **NOT owned by t12**; reported, not fixed
**Severity:** high (breaks the documented catalog fixture path)
**Status:** open

---

## Symptom

`test/catalog-reader.test.mjs` fails 2/8 in the full suite:

```
FAIL decryptCatalog: encrypt fixture chat -> decrypt -> deep equal
     Assignment to constant variable.
FAIL readLocalCatalog: create temp dir, write encrypted catalog, read back
     Assignment to constant variable.
```

Stack (captured with a temporary `error.stack` print, since the test only prints
`message.split('\n')[0]`):

```
TypeError: Assignment to constant variable.
    at Xx (lib/qoder/wasm-credential-reader.js:146:20)
    at modelCacheEncrypt (lib/qoder/wasm-credential-reader.js:224:15)
    at test/catalog-reader.test.mjs:105
```

## Root cause

`lib/qoder/wasm-credential-reader.js`, inside `Xx`:

```js
135:  const i = A.length          // <-- const
136:  let n = e(i, 1) >>> 0
...
144:  if (o !== i) {
145:    if (o !== 0) A = A.slice(o)
146:    n = t(n, i, (i = o + 3 * A.length), 1) >>> 0   // <-- assigns to that const
```

`i` is declared `const` but reassigned on line 146. The reference implementation
in `test/wasm-encrypt-helper.mjs` (and the historical form of this file) used a
mutable binding.

The `if (o !== i)` branch is only entered when the scan loop hits a character
with `charCodeAt > 127` — i.e. **only for non-ASCII input**.

## Measured impact

```
ASCII-only payload  {"a":"b"}     -> modelCacheEncrypt OK (56 chars)
CJK payload         {"a":"模型"}   -> modelCacheEncrypt THROWS
                                     "Assignment to constant variable."
catalog-1.1.58.json               -> 228 non-ASCII characters  (hits the bug)
```

So the failure is **payload-dependent**: pure-ASCII catalogs still encrypt, any
catalog containing CJK (i.e. every real Qoder one, and the shipped fixture)
throws.

Note `credentialStorageEncrypt` with the same CJK payload **did** succeed — that
function carries its own copy of the scan logic, so the two copies have diverged.
Worth aligning them.

## Suggested fix (not applied — out of t12's scope)

```diff
-  const i = A.length
+  let i = A.length
```

Then re-run `node test/catalog-reader.test.mjs` — expected 8 passed, 0 failed.

## Scope note

t12 touched `lib/qoder/catalog-reader.js`, `lib/qoder/models.js`,
`lib/index.js`, `test/remote-catalog.test.mjs` and
`docs/FINDING-t12-remote-tier-403.md`. The failing stack contains **none** of
those files; the defect predates and is independent of t12. It is recorded here
because t12's regression run is what surfaced it, and a full-suite green is a
precondition for the sprint's exit criteria.
