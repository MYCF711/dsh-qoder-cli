# Final integration review — t13 (attempt 1)

**Status: BLOCKED — premise unmet. Report is a pre-t12 baseline inventory, not a pass.**
**Reviewer:** ds-a · **Date of measurement:** t13 attempt 1
**Verdict: `blocked` (no verdict=pass claimed; t11/t12 unlanded)**

---

## 1. Why this review could not be performed

t13 was scoped as "在 ds-b 的 `readRemoteCatalog` 集成完成后" (after ds-b's
`readRemoteCatalog` integration landed). That integration has **not landed**, and
three of the four review items name behaviour of code that does not exist.

Dependency state at review time (measured, not relayed):

| Task | Owner | Status |
|---|---|---|
| t11 端点选举复刻 + model/list 在线拉取全链实验 | glm-b | `in_progress` |
| t12 `readRemoteCatalog` 集成（第四层在线目录） | ds-b | `pending` (attempt 0 — never claimed) |
| t8 host 路由与 endpoint 选举对照分析 | ds-b | `pending` |

**t12 is the task that creates `readRemoteCatalog`.** Until t12 lands, review
items 1a–1c (remote failure silent / `configHome` same-source / concurrent
`refreshCatalog` re-entrancy) have no subject to inspect. Writing findings about
them now would be inventing an implementation and reviewing the invention.

---

## 2. Verified inventory of the integration surface as it stands (pre-t12)

This is the part of the round that produced real evidence. Every claim below was
read out of the working tree in this attempt.

### 2.1 `readRemoteCatalog` does not exist anywhere

```
grep -r 'readRemoteCatalog|refreshCatalog|remote' lib/
  lib/index.js:161:  const refreshCatalog = async () => {
  lib/index.js:189:  void refreshCatalog()
```

Both matches are a **local** refresh closure in `lib/index.js`, not a remote
reader. **Zero matches for the identifier `readRemoteCatalog`.**

### 2.2 `lib/qoder/catalog-reader.js` export surface (exhaustive)

`qoderConfigHome`, `catalogPathFor`, `catalogPointerPath`, `wasmCandidatePaths`,
`initAuthWasm`, `decryptCatalog`, `readLocalCatalog`, `rawModelToCatalogEntry`.

No remote/network reader is exported. The module header (L13–17) and L24 document
its inputs as `node:fs/promises`, `node:fs`, `node:os`, `node:path`,
`node:url` — **no HTTP client is imported**, so a remote tier cannot currently be
reached from this module without a new import.

### 2.3 `lib/qoder/models.js` is still a THREE-tier chain

`buildCatalog` (L202–252) resolves in this order:

1. `readLocalCatalog(configHome)` → `source = 'local-cache'` (L207–217)
2. `./catalog-snapshot.json` → `source = 'bundled-snapshot'` (L222–237)
3. `FALLBACK_QODER_MODELS` → `source = 'fallback'` (L238)

The function's own docstring at L186–196 states "**Three tiers**, best information
first". The task brief calls for a **four**-tier chain with the remote catalogue as
the outermost tier — that fourth tier is absent.

**Consequence for the t12 integration:** the fourth tier must be inserted *before*
`local-cache` in the resolution order (freshest live server directory first), which
also means the `source` value for it must be introduced and the three existing
`source` literals kept stable — `test/models-catalog.test.mjs:229` asserts
`catalog[0]?.source === 'bundled-snapshot'` for the empty-config case, so a
mis-ordered remote tier that answers in that test's environment would break it.

### 2.4 `configHome` threading — the same-source question, answered for tier 1 only

`buildCatalog` takes `options.configHome` and forwards it to `readLocalCatalog`
(L207). `readLocalCatalog(configHome = qoderConfigHome())` and
`qoderConfigHome(home = homedir())` resolve `process.env.QODER_CONFIG_DIR ?? join(home, '.qoder')`.

