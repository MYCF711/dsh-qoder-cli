# 团队协作 playbook —— 从 qoder-sprint 三轮冲刺沉淀

**来源**：qoder-sprint 团队（6 个 CodeBuddy agent × 2 模型），冲刺目标 = Qoder 插件 0.3.0。
**材料**：本仓库 `docs/` 下 9 份真实产出（见 §7 索引）+ ds-c 审查者本人当场复跑的验证。
**读者**：新加入团队的成员（尤其被分派 report-only 任务的审查/分析者）。
**用法**：动手前读 §0；接到任务时对照 §1；跑命令前看 §2；写报告前看 §3–§5。

> **本文所有案例均为真实发生**，附可复跑命令。凡我未能当场复跑的，明确标注"转述/未复核"。

---

## §0 三条元规则（其余章节都是它们的展开）

1. **没读到证据，不许下结论。** 命令没报错 ≠ 成功——**失败与静默同形**（都是"空输出 + 无异常"）。
2. **"我的检查器说没问题" 必须自己能证明这一点。** 未做过反向注入自检的"全绿"，不得写入结论。
3. **报红不等于回归。** 先问"是代码坏了，还是我的闸门过期了"。

---

## §1 任务分派

### 1.1 任务书必须写清的六件事

| 要素 | 为什么 | 真实案例 |
|---|---|---|
| **目标文件 / 模块** | 不定范围 ⇒ 交付物漂移 | t6 指明 `lib/client.js`；t7 指明 `refreshCatalog()` 段 |
| **禁止触碰的文件** | 防越界改代码 | t6「勿改文件，只报告——汉化由 captain 落实」；t5「scope forbids modifying `lib/`」 |
| **验收标准** | 否则"完成"无法判定 | t6：`node vm.Script` 解析通过 + 关键词零残留 + 不改业务逻辑 |
| **报告输出位置** | 否则产出无法被下游找到 | `docs/REVIEW-t6-client-ux.md`、`docs/analysis-cosy-material.md` |
| **是否 report-only** | 决定"发现缺陷时怎么办"（见 1.3） | t6/t7/t8/t9 均明确 report-only |
| **依赖前置** | 前置不存在时不该硬做（见 §4.1） | t13 依赖 t11/t12 |

**反例（真实）**：t12 在任务表里状态 `pending`、**attempt 0 —— 从未被认领**，
而 captain 是按"t12 已集成"来规划 t13 的。**产出物从未存在，却已被上游依赖。**

> **可执行判据**：收到"依赖已完成"的说法时，先 **grep 目标标识符**再动手。
> 例：t13 审查前 `grep -r readRemoteCatalog lib/` → **0 命中**，当场推翻前提。

### 1.2 复杂任务必须拆小步（这条有硬证据）

`docs/REALTIME-CATALOG-LOG.md` §46–52 记录了 qfmodel 免费档的分派实测：

> - 通道：`qodercli-1.1.58.exe -p --no-session-persistence --dangerously-skip-permissions -m qfmodel "<任务>"`
> - **必须 Start-Process + 文件重定向**（`&` 管道调用被沙箱 EPERM）
> - 任务书**必须禁止 agent 跑命令**（spawn cmd.exe → EPERM → CLI 崩溃）
> - **我的 tool 调用 abort 会连坐杀子进程**；login 类长驻进程必须用户终端跑

**结论**：简单任务（单文件、单目标、可一次读完）成功率 ~100%；
**多步写代码的任务会失败**。⇒ 能拆就拆成"读→写→验"三步。

### 1.3 report-only 与 implementation 必须分清

| 类型 | 产出 | 发现缺陷时**该做** | 案例 |
|---|---|---|---|
| **report-only**（审查/分析） | 报告文档 | **不越界修改**；写 **DEFECT 存档** + 通知 captain | t5 发现 CLI store 不可达 → 写 `DEFECT-cli-store-unreachable.md`，未改 `lib/` |
| **implementation** | 代码 + 测试 | 直接修 + 加回归测试 | t10 卡片 UI 打磨；t14 兼容性验证并修复 1 处死状态 |

