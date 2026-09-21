# t12 审查 checklist —— `readRemoteCatalog` 集成（第四层在线目录）

**用途**：t12 交付后，**直接按本清单逐条执行**，产出 `docs/REVIEW-t12-remote-tier.md`。
**方式**：**report-only**（审查者不改 `lib/`；发现缺陷写 DEFECT 存档 + 通知 captain）。
**本清单产出时 t12 尚未落地**：`readRemoteCatalog` 在 `lib/` 中 **0 命中**（实测），故本文是**前瞻性** checklist。
**基线锚点采集时刻**：2026-09-20（`lib/index.js` mtime 4:34:16、`models.js` 4:26:33、`catalog-reader.js` 3:09:15）

---

## 0. 使用方法（先读这段）

1. **先跑基线脚本**：`node D:\DSH\.ds-c-t12-baseline.mjs` —— 它锁定 pre-t12 状态并复核锚点行号。
   **若它报 `a remote tier already exists` / `readRemoteCatalog exists`，说明 t12 已落地**，
   此时它的"锚点行号"输出即为**新**行号，可直接用于定位。
2. **行号一律现读现用**：本清单里的 `L207`、`L161` 等是**采集时刻**的值。
   实测已发生漂移（`index.js` 的 `refreshCatalog` 从 L160 → **L161**、`resolveProbeToken` 从 L170 → **L171**，
   因队友在 4:26/4:34 追加了代码）。**引用任何行号前必须复读文件确认**。
3. 每一条检查 = **一个可执行断言**。给不出断言就说明该条不可审 —— 宁可标"无法验证"，不要给印象分。

---

## A. ds-a 三条既有建议（来自 `docs/REVIEW-final-integration.md` §4）

### A1. `configHome` 同源 —— 远程层的落盘必须与 tier-1 同目录 【severity: high】

> ds-a 原话（§2.4）：*"If it re-derives via `qoderConfigHome()` while tier 1 received an explicit
> `configHome` argument, the two tiers would read different directories in every test that injects
> a temp home — a silent split-brain."*

**检查点**：
- [ ] **A1a** 远程层的缓存路径是**由传入的 `configHome` 派生**，而**不是**内部再调 `qoderConfigHome()`。
      **断言**：`grep -n "qoderConfigHome()" lib/` 的结果中，**新增命中不得出现在远程读取模块内**；
      或在远程模块签名中显式形如 `readRemoteCatalog({ configHome })` 并向下透传。
- [ ] **A1b** `buildCatalog` 把**同一个** `configHome` 同时传给 tier-1 与远程层。
      **断言**：`models.js` 中 `readLocalCatalog(...)` 与 `readRemoteCatalog(...)` 的实参
      **取自同一个局部变量**（同一标识符），不得各自 `?? qoderConfigHome()`。
- [ ] **A1c** temp-home 场景下两层确指同一目录。
      **断言**：写一个探针，设 `QODER_CONFIG_DIR=<tmp>`、注入 `configHome=<tmp>`，
      断言远程层缓存写入路径 `startsWith(<tmp>)` **且** tier-1 读取路径 `startsWith(<tmp>)`。
      ⚠️ **注意陷阱**：`qoderConfigHome()` 是 `process.env.QODER_CONFIG_DIR ?? join(home,'.qoder')`，
      **env 变量优先于注入的 `home`**。所以只设 `configHome` 而不同时设 env 的探针**测不出**分歧——
      必须**两条路径各测一次**（env 设 / env 不设）。

> 🔴 **本项已有一段真实教训可直接复用**：t7-1 修复落地时，`index.js` **只给 `buildCatalog` 传了
> `configHome`，漏给 `resolveProbeToken`**，造成"目录与凭据可能不同源"——正是本条要防的形态。
> 实测：`configHome` 钉到 `D:\EXPLICIT\pinned` 时，探测凭据仍读 `C:\Users\<user>\.qoder`。
> **结论：凡"新增一个 configHome 消费者"，都要顺手 grep 全部既有消费者是否同源。**

### A2. 第四层插入位置 —— remote 必须在 `local-cache` **之前** 【severity: high】

> ds-a（§2.3）：第四层要插在 `local-cache` 之前（最新的 live 服务器目录优先），
> 且**三个既有 `source` 字面量必须保持稳定**——`test/models-catalog.test.mjs:229`
> 断言空 config 情形下 `catalog[0]?.source === 'bundled-snapshot'`。

