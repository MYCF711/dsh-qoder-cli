# t7 — `lib/index.js` `refreshCatalog()` 段审查报告

**审查对象**：`lib/index.js` **L150–188**（`refreshCatalog` 声明 + 唯一调用点），
连带 `lib/qoder/models.js`（`buildCatalog` 三层引导）、`lib/qoder/gate-cache.js`（TTL/探测）、
`lib/qoder/catalog-reader.js`（`qoderConfigHome`）、`lib/qoder/wasm-credential-reader.js`（`init`）
**审查时刻**：2026-09-20（本机当场执行）
**方式**：**report-only，未改任何文件**
**文件 mtime（审查期间未变）**：`index.js` 4:13:03、`gate-cache.js` 4:09:59

**结论**：**你的三条疑问中，②不成立（设计正确）；①③部分成立**——
共 **1 个 medium、4 个 low**，无 high，**无"必须立刻阻断"项**。

---

## 0. 证据与仪器可信度

| 脚本（均在 `D:\DSH\` 顶层，不在仓库内） | 作用 | 结果 |
|---|---|---|
| `.ds-c-t7-refresh.mjs` | 三层回退边界 + `QODER_CONFIG_DIR` 污染（实测） | 10/0 ✅ |
| `.ds-c-t7-race.mjs` | 重入 / `stopped` 竞态（真实模块 + 驱动器） | 7/0 ✅ |
| `.ds-c-t7-order.mjs` | IIFE 内**效果顺序** + `dshHome` 真值门 + 缓存往返 | 5/0 ✅ |
| `.ds-c-t7-instrument-check.mjs` | **仪器自检**：重建体是否忠实于 `index.js` | **7/0 — RECONSTRUCTION FAITHFUL** |

### 🔴 仪器自检（延续 t6 纪律：先证明"我检查了什么"）

`.ds-c-t7-race.mjs` **重建了 `refreshCatalog` 的控制流**来数探测轮次。
**重建体一旦与真实代码漂移，它的"只跑 1 轮"就什么都证明不了**——这正是 AGENTS.md §8④ 的形态
（自测通过 ≠ 被测对象正确）。故 `.ds-c-t7-instrument-check.mjs` 对着**真实 `index.js`** 逐条核验：

- 真实守卫文本**逐字**为 `if (!gateCache && !gateProbing && entries.length > 0)`；
- `gateProbing = true` **出现在** `void (async () => {` **之前**（同 tick 重入不可能双开）；
- `gateProbing = false` 位于 **`finally`**，且该 `finally` 属于**内层 IIFE**、**不属于外层 try**
  （外层是裸 `catch {}`，无 finally —— 若归属外层，抛错会在探测仍在跑时提前清标志）；
- 4 个 `stopped` 守卫点**逐字存在**；
- `refreshCatalog(` 全文**仅 1 次**（L188 的启动调用；声明是 `const refreshCatalog = async` 无括号）。

> **本次审查中我犯过 1 个仪器错误并当场改正**：自检最初断言"1 处声明 + 1 处调用 = 2 个 `refreshCatalog(`"，
> 实际只匹配到 1 个（声明行不含括号）→ **假红**。已确认是断言写错、非代码问题，改后 7/0。
> 留档理由同 t6：**我的检查器出错时，看起来和"代码有缺陷"完全同形**。

---

## ① 三层回退逻辑的边界

### 1.1 三层链真的会降级吗？—— **会，且实测抗污染**（**不是**缺陷）

`buildCatalog`（`models.js:202–251`）三层：**本地解密缓存 → 随包快照 → 内置 fallback**。
实测（`.ds-c-t7-refresh.mjs` / `-race.mjs`）：

| 输入 | 结果 | 判定 |
|---|---|---|
| 空 config home（无 `.models`） | `readLocalCatalog` 返回 `null` → 降级 | ✅ |
| `QODER_CONFIG_DIR` 指向**不存在**的路径 | **17 条**，**未抛错** | ✅ |
| `QODER_CONFIG_DIR` 指向一个**普通文件** | **17 条**，**未抛错** | ✅ |
| 欺骗目录含合法 `.models/default` 指针 + 坏密文 | 解密失败 → 继续降级，仍 **17 条** | ✅ |
| `{dshHome:null, gateCache:null}` | **17 条** | ✅ |

**"选择器永不为空"这条设计意图实测成立。** 每个候选都包在 `try/catch` 里，坏密文/坏路径一律降级。

### 1.2 🔴 **t7-1 [medium] `QODER_CONFIG_DIR` 能静默改写 tier-1 的读取目标**

`models.js:207` 是 `await readLocalCatalog()` —— **无参调用** ⇒ `configHome` 落到
`catalog-reader.js:31 qoderConfigHome()`：
```js
return process.env.QODER_CONFIG_DIR ?? join(home, '.qoder')
```

**实测确认**（`.ds-c-t7-refresh.mjs` ①b）：设 `QODER_CONFIG_DIR=<decoy>` 后
`qoderConfigHome()` **立即返回 decoy**，且 `readLocalCatalog` **确实去读 decoy 的 `.models`**。

**危害边界（说清楚，避免夸大）**：
- decoy 的密文若**无效** → 解密失败 → **降级到快照**，**结果不被污染**（实测 17 条不变）；
- 但 decoy 若含**可解密的合法目录**，tier-1 就会**变成另一个账号/另一个安装的目录**，
  且**静默生效**——无日志、无提示。

**为什么值得管**：这是**进程级环境变量**。DSH 宿主进程一旦带上它（用户手工设过、或某个
sidecar 设过），插件会在**无人察觉**的情况下换用别的目录。
**注意**：`resolveProbeToken`（`gate-cache.js:133`）**同样**读 `process.env.QODER_CONFIG_DIR`，
所以**同一个变量同时影响 tier-1 目录与探测凭据来源**——两处应当同源、却没有任何一致性校验。

**建议（低风险改法，二选一）**：
1. `buildCatalog` 显式接收并转发 `configHome`，由 `index.js` 单点决定（推荐，可控且可测）；
2. 至少在 `qoderConfigHome()` 命中环境变量时 `console.warn` 一次，让"换了目录"这件事**可见**。

> ⚠️ 若采用 1，**必须同步**给 `resolveProbeToken` 传 `configHome`，否则"目录"与"凭据"会取自不同来源——
> 那比现状更糟。

### 1.3 并发 `refreshCatalog` 重入 —— **实测不会双开探测**（**不是**缺陷）

`.ds-c-t7-race.mjs` 用真实 `buildCatalog` + 镜住的守卫：

| 场景 | 实测 | 判定 |
|---|---|---|
| 同一 tick 连发 2 次 | **probeRounds = 1**（`sets = 2`） | ✅ 守卫有效 |
| 第一次 settle 后再调 | **probeRounds = 2** | ✅ 预期行为（缓存仍空 ⇒ 该再探） |
| `stopped=true` 且探测在飞 | `gateProbing` **回到 false** | ✅ `finally` 生效，不会永久卡住 |

**关键点**：`gateProbing = true` 在 spawn 之前**同步**赋值（自检已逐字确认），
所以"检查-置位"之间**没有 await 间隙**，JS 单线程下不可能双开。

**⚠️ 但发现一个真实边界 —— t7-2 [low]**：`gateProbing` 是**每次 `apply()` 调用各自一份的闭包 `let`**
（`index.js:159`）。DSH 若**同进程重挂载插件**（重载/热更新），**新 injector 有全新标志位**，
旧 IIFE 若仍在飞，则**两轮探测并存** —— 会各写一次缓存（`saveGateCache` 同 pid 同名 temp，
原子 rename，**最后一次胜出，不会写出撕裂文件**，`gate-cache.js:58`）。危害低（重复探测 ~5s + 一次多余写），
但**值得知悉**：进程级缓存应配进程级标志，或把探测结果做成幂等。

---

## ② `gateProbing` 在 `stopped` 之后的竞态 —— **不成立，设计正确**

**结论：这一条你的担心可以撤销。** `.ds-c-t7-instrument-check.mjs` 逐条核验：

- `stopped` 检查**共 3 处**，覆盖整条异步链：`L164`（`catalog.set` 之前）、
  `L171`（token 解析之后）、`L173`（`probeCatalog` 之后）；外加 `L176` 的 `if (!stopped) catalog.set(refined)`。
- **`gateProbing = false` 在 `finally` 里**，因此：**无论中途 `return`、抛错、还是 `stopped`，
  标志必然复位**（`.ds-c-t7-race.mjs` 实测：stop 后 `isProbing()` 回到 `false`）。
- **实测未发现"永久卡住"路径**：`finally` 是唯一清零点，且必然执行。

### 2.1 唯一可确证的**顺序**问题 —— t7-3 [low]

```
L173  if (stopped) return                      ← 最后一个停止点
L174  await saveGateCache(...).catch(() => {}) ← 未受 stopped 保护
L175  refined = await buildCatalog(...)
L176  if (!stopped) catalog.set(refined)       ← 又受保护
```

若 `stopped` 恰在 **L173 与 L176 之间**落地：**缓存被写、内存 catalog 不被更新**。
**实测影响有益无害**：写下去的是**刚测出的正确结果**，下次启动**直接命中新鲜缓存**（
`loadGateCache` TTL 24h，`gate-cache.js:44–47`），而**本进程已濒死、stale 内存值无影响**。
⇒ **判为 low，不建议改**（改反而增加复杂度）。记录在案是为了让"有意为之"与"漏加守卫"可区分。

### 2.2 `dshHome` 真值门 —— t7-4 [low]

```js
L162  const gateCache = dshHome ? await loadGateCache(dshHome) : null
L174  if (dshHome) await saveGateCache(dshHome, results)
```

`dshHome` 为**假值**（`''` / `null` / `undefined`）时，**读写双双跳过** ⇒ 每次启动都冷缓存、
**每轮都重新探测**。实测：17 个模型 × `PROBE_INTERVAL_MS=300`（`gate-cache.js:27`）
≈ **5 秒**探测窗口。

**实测确认该守卫是"承重"的**（不是冗余）：直接 `saveGateCache(null, ...)` 会抛
`ERR_INVALID_ARG_TYPE`（`join(null, ...)`），故 `if (dshHome)` **确实在防崩溃**。
⇒ **代码正确**，只是**降级路径静默**：用户不会知道"缓存一直没生效"。
建议（可选）：冷缓存且 `dshHome` 假值时 `console.warn` 一次。

---

## ③ `buildCatalog` options 传参遗漏

### 3.1 签名审计（实测）

`models.js:203` 为 `buildCatalog(options = {})`，**实际只解构 `{ dshHome, gateCache }`**：

```js
const { dshHome = null, gateCache = null } = options
```

实测（`.ds-c-t7-refresh.mjs` ③）：传入 `{dshHome, gateCache, configHome:'IGNORED', token:'IGNORED'}`
→ **结果与不传完全相同**。**未解构的键被静默忽略**——这既是"遗漏"，也是"静默失败"的温床。

### 3.2 🔴 **t7-5 [low→medium] `dshHome` 名义上被传入，实际既不作用于 tier-1 也不作用于 tier-2**

这是本次最值得你注意的**传参语义问题**：

- `index.js:163` 传了 `{ dshHome, gateCache }`，看起来"目录已受控"；
- 但 `models.js:207` 是 `await readLocalCatalog()` —— **没把 `dshHome` 传进去**，
  tier-1 实际由 **`QODER_CONFIG_DIR`/`homedir()`** 决定（见 t7-1）；
- `models.js:223` 的 tier-2 用的是**包内相对 URL**（`new URL('./catalog-snapshot.json', import.meta.url)`），
  与 `dshHome` **无关**。

⇒ **`dshHome` 在 `buildCatalog` 里唯一真正的作用是 `gateCache?.results` 的解释上下文**
（`models.js:243–248` 依据 `measured` 覆写 `degraded`）。**这没错，但极易被误读**为
"传了 dshHome 就等于目录受控"。**建议**：把参数改名（如 `{ snapshotHome, gateCache }`）
或在 JSDoc 里写明**它不限定 tier-1/tier-2 的查找范围**。

### 3.3 `index.js` 两处调用点的**不一致** —— t7-6 [low]

```js
L163  buildCatalog({ dshHome, gateCache })                        // refreshCatalog
L214  buildCatalog({ dshHome, gateCache })                        // catalogDump（route）
```
两处**恰好一致**（这是好事，无遗漏）。但**两处都各自独立 `loadGateCache`**：

```js
L162  const gateCache = dshHome ? await loadGateCache(dshHome) : null
L213  const gateCache = dshHome ? await loadGateCache(dshHome) : null
```
⇒ **`catalogDump` 路由每次被调用都重读一次缓存文件**（另一处磁盘 IO + JSON.parse）。
`catalogDump` 是用户点「通过 GitHub 分享目录」时触发的**低频**操作，**危害可忽略**，
列出仅为闭合"传参/取值遗漏"这一问。**不建议为此改动**。

### 3.4 ⚠️ 与 `init()` 修复的**交叉影响**（值得你知悉，非缺陷）

`gate-cache.js:137` 的 `resolveProbeToken` 调 `init()` **无参**——这正是
`wasm-credential-reader.js:31` 于 **4:15:19** 改成 `init(wasmPath = WASM_PATH)` 所修复的那个调用形态。

⇒ **`failover.test.mjs` 里两条"缺陷存档"红与这里同源**：
- **修复前**：`init()` 抛错 → `resolveProbeToken` 的 `catch` 吞掉 → **CLI 探测分支不可达** →
  探测只能靠 `discoverCredential` 一条路；
- **修复后**：CLI 分支**已可达**，探测凭据来源**多了一条**。

**这对 t7 的意义**：**②的"竞态"结论是在修复后的代码上得出的**。
若有人回滚 `init()` 默认值，`resolveProbeToken` 会**静默退化为单路径**（不报错、不告警），
探测成功率下降但**无任何可观测信号**。**建议**：为 CLI 分支失败补一条
`logger?.warn`（当前 `catch` 完全静默，`gate-cache.js:140`）。

---

## 4. 问题清单

| ID | 位置 | 严重度 | 问题 | 建议 |
|---|---|---|---|---|
| **t7-1** | `catalog-reader.js:31` + `models.js:207` | **medium** | `QODER_CONFIG_DIR` 静默改写 tier-1 读取目标；该变量**同时**影响探测凭据来源（`gate-cache.js:133`），两处无一致性校验 | 由 `index.js` 单点决定并**显式转发** `configHome`（**须同步**传给 `resolveProbeToken`）；或至少 warn 一次 |
| **t7-5** | `models.js:203/207/223` | **low** | `dshHome` 名义传入，实际**不限定** tier-1（`readLocalCatalog()` 无参）与 tier-2（包内相对 URL）；极易被误读为"目录已受控" | 改名或 JSDoc 写明作用域（仅解释 `gateCache.results`） |
| **t7-2** | `index.js:159` + `188` | low | `gateProbing` 是 per-`apply()` 闭包标志；同进程重挂载时新旧探测可并存（各写一次缓存，原子 rename 不撕裂） | 进程级标志，或让探测写缓存**幂等** |
| **t7-4** | `index.js:162/174` | low | `dshHome` 假值时**读写双双跳过** ⇒ 每次启动冷缓存、重探 ~5s，**静默无提示**（守卫本身是承重的，防 `saveGateCache(null)` 崩溃） | 冷缓存 + `dshHome` 假值时 warn 一次 |
| **t7-3** | `index.js:173–176` | low | `stopped` 落在 L173 与 L176 之间时：**写缓存但不更新内存** | **建议不改**（实测对本进程有益无害，记录以便与"漏加守卫"区分） |
| **t7-6** | `index.js:213–214` | low | `catalogDump` 每次调用重读缓存文件（低频路径，可忽略） | 不建议改 |

**无 high 项。②（`gateProbing`/`stopped` 竞态）判定为"不成立、设计正确"。**

---

## 5. 复跑

```
node D:\DSH\.ds-c-t7-refresh.mjs
node D:\DSH\.ds-c-t7-race.mjs
node D:\DSH\.ds-c-t7-order.mjs
node D:\DSH\.ds-c-t7-instrument-check.mjs
```
**裸调，勿加管道/重定向**——本机实测 `| Select-Object` 与 `2>&1`、`> f 2> f` 均被沙箱拒绝
（`ResourceUnavailable`，AGENTS.md §3/§8 的 piped-stdio 边界，**非脚本失败**）。

**引用本报告任何数字前请复跑**：`index.js` 与 `gate-cache.js` 正被并行施工
（t6 期间我已实测到"同一命令相邻两次运行结果不同"）。