**真实的价值链条**（t5→修复）：
1. t5 写测试时发现 `init()` 缺省参数导致 CLI 分支**永远不可达**；
2. 因 scope 禁改 `lib/`，**如实记录为 DEFECT 而非偷偷修**；
3. 存档里写明"修好后这两条测试**必须有意更新**，否则变红是**预期信号**"；
4. 4:15:19 修复落地 → 测试如期变红 → 被有意翻新为正向断言（`FIXED: init() with no argument uses the default WASM_PATH`）。

> **这条链条的关键**：缺陷存档**不是抱怨**，而是**给未来修的人留的准确说明书**——
> 包括"修完之后什么会变红、为什么那个红是对的"。

---

## §2 沙箱与环境边界

### 2.1 命令执行的五个真实陷阱

| # | 陷阱 | 现象 | 规避 |
|---|---|---|---|
| 1 | **agent 内 spawn 被拒** | `spawn cmd.exe → EPERM` → CLI 崩溃（`unhandledRejection`） | 任务书**明写「不要运行任何命令」** |
| 2 | **tool abort 连坐** | captain 的 tool 调用中断会**杀掉该调用里 Start-Process 的子进程** | 长驻进程（login）**必须由用户终端跑**，不放 agent tool 调用里 |
| 3 | **`&` 调用 vs Start-Process** | 原生 exe 管道 stdio 被拒 | 用 **Start-Process + 文件重定向** |
| 4 | **piped-stdio 边界** | `node x.mjs \| Select-Object` → `ResourceUnavailable：拒绝访问` | **裸调 `node <file>`**，不带管道 |
| 5 | **重定向同样被拒** | `node x.mjs 2>&1` / `> f 2> f` → `StandardErrorEncoding is only supported when standard error is redirected` | 同上；要留证据就在**脚本内**写文件 |

> ⚠️ **这五个的观测形态都是"命令看起来失败"**，极易被误判成**脚本有 bug**。
> **判据**：看到 `ResourceUnavailable` 就是沙箱边界，**不是**你的脚本错。
> 我在 t7/t8 两轮里**踩了同一个坑两次**才固化成本条。

### 2.2 编码

- **PowerShell 5.1 读无 BOM 的 `.ps1` 会 mojibake**（GBK 解码 UTF-8）；`pwsh` 7 则正常。
- **跨语言文本替换一律用 node 脚本**，不要用 `-replace` 硬塞中文。
- 写入含中文的文件后，**回读一次**确认没变成 `锟斤拷`。

### 2.3 一个反直觉的观测陷阱

`node -e "…"` 传内联脚本时，**引号会被截断在第 2 个单引号处**，报 "SyntaxError / Unexpected end of input" 且只显示第一个 token。
⇒ **一律写成 `.mjs` 文件再 `node <file>`**，不要内联。

---

## §3 审查纪律（本 playbook 的核心）

### 3.1 🔴「关键词全过 ≠ 无残留英文」

**案例（t6，历史案例——该缺陷现已修复，此处保留是因为它演示了假绿的成因）**：
合同要求检查残留英文，关键词表含 `Status/Account/Email/Token/Offered/backend/Login`。
**11 个关键词全部"零残留"** —— 但当时的 `client.js:206` 实际是：

```js
error === null ? '正在加载 Qoder 状态…' : `Qoder status unavailable: ${error}`
```

**它躲过关键词表的原因**：写的是**小写 `status`**，且是**模板内插**而非独立字面量。

> **现状（我当场核对）**：该行现已修复为 `Qoder 状态不可用：${error}`（`client.js:232`）。
> **正因如此，这条才更值得记**——它说明"关键词表全过"当时**真的掩盖了一处英文残留**；
> 若当时只跑关键词表就收工，这个缺陷会**一路带到发布**。

⇒ **教训**：关键词表**只证明它覆盖的那几个词**。看到"全过"，必须补一句
**"这张表没覆盖什么？"**，并**另跑一支无过滤的枚举**（见 3.2）。