**检查点**：
- [ ] **A2a** 解析顺序为 **remote → local-cache → bundled-snapshot → fallback**。
      **断言**：读 `buildCatalog` 函数体，按源码顺序列出 `source = '...'` 赋值序列，断言该序。
- [ ] **A2b** 新增 `source` 字面量（如 `'remote'`）**未改动既有三值**。
      **断言**：`['local-cache','bundled-snapshot','fallback']` 三者仍在，且拼写逐字未变。
- [ ] **A2c** `test/models-catalog.test.mjs` 的空 config 用例**仍然绿**。
      **断言**：`node test/models-catalog.test.mjs` 全绿。
      ⚠️ **重点**：若远程层在该测试环境里**能返回数据**，它会**抢占** tier-1 位次，
      使 `catalog[0].source === 'bundled-snapshot'` 断言失败。**测试红就是本项的真实告警**，
      不要靠改测试断言"修好"它——那会把"顺序错了"伪装成"测试过时"。
- [ ] **A2d** 远程层**失败时静默降级**，不得让 `buildCatalog` 抛错。
      **断言**：mock 远程读取抛异常 → `buildCatalog` 仍返回非空数组（"选择器永不为空"）。
      这是 t7 已实测的既有契约（空 config / 坏密文 / 坏路径三态均得 17 条）。

### A3. `initPromise` 清空分支 —— 失败必须可重试 【severity: high】

> ds-a（§2.5）：`catalog-reader.js` 的 `initAuthWasm` 是本仓库的 single-flight 范本，
> 关键在 `initPromise.catch(() => { initPromise = null })` —— **失败清空、成功短路**。
> 裸 `if (running) return; running = true` 会在一次网络错误后**永久楔死**该层，不再重探。

**检查点**：
- [ ] **A3a** 远程层的 single-flight 守卫**含失败清空分支**。
      **断言**：守卫对象上存在等价于 `.catch(() => { <guard> = null })` 的语句；
      或用 `finally` + 状态位实现同等语义。**仅有 `if (x) return; x = true` 即为不合格。**
- [ ] **A3b** 失败后**确实可重试**（不是只在源码里"看起来"有）。
      **断言（行为级，必做）**：让远程读取**第一次失败、第二次成功**，
      连续调用两次刷新，断言**第二次真的发生了新的网络尝试**（计数递增），而不是直接返回缓存的失败态。
      ⚠️ 只做静态阅读**不算**验证过 A3a——`catch(() => {x=null})` 写在错误的 promise 上同样通不过行为断言。
- [ ] **A3c** 成功路径**不重复请求**（single-flight 真的生效）。
      **断言**：并发发两次刷新，断言底层网络调用**仅 1 次**。
- [ ] **A3d** 远程层与 `refreshCatalog` 的 `gateProbing` 守卫**互不干扰**。
      **断言**：`refreshCatalog` 里原有的 `!gateCache && !gateProbing && entries.length > 0`
      守卫语义未被远程层改写；两者是**独立**的 single-flight（各自的标志位）。
      > 参考：t7 已实测 `gateProbing` 在同 tick 双调用下**只开 1 轮探测**，且 `stopped` 后
      > 由 `finally` 复位、**无永久卡死路径**。t12 不应削弱该性质。

---

## B. 我（ds-c）追加的审查维度

### B1. 失败必须**可见**（远程层最容易做成"静默消失"）【severity: medium】

t7 的实测教训：`dshHome` 假值时读写双双跳过 ⇒ 每次启动冷缓存、重探 ~5s，**且完全无提示**。
远程层是网络操作，**静默失败会让"目录永远停在快照版"看起来像正常**。

- [ ] **B1a** 远程层失败**有可观测信号**：至少一次 `logger?.warn` / `console.warn`，
      含**失败原因**（HTTP status / 异常类型）。
      **断言**：grep 远程层错误路径，存在含 status 或 error 的日志调用。
      > 反例（t7-t7-4 已记录）：`catch {}` 完全静默 —— 用户无法知道缓存为何没生效。
