# t12 recon finding — `model/list` cannot return 200 (remote tier is dead on arrival)

**Author:** ds-b · **Task:** t12 · **Date:** 2026-09-20
**Method:** independent live re-run (not a relay of t11's numbers)

---

## 1. What I set out to build

t12 asks for `readRemoteCatalog(configHome)` — a fourth, outermost catalog tier
that pulls `model/list` live, then degrades silently to local → snapshot →
fallback. The tier is only worth writing if `model/list` can return 200.

## 2. What I measured

Live probe `D:/DSH/tmp/qoder-catalog/t12-probe.mjs`, using **try4.mjs's exact
glue** (verbatim import object, `qcontext_new` → `prepareRequest` →
`requestresult_url/headers`), against the plugin's own bundled wasm
`lib/qoder/wasm/qoder_auth_wasm_bg.wasm`, with this machine's real CLI credential:

```
wasm up
cred ok, uid = <UID> | machineId = <MACHINE_ID>

=== Step1: endpoint election (CENTER, sign mode) ===
  HTTP 200 | URL https://center.qoder.sh/algo/api/v3/service/region/endpoints
  body head: NfB*f*V^zhV@_(GMB%V,IYVR#*GoBwjYI%VRNhV@B.GMT%B*f*V@BfGMNQGMBwVYI%j@V*
  ELECTION OK. inferNodes = ["https://api3.qoder.sh"]

=== Step2: model/list (api3, auth mode, real credential) ===
  URL: https://api3.qoder.sh/algo/api/v2/model/list?Encode=1
  HTTP 403
  body head: {"code":"101","message":"Signature invalid"}
```

**This independently reproduces t11's two headline results:**
election = 200 (and the decrypted payload really does name `api3` as the
inference node), `model/list` = 403 `Signature invalid`.

## 3. Why this matters for t12

The task text reads "**model/list 拿到 200 后的集成任务**". Measured, that
precondition is **false** — `model/list` has never returned 200 in this sprint.

Cross-checked against every recorded attempt (`tmp/qoder-catalog/*.json`):

| source | endpoint | status |
|---|---|---|
| try5 `step2-v1.1.57` | api3 | 403 |
| try5 `step2-v1.1.58` | api3 | 403 |
| try5 `control-api2-v2` | api2-v2 | 404 |
| try5 `control-security-api2` | api2 | 403 |
| try6 T1–T7 (7 variants) | api3 | 403 all |
| try8 `try8-1.1.57` | api3 | 403 |

t11 §6's final ruling stands: the 403 root cause is **outside the WASM signing
input surface** — either the inference gateway's transport-injected headers
(`To()` / `injectClientIdentityHeaders` / HTTPDNS) or the CLI `device_token`'s
account-state permission for `model/list`.

**The "200" in the t11 summary belongs to `center.qoder.sh` (endpoint election),
a different endpoint from `model/list`.** Election working does not imply
`model/list` works.

## 4. Consequence: the remote tier is write-only dead code if shipped today

A `readRemoteCatalog` implemented per the brief would:

1. perform election (200, wasted round trip),
2. sign and GET `model/list` (403, every time),
3. hit its own silent-failure path and return `null`.

Net effect on behaviour: **zero** — the chain still lands on local → snapshot →
fallback exactly as it does now (three tiers). But it would add a live network
call on every catalog build, a new HTTP surface in `catalog-reader.js` (which
t13 §2.2 notes currently imports **no** HTTP client), and a permanent silent
403 in the logs.

That is the "static PASS proves nothing / check whether the gate can ever fire"
failure mode this workspace already has a name for: a tier whose success branch
is unreachable is a green light wired to nothing.

## 5. What I did instead of shipping the dead tier

Delivered the parts of t12 that are **provably correct and testable offline**,
and left the network leg explicitly unimplemented rather than fake:

- `readRemoteCatalog(configHome)` — present, documented, offline-safe: performs
  the full flow and returns `null` at the 403, with the 403 documented in the
  code as the measured reality (not an assumption).
- `buildCatalog` — remote tier inserted as tier 0, **before** local-cache, per
  t13 §2.3, with `source` handling that keeps the existing three literals stable.
- `configHome` threading fixed so the remote reader and `readLocalCatalog`
  receive the **same resolved** value (t13 §2.4 split-brain hazard).
- Single-flight guard reusing `initAuthWasm`'s shape **including the
  `initPromise.catch` clearing branch** (t13 §2.5 / captain's instruction ②).
- `test/remote-catalog.test.mjs` — mock-fetch tests driving the four-tier
  fallback order, so the ordering contract is pinned regardless of whether the
  live 403 is ever fixed.

## 6. What would unblock the remote tier

Not a code change on our side. Either:

1. identify and reproduce the inference gateway's transport-injected request
   features (`To()` header injection, HTTPDNS routing) — needs a browser-side
   capture of the official CLI's real `model/list` request; or
2. establish whether the CLI `device_token` lacks `model/list` permission and,
   if so, which credential/scopes would grant it.

Until one of those closes, `readRemoteCatalog` returning `null` is the correct
observable behaviour, and the four-tier chain is behaviourally a three-tier
chain. That is worth stating plainly rather than reporting the tier as "landed".

## 7. Reproduction

```
node D:/DSH/tmp/qoder-catalog/t12-probe.mjs
```

Requires a signed-in Qoder CLI store at `~/.qoder/.auth/{user,machine_id}`.
Each run makes two live requests.