### 3.2 🔴「看着绿、实则盲」的检查器

**案例（t6）**：我写了一个带白名单的过滤式扫描器。它**对着残留英文打印 `ALL ASSERTIONS PASSED`**。
根因：`String.replace(search, replacement)` 的 replacement 若为函数，
签名是 **`(match, p1, p2, …)`** —— 我按 `(match, key)` 写，导致分类**全部错位**、B 段**恒绿**。

**抓到它的方法（三步，建议照抄）**：
1. **注入式自检**：向内存副本注入已知反例（`'Account status unavailable'`）→ 断言扫描器**必须报红**；
   再注入一个**应被豁免**的样本（`console.warn('[tag] …')`）→ 断言**不**误报。
   > **尺子既能报红、也只在该红处红**，才算可用。
2. **无过滤反证**：另跑一支**不做任何分类**的脚本，列出全部 162 条候选，**人工逐条判读**。
   它新暴露出 2 条我的过滤版**没报**的（复核后确认是注释，不进入 DOM——说明豁免正确）。
3. **换一条不共享同一失效模式的通道**下结论。

> **原话留档（值得背下来）**：
> *"这一步把『我信我的过滤器』换成了『我用一条不共享同一失效模式的通道复核过』。"*

### 3.3 🔴 报红 ≠ 回归：先判定闸门是否过期（mtime 判因果）

**案例（t6→survey）**：`failover.test.mjs` 报 2 条红。**看着像回归。**

实测因果：
| 文件 | mtime | 内容 |
|---|---|---|
| `test/failover.test.mjs` | **4:13:12** | 写下"缺陷仍在"的断言 |
| `lib/qoder/wasm-credential-reader.js` | **4:15:19** | **后才**加上 `wasmPath = WASM_PATH` 默认值 |

⇒ **测试先写下、修复后落地** ⇒ 测试断言的是**过时行为**。
**报错文本本身就是佐证**：*"Missing expected rejection … **if this passes, the defect was fixed**"*。

> **判据**：红的时候，先 `Get-Item` 比较**测试文件与被测文件的 mtime**——
> **谁先谁后，直接决定"是回归还是测试过期"**，不需要读代码猜。

**同一现象的第二次出现（post-refactor）**：glm-c 把模型行从 `flex+wrap` 改成真 grid 后，
我的 t6 旧闸门**报 9 条 FAIL** —— 因为闸门断言的是**旧结构**（`display:'flex'`、`marginLeft:'auto'`）。
**代码是对的，闸门过期了。** 我特意让它报红以留证，再逐条对照确认"每条红都是有意变更"。

### 3.4 report-only 审查者的行为准则

- **不越界改 `lib/`**，即使你已看出修法（t5 的 DEFECT 存档是范本）。
- 交付**报告文档**，含：位置 / 严重度 / 建议修复 / **可复跑命令**。
- 发现 **lib/ 的真实缺陷** → 写 **DEFECT 存档** + **通知 captain**。
- **verdict 三态要说清**：
  - `pass` —— 验收标准满足 **且** 无 high 级发现；
  - `needs_revision` —— 有 fail 但不影响已交付功能；
  - `blocked` —— **前置不存在**（见 §4.1）。

---

## §4 依赖管理

### 4.1 前置不成立时标 `blocked`，不标 `failed`

**案例（t13，`docs/REVIEW-final-integration.md`）**：审查对象是"ds-b 的 `readRemoteCatalog` 集成"，
但该集成**从未落地**（t12 `pending`/attempt 0）。审查者的处理堪称范本：

> *"Writing findings about them now would be inventing an implementation and reviewing the invention."*
> *"This report deliberately carries **no `verdict: pass`**: the review's subject did not exist, so there is nothing to pass."*

且它**没有空手而归**——把当次能确证的**基线盘货**逐条列出（`readRemoteCatalog` 0 命中、
`catalog-reader.js` **不 import 任何 HTTP 客户端**、`buildCatalog` 仍是三层），
并把"t12 落地后按此顺序查什么"写成给下游的**可执行交接单**。