- [ ] **B1b** 失败**不写坏缓存**：不得把"空目录/错误对象"落盘覆盖掉上一份好缓存。
      **断言**：mock 返回空数组或抛错 → 断言磁盘上的**旧缓存内容未被覆盖**（或仍可加载出旧值）。
      这是 t7 已证过的 gate-cache 性质（`loadGateCache` 对 null/array/坏 JSON 一律返回 null 而非信任）。

### B2. 网络层边界：超时、大小、鉴权 【severity: medium】

- [ ] **B2a** 有**超时**，且超时后**降级**而非挂起。
      **断言**：grep 远程读取的实现，存在 `AbortSignal.timeout(...)` 或等价毫秒上限；
      并断言超时时 `buildCatalog` 仍返回非空。**无超时的网络调用 = 可能永久挂住启动链**。
      > 参考实测量级：`gate-cache.js` 探测 17 个模型 × 300ms 间隔 ≈ 5s；
      > bundle 侧 `QoderApi` 用 `AbortSignal.timeout(12e4)`（120s）。**t12 应有明确上限。**
- [ ] **B2b** 响应体有**大小上限**，防超大/无限流。
      **断言**：存在长度检查或流式读取上限。
- [ ] **B2c** 鉴权失败（401/403）与"无凭据"**被区分**，且都降级而非抛出。
      **断言**：三态（200 / 401 / 网络错）各 mock 一次，`buildCatalog` 均返回非空。
- [ ] **B2d** **不新增任何凭据持久化**：远程层不得把 token 写进缓存文件或日志。
      **断言**：grep 落盘内容构造处，字段白名单为目录字段（id/name/contextWindow/…），
      **无 token / uid / machineId / 账号标识**。
      > 参考：`catalogDump` 已确立脱敏白名单（`web.js`），远程层缓存应对齐同一标准。

### B3. 与既有 gate 探测的关系（两层都在改 `degraded`）【severity: medium】

`gateCache.results` 已会**覆盖**快照时代的 `degraded` 标注（`models.js` 的 `measured` 分支）。
远程层是**第三个**可能改写 `degraded` 的来源。

- [ ] **B3a** 三者优先级**有明确定义且被测试锁定**。
      **断言**：给出"远程层说是 X、gate 缓存说是 Y、快照说是 Z"时 `degraded` 的最终值，
      并有一条测试固定它。**未定义优先级 = 不确定行为。**
- [ ] **B3b** 远程层**不吞掉** gate 的逐账号测量。gate 是**本账号实测**，远程目录是**服务器声明**；
      二者冲突时"实测"应更有信息量。
      **断言**：同时提供两者，断言 `degraded` 反映**本账号实测**（或明确记录为何反之）。

### B4. 测试与回归 【severity: high】

- [ ] **B4a** 全量离线套件**绿**：`node test/run-all.mjs` → `RESULT: ALL FILES GREEN`。
      ⚠️ **必须记录时刻**：本冲刺已实测发生"同一命令相邻两次运行结果不同"
      （队友并行编辑）。**任何"套件全绿"结论都有半衰期**，引用前复跑。
- [ ] **B4b** 远程层**有独立单测**，且覆盖**失败路径**（不只 happy path）。
      **断言**：存在针对超时 / 非 2xx / 坏 JSON / 空目录的用例。
- [ ] **B4c** 既有 12 个测试文件**无回归**（尤其 `models-catalog.test.mjs`、`web.test.mjs`）。
- [ ] **B4d** **不改业务逻辑之外的东西**：t12 的 diff 若触及 `client.js` / `web.js` 的
      路由契约，需单独说明理由。

### B5. 审查者自身的仪器自检（**执行前先做**）【severity: high】

> 来自 t6/t7 的两次真实事故：**检查器出错时，看起来和"代码有缺陷"完全同形**。

- [ ] **B5a** 本次审查用到的**每个自动断言**，都要能**报红**。
      **做法**：注入一个已知反例（如把 `configHome` 传参改掉），确认断言**会**失败，再还原。
      未做注入自检的"全绿"**不得**写入报告结论。
- [ ] **B5b** 若检查器**重建了**被测代码的控制流（如数探测轮次），必须**逐条核验重建体忠实于源码**。
      > t7 先例：`-instrument-check.mjs` 逐字核对守卫文本、赋值顺序、`finally` 归属，
      > 并确认 `refreshCatalog(` 全文仅 1 次 —— **重建体一旦漂移，它的结论什么都证明不了**。
