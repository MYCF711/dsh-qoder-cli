# t6 补充：全量测试套件结果（Green gate）

**执行时刻**：2026-09-20，本机当场执行
**命令**：`cd D:\DSH\qoder-dsh-plugin; node test/run-all.mjs`
**退出码**：`1` → **RESULT: FAIL**
**汇总**：`files: 12, green: 11, failed: 1` / `assertions: 163 passed, 2 failed`

---

## 1. 结论：**t6 自身的交付物全部通过；套件的 2 处红是队友文件的陈旧测试，与 client.js 无关**

`client.js` 于 **4:03:57** 后**未被任何进程修改**（Length 22399、mtime 4:03:57 与 t6 开始时逐字节一致），
t6 为 report-only、未改仓库代码。故"实现变了"不成立于 `client.js`。

5 支 t6 取证闸门复跑**全绿**（见 §3）。

---

## 2. 唯一红项：`failover.test.mjs`（2 failed / 29 passed）

### 2.1 根因：**一个被修复的缺陷，其"缺陷存档测试"未同步更新**

`test/failover.test.mjs` L235–289 是**故意断言"旧缺陷行为"**的存档测试，原文自述：

> `init` has NO default for `wasmPath`, yet both production callers invoke it with no argument …
> Both call sites wrap the call in `try { } catch { }`, so the failure is silent …
> **if `init` gains `wasmPath ?? WASM_PATH`, they must be updated deliberately.**

**而修复恰恰已落地**——`lib/qoder/wasm-credential-reader.js:31` 现为：

```js
export async function init(wasmPath = WASM_PATH) {
```

### 2.2 因果顺序由 mtime 直接判定（不靠推测）

| 文件 | mtime | 说明 |
|---|---|---|
| `test/failover.test.mjs` | **4:13:12** | 写下"缺陷仍在"的断言 |
| `lib/qoder/wasm-credential-reader.js` | **4:15:19** | **后才**加上 `wasmPath = WASM_PATH` 默认值 |

测试**先**写下，修复**后**落地 ⇒ 测试断言的是**过时行为**。两条红的语义分别是：

| 测试 | 断言 | 现状 | 判定 |
|---|---|---|---|
| `DEFECT: the CLI store is unreachable…` | `assert.rejects(() => reader.init())` 必须抛 `ERR_INVALID_ARG_TYPE` | `init()` **不再抛错**（已修） ⇒ 断言失败 | **测试过时**，非产品缺陷 |
| `CLI store: a well-formed store still yields nothing…` | `assert.deepEqual(found, [], …)` 必须为空 | 实际 `found` 有 1 条 `cli-store` 凭据（diff 明示 `+ [{source:'cli-store', token:'token-from-cli-store'}]`） | **测试过时**：CLI store 分支**现已可达**，正是修复的预期效果 |

**即：这 2 条红恰恰是"修复成功"的证据，而非回归。** 其注释已明确要求"修复后必须**有意地**更新它们"——
这一步尚未由 owner 执行。

### 2.3 建议（**不在 t6 inScope**，交 owner/captain 处置）

`failover.test.mjs` 属 failover/凭据线，非 `lib/client.js`：
1. 将该测试从"断言旧缺陷"翻转为"断言新行为"：`init()` **不抛错**，且 CLI-store 候选**被找到**（`found.length === 1`）；
2. 更名去掉 `DEFECT:` 前缀，并把 L235–246 的缺陷说明改为"已修复 + 修复点"。

---

## 3. 一次运行中观察到的**跨轮次变化**（队友在并行施工，重要）

两次 `run-all.mjs` 之间，**有队友的修改落盘**，绿数从 9/12 升至 11/12：

| 文件 | 首次运行 | 第二次运行 | 期间被改（mtime） |
|---|---|---|---|
| `shim.test.mjs` | **FAIL** 16/2 | **PASS** 18/0 | `lib/qoder/shim.js` 4:13:23 |
| `snapshot-refresh.test.mjs` | **FAIL** 2/1 | **PASS** 3/0 | `test/snapshot-refresh.test.mjs` 4:15:34 |
| `failover.test.mjs` | FAIL 29/2 | FAIL 29/2 | 未再改（4:13:12） |

> ⚠️ **对"当前套件是否绿"的任何结论都有半衰期。** 上表即证据：同一命令、相邻两次运行给出**不同**结果。
> 引用本节数字前**必须复跑**并记录复跑时刻（AGENTS.md §11）。
> 首轮 `shim` 的 2 条红在本机**单跑时也复现**，随后随 `shim.js` 的改动消失——
> 说明它们是**当时**的真实缺口，非运行器假象。

**另注**：首轮与次轮的 `e2e-live` 对 `efficient` 键的观测不同（首轮 `efficient=500`，次轮
`efficient=NO_BACKEND`）。这是**服务端**状态变化（该键已知 degraded），两次均判 PASS，非本地回归。

---

## 4. t6 交付物复跑证据（5 支闸门，全部 EXIT=0）

| 脚本 | 结果 |
|---|---|
| `.ds-c-t6-scan.mjs` | **33 passed, 0 failed** — ALL ASSERTIONS PASSED |
| `.ds-c-t6-layout.mjs` | **17 passed, 0 failed** — ALL ASSERTIONS PASSED |
| `.ds-c-t6-instrument-check.mjs` | **3 passed, 0 failed** — INSTRUMENT VALIDATED |
| `.ds-c-t6-raw-literals.mjs` | 162 条字面量清单（人工判读） |
| `.ds-c-t6-gate.mjs` | **3 passed, 0 failed** — t6-1 保持预期 RED |

⚠️ **本机复跑陷阱（实测，两次踩到）**：
- `node xxx.mjs | Select-Object` → `ResourceUnavailable：拒绝访问`（piped-stdio 边界）
- `node xxx.mjs 2>&1` / `> file 2> file` → `StandardErrorEncoding is only supported when standard error is redirected`

二者均是 AGENTS.md §3/§8 记载的**沙箱管道/重定向边界**，**不是脚本失败**。
**复跑请裸调 `node <file>`，不加任何管道或重定向。**