⇒ **判据**：
- **`failed`** = 审查对象存在但**不合格**；
- **`blocked`** = **审查对象不存在**（前提未满足）。
**二者不可混用**——把 blocked 写成 failed，会让下游以为"东西做了但坏了"。

### 4.2 「assigned 但从未认领」的静默缺口

**案例**：t12 在任务表里 `pending`、**attempt 0（从未被认领）**，而 t13 已按它存在来规划。
**产出物从未存在，却已被上游依赖。**

⇒ **可执行判据**：依赖宣称"完成"时，**grep 目标标识符**确认产出物真实存在。
我 t12 checklist 里就把这条写成了第 0 步：`readRemoteCatalog` 命中数 = 0 即说明未落地。

### 4.3 并行编辑同文件的竞态——"绿数有半衰期"

**案例**：两次 `run-all.mjs` 之间，**队友的修改落盘**，绿数从 **9/12 → 11/12**：

| 文件 | 首轮 | 次轮 | 期间被改(mtime) |
|---|---|---|---|
| `shim.test.mjs` | FAIL 16/2 | **PASS 18/0** | `lib/qoder/shim.js` 4:13:23 |
| `snapshot-refresh.test.mjs` | FAIL 2/1 | **PASS 3/0** | 该测试 4:15:34 新增 |
| `failover.test.mjs` | FAIL 29/2 | FAIL 29/2 | 未再改 |

⇒ **同一命令、相邻两次运行给出不同结果。** 因此：

> **任何"套件全绿"的结论都必须带时刻，引用前必须复跑。**
> **数字相同不代表口径相同**——同理，"我上次跑是绿的"不是证据。

---

## §5 产出质量

### 5.1 每条结论附可复现命令 + 当场执行的输出

- 反面：*"测试通过"*（不可复跑）
- 正面：*"`node test/run-all.mjs` → `files: 14, green: 14, failed: 0 ｜ assertions: 185 passed, 0 failed`，exit 0（2026-09-20，`client.js` mtime 5:17:36）"*

**并写明口径与时刻**（§4.3）。

### 5.2 🔴 偏移/行号引用必须回读自检

**做法**：`src.slice(offset, offset + needle.length) === needle` 逐条断言，而不是"我记得那附近是它"。

**两个已复核的真实先例**：
- **glm-a**：`docs/umid-analysis.md` 的 **29 处**偏移，配有 `t7-offset-regression.mjs`，
  我当场复跑 → **`29/29 offsets verified`**（**可复跑，非转述**）。
- **glm-b**：`docs/cosy-signature-analysis.md` 引用的 **31 处**偏移，我逐条回读复核 → **31/31 全中**。

> ⚠️ **但过程本身是一条教训**：复核中我最初判 **2 条"未命中"**，一度准备当成文档错误报告。
> 复核后发现是**我的 needle 写错了**——那两个偏移处是**函数名**（`async function To(` / `function uie(`），
> 而我把 `qoderServerRequest` / `X-Request-ID` 当成了该偏移处的文本：
> 前者是**导出别名**（绑定在别处，文本不在该偏移），后者在该偏移 **+219** 字符处。
> **改用函数名 needle 后 → 31/31 全中。**
>
> ⇒ **判据**：**"未命中"先怀疑自己的 needle，再怀疑被审对象。**
> 一个 grep 找不到东西时，先问"我搜的是名字还是别名？是文本还是绑定？"

### 5.3 仪器自检（把 §3.2 固化为例行步骤）

**每次交付前问三句**：
1. 我这个断言**能报红吗**？（注入反例实测）
2. 如果我的检查器**重建了**被测代码的控制流，**它忠实吗**？（逐字核对守卫/顺序/归属）
3. 我的过滤器/正则**覆盖了什么、漏了什么**？（列出被豁免的类别并说明理由）