- [ ] **B5c** 正则/过滤器的**覆盖面**要自问一句："它检查了什么？"
      > t6 先例：过滤式扫描器因 `String.replace` 函数签名 `(match,p1,p2)` 误用，
      > **B 段恒绿**、对着残留英文打印 PASS。靠**无过滤版人工判读**才抓到。
- [ ] **B5d** 行号/偏移引用**回读自检**。
      **做法**：`src.slice(offset, offset+needle.length) === needle` 逐条断言。
      > 本次实测两份先例均通过：glm-a 的 **29/29**（`t7-offset-regression.mjs`，可复跑）、
      > glm-b 的 **31/31**（我按 `cosy-signature-analysis.md` 引用的偏移逐条复核，
      > 其中 2 条最初"未命中"是**我的 needle 写错了**（该处是函数名、而 `qoderServerRequest`
      > 是导出别名不在该偏移），改用函数名 needle 后 31/31 全中）。

---

## C. 结论模板（审查后填写）

```
## t12 审查结论

**审查对象**：<commit/diff 范围>  **审查时刻**：<当场>
**基线核对**：node .ds-c-t12-baseline.mjs → <输出摘要>
**仪器自检**：<注入反例清单与结果>

| 检查项 | 判定 | 证据（命令 + 当场输出） |
|---|---|---|
| A1 configHome 同源 | pass/fail/无法验证 | ... |
| A2 插入位置 | | |
| A3 失败可重试 | | |
| B1 失败可见 | | |
| B2 网络边界 | | |
| B3 degraded 优先级 | | |
| B4 测试与回归 | | |

**发现（按严重度）**：<id / 位置 / 问题 / 建议修复>
**verdict**：pass | needs_revision | reject   ← **不得在证据不足时给 pass**
```

**verdict 判据**：
- **pass**：A1–A3 全部 pass **且** B4a 全绿 **且** 无 high 级发现。
- **needs_revision**：存在 fail 项但不影响已交付功能（如 B1 缺日志）。
- **reject / blocked**：A1–A3 任一 fail ⇒ 第四层集成**不成立**，下游不得据此推进。
  > **blocked 的正确用法**（t13 先例，`docs/REVIEW-final-integration.md`）：
  > 前置未落地时应标 **blocked 而非 failed**，并**明确不主张 `verdict: pass`**——
  > "审查对象不存在"与"审查对象不合格"是两件事。

---

## D. 复跑命令

```
node D:\DSH\.ds-c-t12-baseline.mjs        # 基线 + 锚点行号
node D:\DSH\.ds-c-playbook-offset-check.mjs  # t9 偏移 31/31 复核（先例）
cd D:\DSH\qoder-dsh-plugin && node test/run-all.mjs   # 全量套件
```

⚠️ **本机实测的沙箱边界（会让人误判"脚本失败"）**：
- `node xxx.mjs | Select-Object` → `ResourceUnavailable：拒绝访问`
- `node xxx.mjs 2>&1` / `> f 2> f` → `StandardErrorEncoding is only supported when standard error is redirected`

二者均属 AGENTS.md §3/§8 的 **piped-stdio 边界，不是脚本失败**。
**复跑一律裸调 `node <file>`，不加管道与重定向。**

---

## E. 待 t12 落地后需确认的开放问题（无法预先断言）

1. 远程目录的**新鲜度语义**：拿到后是否落盘缓存？TTL 多少？与 gate-cache 的 24h TTL 是否一致？
2. 远程目录与 `catalog-snapshot.json` 的**关系**：远程成功后是否应**更新**随包快照？（涉及发版流程）
3. 远程层是否需要**凭据**？若需要，走哪条链（插件凭据 / CLI device-flow）？
   ⚠️ 若走 CLI 链，注意 `gate-cache.js` 的 `init()` 曾因缺省参数而**整条分支不可达**
   （`docs/DEFECT-cli-store-unreachable.md`，已于 4:15:19 修复）——
   **同类"静默不可达"必须用行为断言排除，不能靠读代码**。
4. `readRemoteCatalog` 的**模块位置**：`catalog-reader.js` 当前**不 import 任何 HTTP 客户端**
   （实测：仅 `node:fs/promises, node:fs, node:os, node:path, node:url`）。
   若远程读取放进该模块，**它必须新增 http(s) import**；若放进新模块，需说明理由。