So **tier 1 is already same-source** with respect to `QODER_CONFIG_DIR`: the env
var wins over the injected `home`, and `configHome` is threaded explicitly rather
than re-derived. Two tests depend on exactly this (`models-catalog.test.mjs` sets
`process.env.QODER_CONFIG_DIR` to a temp dir and passes nothing).

**Open question for t12 (cannot be closed until it lands):** when the remote tier
caches a downloaded catalogue to disk, it must write under the *same* resolved
`configHome` that tier 1 reads from. If it re-derives via `qoderConfigHome()`
while tier 1 received an explicit `configHome` argument, the two tiers would read
different directories in every test that injects a temp home — a silent
split-brain that produces "remote tier works, local tier sees nothing" symptoms.

### 2.5 Re-entrancy — the pattern the codebase already uses

`catalog-reader.js:178–209` (`initAuthWasm`) is the house pattern for a
single-flight guard:

```js
let initPromise = null
export async function initAuthWasm() {
  if (Dn !== null) return Dn
  if (initPromise === null) {
    initPromise = (async () => { /* ... */ })()
    initPromise.catch(() => { initPromise = null })   // allow retry after failure
  }
  return initPromise
}
```

Note the `catch(() => { initPromise = null })` — a **failed** attempt clears the
guard so a later call retries, while a successful one leaves `Dn` set and
short-circuits. Any `refreshCatalog` in the remote tier should reuse this exact
shape; a bare `if (running) return; running = true` without the failure-clearing
branch would wedge the tier permanently after one network error and never
re-probe — the same class of defect as the `loadGateCache` `typeof` conflation
found in t4.

---

## 3. What was NOT done, and why

| t13 item | Status | Reason |
|---|---|---|
| 1) 审查 remote 失败静默 / configHome 同源 / 并发重入 | **not done** | Subject code absent (§2.1, §2.3). Items 1a/1c have no implementation; 1b answered for tier 1 only (§2.4) |
| 2) 全量 `test/*.test.mjs` 无回归 | **not done** | Meaningful only against the post-t12 tree; a green now is green for the three-tier chain t12 will replace |
| 3) `node tools/gate-catalog.mjs` 在线实测 | **not done** | Consumes real quota. Validating a build that t12 immediately supersedes spends the sprint's scarcest resource for no decision value |
| 4) card 上 17 个模型与 gate 结果一致 | **not done** | The "17 models" figure describes the current snapshot tier; it would validate the pre-integration path, not the integration under test |

---

## 4. Recommendation to the captain

1. **Dequeue t13** (or leave it blocked) until **t11 and t12 land**. Re-issue it
   with the dependency explicitly satisfied; the four review items then have real
   subjects.
2. **When t12 lands, the reviewer must check, in this order:**
   - §2.4 — remote cache writes under the *resolved* `configHome` (arg threaded,
     not re-derived from the env var independently);
   - §2.3 — the remote tier is inserted **before** `local-cache`, and
     `test/models-catalog.test.mjs:229` (which pins `source === 'bundled-snapshot'`)
     still passes;
   - §2.5 — the refresh guard clears on failure so a transient network error
     re-probes rather than wedging the tier;
   - §2.2 — the remote reader lives in a module that actually imports an HTTP
     client; `catalog-reader.js` currently imports none.
3. **Quota:** hold the live `gate-catalog.mjs` run until after t12, so the one
   live measurement covers the four-tier chain rather than the three-tier one.

---

## 5. Verification of THIS report

- Every code claim in §2 was read from the working tree during t13 attempt 1
  (`read` on `lib/qoder/catalog-reader.js`, `lib/qoder/models.js`; `grep` over
  `lib/`).
- The dependency table in §1 is the live shared-task state, not a relayed summary.
- No file other than this report was modified by t13.
- This report deliberately carries **no `verdict: pass`**: the review's subject
  did not exist, so there is nothing to pass.