**真实案例（t7）**：`.ds-c-t7-race.mjs` **重建了 `refreshCatalog` 的控制流**来数探测轮次。
**重建体一旦与真实代码漂移，它的"只跑 1 轮"什么都证明不了。**
故另写 `-instrument-check.mjs` 对着**真实 `index.js`** 逐条核验：守卫文本**逐字**一致、
`gateProbing = true` **在 spawn 之前**、`finally` 归属**内层 IIFE 而非外层 try**、
`refreshCatalog(` 全文**仅 1 次**。→ `RECONSTRUCTION FAITHFUL`。

**顺便留一个我犯过的错**（同类错误的第三次）：
该自检最初断言"1 处声明 + 1 处调用 = 2 个 `refreshCatalog(`"，实际只匹配到 1 个
（声明行是 `const refreshCatalog = async`，**不含括号**）→ **假红**。改断言后 7/0。
⇒ **我的检查器出错时，看起来和"代码有缺陷"完全同形。**

### 5.4 token / 常量校验要跨全树复核（排除假阴性）

**案例（post-refactor）**：`client.js:424` 用了 `--dsw-alias-fill-hover` 做 hover 衬底。
我的检查说"主题体未声明该 token"。

**在报告为缺陷前，我做完了三重验证**：
1. **正控**：`--dsw-alias-brand-primary` / `border-l4` / `bg-layer-3` / `label-primary` → 全 **YES**；
2. **负控**：自造名 `--dsw-alias-nonexistent-xyzzy` / `--dsw-totally-made-up` → 全 **NO**；
3. **跨全树复核**：扫 `@deepseek-ai` 下 **799 个 css/js**，提及该 token 数 = **0**
   （**排除"我的枚举只读了一个文件"这种假阴性**）。

确认后才报 → captain 当场修复为真实存在的 `--dsw-alias-interactive-bg-hover`。
我的闸门复跑随之转绿（D 段 4/4）。

> **口诀**：**"零匹配"必须先回答"我搜了哪份语料"**——搜错一侧得到的零，比没搜更危险，
> 因为它长得像证据。

---

## §6 一页速查：新成员接入清单

**接任务时**
- [ ] 任务书六要素齐了吗（§1.1）？缺"禁止触碰"或"验收标准"就回去问。
- [ ] 是 report-only 还是 implementation（§1.3）？决定发现缺陷后的动作。
- [ ] 依赖真的存在吗？**先 grep 目标标识符**（§4.2）。

**跑命令前**
- [ ] 在沙箱里吗？裸调 `node <file>`，**不加管道/重定向**（§2.1）。
- [ ] 要 spawn / 长驻进程吗？**别在 agent tool 调用里做**（§2.1 #1/#2）。

**下结论前**
- [ ] 每条结论有**可复跑命令 + 当场输出 + 时刻**吗（§5.1）？
- [ ] 我的断言**能报红**吗？做过注入自检吗（§5.3）？
- [ ] 我用的是**过滤版**还是**无过滤版**？过滤器覆盖了什么（§3.2）？
- [ ] 行号/偏移**回读**过吗？"未命中"是不是我的 needle 写错了（§5.2）？
- [ ] 看到红：是**回归**还是**闸门过期**？比过 mtime 吗（§3.3）？

**写报告时**
- [ ] verdict 是 `pass` / `needs_revision` / **`blocked`**？前置不存在就该 blocked（§4.1）。

---

## §7 材料索引（本文所有案例的出处）

| 文档 | 贡献的案例 |
|---|---|
| `docs/REALTIME-CATALOG-LOG.md` | §1.2 分派实测（qfmodel 免费档、Start-Process、tool abort 连坐） |
| `docs/MODEL-LIST-SIGNATURE-LOG.md` | 签名攻坚调查；§1.1 类"嫌疑清单"的迭代 |
| `docs/umid-analysis.md` | §5.2 **29/29 偏移机器校验**（`t7-offset-regression.mjs`，我复跑通过） |
| `docs/cosy-signature-analysis.md` | §5.2 **31 偏移回读**（我逐条复核 31/31） |
| `docs/experiment-endpoint-election.md` | §3.1 反面教材：**它推翻了自己前置报告的结论**（见下） |
| `docs/REVIEW-t6-client-ux.md` | §3.1 关键词假绿、§3.2 检查器恒绿、§3.3 mtime 判因果 |
| `docs/REVIEW-t7-refresh-catalog.md` | §5.3 仪器自检（重建体忠实性 + 我的假红） |
| `docs/DEFECT-cli-store-unreachable.md` | §1.3 report-only 的正确姿势（存档 + 交接） |
| `docs/REVIEW-final-integration.md` | §4.1 blocked vs failed 的范本 |

### 附：一条值得单独记住的团队行为——**允许结论被后来的实验推翻**

`docs/experiment-endpoint-election.md` §6 明确写了一张"修正表"，**公开推翻了自己前置报告**
（t8/t9 认为"端点选举缺失是 403 根因"，t11 实测**选举 host 仍 403** ⇒ 判定 **❌ 不是根因**）：

> | 项 | t8/t9 判定 | 本轮实测 | 最终裁定 |
> |---|---|---|---|
> | 端点选举缺失是 403 根因 | 「最可能」 | 选举复刻成功 + 选举 host 重签仍 403 | ❌ **不是根因** |

**这条行为的价值**：它把"我上次说错了"变成**可追溯的知识增量**，而不是悄悄改口。
⇒ **写报告时留一节"本结论可能被什么实验推翻"，并给可执行的判决实验**（t9 §4.2 就写了
"同 host、同凭据，仅换 cosyVersion 两个值各发一次"——**一次实验即可裁决**）。

> ⚠️ **诚实标注边界**：本人的 t8 分析（`docs/analysis-cosy-material.md`）曾判定
> "endpoint 传错是根因"，**已被 t11 实测部分修正**。本文以此为案例，
> 不是自夸，而是因为**它是本冲刺最有价值的团队行为之一**。

---

## §8 本文自身的边界

- 本文案例**全部来自本仓库 9 份真实文档**；凡我复跑过的（glm-a 29/29、glm-b 31/31、
  全量套件 14/14）已注明"当场复跑"，其余为**引用**。
- §2.1 的五条沙箱边界**是我本人在 t7/t8 两轮里实际踩到并记录**的，非推测。
- **本文不是规范**，是**案例集**。规范应沉淀进 `AGENTS.md`（每轮注入）或
  `.dsh/skills/`（可复用方法）；本文适合作为**新人 onboarding** 的阅读材料。

---

## §9 源码级测试的两个陷阱（ds-a，2026-09-20）

### 9.1 CRLF 行尾导致锚点永不匹配

`lib/client.js` 是 **CRLF** 行尾。源码级测试若用多行锚点（`\n` 拼接），
症状是 **`marker not found` 抛栈**——**看起来像测试坏了，实则是锚点永远匹配不上**。

**判据**：写 `client.js` 的源码级测试，**先在文件顶部归一化**：

```js
const source = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
```

### 9.2 作用域陷阱：全局 includes 会假绿

账号卡片 header 里有 **3 处 `flex:'none'`**（头像 / Credits 列 / 操作组）。
若断言写成 `source.includes("flex: 'none'")`，**只要有一处在就算通过**——头像被删掉也照样绿。

**判据**：断言必须**限定在目标元素自己的 style 块内**（scoped contract），
且**正向断言与变异用例共用同一个 contract 函数**——否则变异用例证明不了正向断言的那把尺子。

### 9.3 判据收窄：过宽的 ban 会变成假阳性源

初版语义色闸门写成"禁止所有 `state-success/warn/error` token"，误报了
`var(--dsw-alias-state-error-primary, #c33)` —— 那是**合法**的主题级错误色（错误文案用），
**不是**被误 token 化的语义色。

**判据**：闸门若报红，先问"**它报的这个东西，真的是缺陷吗？**"。
过宽的判据会在真正出问题时**失去可信度**（假阳性多了，真阳性也没人看）。
收窄到**具体字面量**（绿点 / 促销绿 / 不可用琥珀 / 已登录 pill 这 4 个），
并**在注释里写明"别改回去"及其原因**。