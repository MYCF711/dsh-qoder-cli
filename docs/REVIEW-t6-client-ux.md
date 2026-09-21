# t6 — `lib/client.js` UX 审查报告

**任务**：t6（kind=work，审查类）
**attempt_id**：`93a010b0-98fb-4c39-a93c-e9a5ee779787`
**审查对象**：`D:\DSH\qoder-dsh-plugin\lib\client.js`（585 行，22399 字节）
**审查时刻**：2026-09-20（本机当场执行；`client.js` LastWriteTime = 2026-9-20 4:03:57，审查期间未被修改）
**结论**：**报告式审查（report-only）**。未改动任何仓库文件——汉化由 captain 落实。

---

## 0. 证据与仪器可信度（先说清楚"我检查了什么"）

四支一次性取证脚本，全部落在工作区，**只读** `client.js`：

| 脚本 | 作用 | 结果 |
|---|---|---|
| `D:\DSH\.ds-c-t6-scan.mjs` | 语法解析 + DOM 文案扫描 + 关键词零残留 | **33 passed / 0 failed** |
| `D:\DSH\.ds-c-t6-layout.mjs` | 布局几何 + 死代码 + 颜色硬编码 | **17 passed / 0 failed** |
| `D:\DSH\.ds-c-t6-raw-literals.mjs` | **无过滤**列出全部 ASCII 字面量（162 条） | 人工分类，见 §1 |
| `D:\DSH\.ds-c-t6-instrument-check.mjs` | **仪器自检**：证明扫描器能报红 | **3 passed / 0 failed** |
| `D:\DSH\.ds-c-t6-gate.mjs` | t6-1 的红/绿闸门 | 红（设计如此） |

### 🔴 仪器自检（AGENTS.md §0/§8：零匹配只证明观测手段的覆盖范围）

带过滤器（`NON_COPY` 白名单）的扫描器**天然有"把所有东西都豁免掉"的风险**，一旦白名单过宽，
它会对着残留英文打印 `ALL ASSERTIONS PASSED`——**误报的闸门等于没有闸门**。据 §8④ 实测教训
（"闸门自测全过、落地即空转"），我先做了两件事：

1. **注入式验证**：向内存副本注入 `'Account status unavailable'` → 扫描器报红（L24 命中）；
   注入 `console.warn('[dsh-qoder-cli] …')` → **不**误报为 UI 文案。**尺子能报红，也只在该红处红。**
2. **无过滤反证**：另跑一支**不做任何分类**的脚本列出全部 162 条 ASCII 字面量，由人工逐条判读。
   它新暴露出 L12、L220 两条英文（我的过滤版**没报**）——复核后确认**二者均为注释**
   （`//` 与 `/* */`），不进入 DOM，过滤器的豁免**正确**。
   **这一步把"我信我的过滤器"换成了"我用一条不共享同一失效模式的通道复核过"。**

### ⚠️ 复核过程中我犯过并当场改正的 4 个仪器错误（留档，供 captain 判断证据强度）

| # | 错误 | 症状 | 处置 |
|---|---|---|---|
| 1 | v1 正则 `[一-鿿]` 范围**过宽**，把 CJK 标点「…」也当汉字 | 中文串被误判为 ASCII 残留，24 条假阳性 | 在声明中标注**已复核**，实为误报 |
| 2 | v2/v3 正则范围写反 | 中文**全部**被当 ASCII，报 8 条假阳性 | 重写为 `\u4e00-\u9fff` |
| 3 | v4 `isCopy` 用**函数式** `replace`，而 `String.replace` 的函数签名是 `(match, p1, p2)` | 分类全部错位，B 段**恒绿**（正是 §8④ 的空转形态） | 改为命令式 `matchAll` + 显式判定 |
| 4 | 闸门正则 `\}, 'Qoder'\)` 与实际 `} }, 'Qoder')` 不匹配 | 品牌标题检查**假红** | 改为 `includes` 字面匹配，与源码逐字比对 |

**第 3 条是本次最重要的方法学收获**：过滤式扫描器可以"看着绿、实则盲"。因此下文 §1 的结论
**不以过滤版为准，而以 §1 的无过滤原件为准**。

---

## 1. 残留英文 UI 文案（逐行）

### 1.1 唯一需要汉化的 DOM 文案 —— **t6-1**

| 字段 | 内容 |
|---|---|
| **位置** | `lib/client.js` **L542–546**（字符串本体在 **L545**） |
| **原文** | `'Sign in with the Qoder device flow and choose which models the pickers offer.'` |
| **渲染处** | `QoderPluginCard()` 折叠头部的描述行：`h('span', { style: { fontSize: '12px', opacity: 0.6 } }, <此串>)` |
| **严重度** | **high**（卡片折叠态**唯一**可见的描述文案；用户未展开卡片时看到的全部文字） |
| **建议中文** | `使用 Qoder 设备码登录，并选择模型选择器中要提供的模型。` |
| **备注** | `pickers` 直译为「选择器」；若 captain 希望更口语，可用「模型列表中要展示的模型」。 |

**闸门状态（`.ds-c-t6-gate.mjs`）**：RED，且**设计为保持 RED**，直到 captain 落实汉化。
`client.js` 改动后重跑即可翻绿；若该串位置漂移，脚本会报"expected L545, found L<n>"，提示复核。

### 1.2 `Qoder`（L541）—— **不译，非缺陷**

卡片标题 `h('span', { style: { fontSize: '14px', fontWeight: 600 } }, 'Qoder')`。
**品牌名，按中文 UI 惯例保留原文**。已用闸门显式锁定（若被误译，脚本报红提醒复核）。

### 1.3 关键词零残留核验

合同点名的关键词，在 **DOM 文案**中逐条为零：

| 关键词 | 结果 | 说明 |
|---|---|---|
| `Status` | ✅ 零 | L206 的 `` `Qoder status unavailable: ${error}` `` **是加载失败态**，见 §1.4 |
| `Account` / `Email` / `Token` | ✅ 零 | 中文标签为「账号」「邮箱」「令牌到期」（L213–215） |
| `Offered` | ✅ 零 | 已译「可选模型」（L338） |
| `backend` | ✅ 零 | 仅出现在**注释**与 `models.js` 的 `degraded` 注记中，不进前端 |
| `Login` | ✅ 零 | 按钮文案为「登录 Qoder」「重新登录（设备码）」「等待登录…」（L223–226） |

**另经确认**：`Qoder status unavailable`（L206）、`登录失败：`（L272）、`不可用`（L471）、
`通过 GitHub 分享目录`（L327）等渲染串**均已为中文**。

### 1.4 两项**边界项**——建议 captain 一并处理（超出"关键词表"但属同源问题）

**t6-2｜L206 加载失败态仍为英文（severity: medium）**

```js
error === null ? '正在加载 Qoder 状态…' : `Qoder status unavailable: ${error}`
```

同一行的三元分支**左中文、右英文**。关键词表里的 `Status` 之所以"零残留"，**只因为该串写的是小写
`status`**（表达式内插，非独立字面量）。**这是关键词表的覆盖面缺口，不是文件已汉化的证据**——
据 §8④「空集上的检查恒为通过」，我必须显式报告它。
建议：`` `Qoder 状态不可用：${error}` ``。

**t6-3｜L313 / L574 `console.*` 英文（severity: low）**

```js
console.error('[dsh-qoder-cli] catalog dump failed:', error)          // L313
console.error('[dsh-qoder-cli] client card failed to load …', error)  // L574
```

开发者日志，**不进 DOM**，中文环境终端同样可见。**建议保留英文**（便于上游 issue 检索）；
此处列出仅为闭合"零残留"口径，captain 可判为 wontfix。
（二者被我的过滤扫描器正确归类为 non-copy——这是**唯一**允许的英文豁免类别。）

---

## 2. Grid / 布局对齐

### 2.1 结论先行：**这里不是 grid，是 flex；且五列并不对齐**

`lib/client.js` **全文不含任何 CSS Grid**（无 `display: 'grid'`、无 `gridTemplateColumns`）。
模型行（L416–478）实际结构：

```
div  [display:flex, gap:8px, alignItems:center, flexWrap:wrap]   ← L421
├─ label [display:flex, flex:1, minWidth:140px]                  ← L425  ⟵ 唯一弹性单元格
│   ├─ span  iOS 开关（position:relative, 34×19）                  ← L431
│   ├─ span  model.name                                          ← L464
│   ├─ promoBadge   （条件，仅 promotion.active 且 badge.zh）      ← L465
│   ├─ span  「不可用」（条件，仅 model.degraded）                  ← L466-472
│   └─ priceBadge  [marginLeft:auto, flex:none]                  ← L473
├─ effortSelect  （条件：reasoningEfforts.length > 0）             ← L475
└─ ctxSelect     （条件：contextOptions.length > 1）               ← L476
```

**实测渲染顺序**：`开关 → 名称 → 促销徽章 → 不可用徽章 → 倍率 → 思考 → 上下文`
（由 `.ds-c-t6-layout.mjs` §H 从源码解析得出，非推测。）

### 2.2 三个真实对齐问题

**t6-4｜列不对齐——因名称格是唯一的弹性单元格（severity: medium）**

`label` 拥有 `flex: '1'`，两个 `<select>` 是**自然宽度**（`fontSize:11px; padding:1px 4px`，无 `width`）。
后果：**思考列、上下文列的起始 x 坐标随模型名长度逐行漂移**，视觉上无法成列。

建议三选一（**任选其一即对齐**）：
- **A（最小改动）**：给两个 `<select>` 加固定宽度，如 `width: '72px'`（思考）/ `width: '104px'`（上下文），
  名称格**保留** `flex:1`。列在**每一行内**即对齐。
- **B（真 grid）**：行容器改 `display:'grid'` +
  `gridTemplateColumns:'44px 1fr 72px 104px auto'`，并把徽章移出 `label`。
  需注意 `flexWrap:'wrap'` 在 grid 下无意义（应改用 `gridAutoFlow`），属**结构性改动**。
- **C（保守）**：仅给名称格加 `flex: '0 0 auto'` + 固定 `width:'200px'`，
  使**每行的列边界一致**；代价是长名被截断（需配 `overflow:hidden; textOverflow:ellipsis`）。

> 注：合同描述「五列：开关/名称/思考/上下文/倍率」。实测**该行最多 7 个渲染子节点**，
> 其中「促销徽章」「不可用徽章」为条件节点，且**倍率徽章位于 `label` 内部**、
> **思考与上下文在 `label` 之后**。若 captain 要真正实现"五列 grid"，须按 B 方案重排 DOM。

**t6-5｜缺少上下文选择器时行尾塌陷（severity: medium）**

`ctxSelect` 在 `contextOptions.length <= 1` 时为 `null`，该行**少一个子节点**（6 个而非 7 个）。
无占位元素保持列宽 → 单档模型与多档模型的**行尾位置不同**。
建议：null 分支改为渲染**等宽占位** `h('span', { style: { width: '104px', flex: 'none' } })`。
（与 t6-4 方案 A 配合效果最好。）

**t6-6｜`alignItems:'center'` 与换行徽章不一致（severity: low）**

`flexWrap:'wrap'` 生效、行折行时，`alignItems:'center'` 使折下去的那一段在**纵向上居中对齐整行**，
而 `.ds-c-t6-layout.mjs` 记录 `flex:'1'` 单元格**全卡仅 1 个**——折行后左列会独占整宽、
右侧两个 select 换到下一行左对齐，视觉上是"错落"而非"网格"。
建议：可接受（响应式正确行为）；若要求严格对齐，见 t6-4 方案 B。

---

## 3. iOS 开关样式

### 3.1 结论：**几何正确，默认色值正确；有 3 个真实缺陷（1 中 2 低）**

**实测量化（`.ds-c-t6-layout.mjs` §E，逐字比对源码）**：

| 量 | 值 | 校验 |
|---|---|---|
| 轨道 | `34px × 19px`，`borderRadius: '19px'` | 圆角 = 高度一半 ⇒ 真胶囊形 ✅ |
| 滑块 | `15px × 15px`，`borderRadius: '50%'`，`top: '2px'` | 圆形 ✅ |
| 位移 | `left: checked ? '17px' : '2px'` | **右间隙 = 34−(17+15) = 2px = 左间隙** ✅ **滑块居中，无溢出** |

**knob 位移无 bug**：17px 正是"轨道宽 − 滑块宽 − 左右各 2px"的结果，开/关两态**间隙对称**。
检查 `17 + 15 === 34 - 2` 通过。

**颜色变量降级链 ✅ 全部命中**（`.ds-c-t6-scan.mjs` §D）：

| token | DSH 主题体是否声明 | 降级种子 |
|---|---|---|
| `--dsw-alias-brand-primary` | ✅ | `#4d6bfe` |
| `--dsw-alias-border-l4` | ✅ | `rgba(128,128,128,0.4)` |
| `--dsw-alias-bg-layer-3` | ✅ | `transparent` |

> 核实方法：三重 token 均在 `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 的 `design_platform_css_default`
> 体内声明（`var(--dsw-static-neutral-bluish-1000)` = `#0f1115` 等）。**降级种子仅在 token 缺失时生效，
> 当前不会触发**——即不会出现"开关永远是蓝色"或"永远是灰色"。
> 若未来 token 被重命名，`#4d6bfe` 这一降级值会**静默接管**（视觉上仍像"正常蓝色"），
> 这是**刻意设计**，但值得 captain 知悉该静默面。

### 3.2 缺陷

**t6-7｜禁用态（`disabled`）无任何视觉反馈（severity: medium）**

`input` 的 `disabled` 绑定了 `busy || !status.selection_writable`（L435），但：
- `<input>` 本身 `opacity: 0`（L437），是不可见的 a11y 载体；
- 两个可见 `span`（轨道、滑块）**均未读取 `disabled`**。

后果：`busy`（正在保存）或 `selection_writable === false`（只读 profile）时，
开关**看起来完全可以点击**，用户点击却无反应 → 典型的"控件骗人"。
**对照实测证据**：DSH 官方 primitives 的 `Switch.module.css` 对禁用态**有**处理：
`.switch:disabled { cursor: default; opacity: 0.5 }`（已读取该文件确认）。

建议：计算 `const off = busy || !status.selection_writable`，据其设置
轨道 `opacity: off ? 0.5 : 1`、`cursor: off ? 'default' : 'pointer'`，与官方 primitives 对齐。

**t6-8｜`disabled` 时点击热区仍为 `cursor: 'pointer'`（severity: low）**

L437 硬编码 `cursor: 'pointer'`，与 t6-7 同源；修 t6-7 时一并处理。

**t6-9｜同一开关在 `label` 内，而 `label` 会吞掉整行的点击（severity: low）**

L424 的 `<label>` 未给 `htmlFor`，仅**包裹**开关与名称。HTML 语义下，
**点击名称文字会切换复选框**。对"选择是否提供该模型"而言**通常是想要的行为**，
但与 `disabled` 叠加时（t6-7）会放大困惑：用户点名称文字无反应且**无视觉线索**。
建议：确认该行为是**有意**的（若是，保留）；否则把名称移出 `label`。

**t6-10｜键盘可见焦点被 `pointerEvents:'none'` 间接削弱（severity: low）**

轨道与滑块均设 `pointerEvents: 'none'`（L443、L460，**正确**，保证点击落到 input），
但**轨道没有 `:focus-visible` 描边**。真实 `<input>` 有默认 outline 却 `opacity: 0`，
浏览器仍会画聚焦环（因 `inset:0` 覆盖整块轨道）——**通常可见**。
⚠️ 我**无法在本环境实际渲染验证**（无浏览器），故降级为 low 并**标注为未实测**：
建议 captain 在 Web GUI 中用 Tab 键实测一次；官方 `Switch.module.css` 有
`:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary) }` 可作参照。

---

## 4. 未使用变量 / 死代码

### 4.1 确证死代码

**t6-11｜`const primitives` 引入后从未使用（severity: medium，可安全删除）**

```js
// L25
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
```

全文 `primitives` 仅出现 **2 次**（L25 的声明 + 一处；`.ds-c-t6-layout.mjs` §J 精确计数），
**无任何调用点**。这是**真正的死代码**——且是**外部依赖**。

**连带影响（值得 captain 注意）**：该依赖同时声明在 `package.json`
`dsh.client.external` 中。空 require 会让**浏览器侧加载该模块**却从不使用它。
若删除 L25，应**同步评估** `package.json` 的 `external` 条目是否仍需要
（若该包不再被引用，可移除以减小客户端加载面）——**这属于跨文件改动，超出 t6 的 inScope**，
故仅作提示，由 captain 决定。

**t6-12｜`inject` 声明了 `locale` 但卡片从未读取（severity: low）**

```js
const inject = ['slots', 'locale']   // L558
```

`locale` 全文仅出现 **1 次**（就是这行声明）。卡片**不复用 DSH 的 locale 服务**，
所有文案为**硬编码中文**。

**这与本任务高度相关**：若卡片改走 `ctx.locale`，则汉化无需硬编码，且可支持英文界面用户。
但采用它意味着**引入 i18n 机制**，属**功能改动**而非文案改动——
**超出 t6 的"仅文案与样式"边界**，故只报告不实施。
**决策点交 captain**：本次 0.3.0 冲刺若只求中文界面，可保持硬编码（但应删除无用的 `locale` 注入）；
若求国际化，`locale` 注入应被真正使用。

**t6-13｜`CATALOG_SHARE_ISSUE_URL` 仍是占位符（severity: medium）**

```js
// L36
const CATALOG_SHARE_ISSUE_URL = 'https://github.com/YOUR-NAME/dsh-qoder-cli/issues/new?…'
```

`YOUR-NAME` **未被替换**，而该常量：
- 因**非空字符串**，使 `if (status.signed_in && CATALOG_SHARE_ISSUE_URL)`（L280）**恒真**；
- 于是**已登录用户一定看到**「通过 GitHub 分享目录」按钮；
- 点击会 `window.open` 到一个 **404 的 GitHub 地址**（`YOUR-NAME` 账号不存在）。

代码注释 L35 自述 *"Empty string hides the whole block. Replace YOUR-NAME when the upstream
repo exists."* ——**设计意图是空串隐藏**，而当前值**既非空也未替换**，处于**第三种未定义的中间态**。
建议：发布前**二选一**——填真实仓库地址，**或**改为 `''` 以隐藏该块。
（这是**行为可见**的缺陷，非纯样式；但修复只需改一个字符串，且是"文案/配置"性质，故列于此。）

### 4.2 精确排除的项（**不是**死代码，避免 captain 误删）

`lib/client.js` 中全部 14 个顶层 `const` **均被引用 ≥2 次**（`scan` §F 逐条验证）：
`module`、`exports`、`react`、`primitives`（**除它，见 t6-11**）、6 个 `*_PATH`、
`CATALOG_SHARE_ISSUE_URL`、`h`、`name`、`inject`。
**无其它未使用变量。**

另确证**服务端生产但前端未读**的字段（非死代码，属正常的多消费者契约，
`buildStatus()` 同时服务其它调用方）：`status.error`、`status.provider`。
**建议不动**——删除会破坏 `web.js` 的契约。

---

## 5. 未改动业务逻辑核验

| 检查 | 结果 |
|---|---|
| `lib/client.js` 是否被本次审查修改 | ❌ **未修改**（LastWriteTime 保持 2026-9-20 4:03:57；证据脚本均在 `D:\DSH\` 顶部，不在仓库内） |
| 是否有语法错误 | ✅ `new vm.Script(source)` 解析通过 |
| 是否触碰请求路径 / 状态字段 / 保存逻辑 | ❌ 未触碰 |
| 六条 host 路由与 `constants.js` 契约 | ✅ 前端 6 个 `*_PATH` 与 `web.js` L368–373 注册的 6 条 `exact` 路由**逐条对应** |

---

## 6. 问题清单（按严重度排序）

| ID | 位置 | 严重度 | 问题 | 建议修复 |
|---|---|---|---|---|
| **t6-1** | L545 | **high** | 卡片折叠态描述仍为英文，是**唯一**待汉化 DOM 文案 | 译为「使用 Qoder 设备码登录，并选择模型选择器中要提供的模型。」 |
| **t6-4** | L421–477 | medium | 五列不对齐：名称格独占 `flex:1`，两 select 为自然宽度 ⇒ 列起始 x 逐行漂移 | 给两 select 加固定宽度（方案 A），或改 `display:grid`（方案 B） |
| **t6-7** | L432–462 | medium | 开关禁用态**零视觉反馈**，但看起来可点 | 据 `busy\|\|!selection_writable` 设 `opacity:0.5` + `cursor:default`（对齐官方 primitives） |
| **t6-5** | L382–396 | medium | 单档模型无上下文选择器，行尾少一节点 ⇒ 行不对齐 | null 分支渲染等宽占位 `span` |
| **t6-11** | L25 | medium | `const primitives` **引入未用**（死代码，且是外部依赖） | 删除 L25；**并评估** `package.json` 的 `external` 条目 |
| **t6-13** | L36 / L280 | medium | `YOUR-NAME` 占位符未替换 ⇒ 按钮恒显示并指向 404 | 填真实仓库地址，**或**改 `''` 隐藏该块 |
| **t6-2** | L206 | medium | 加载失败态英文 `` `Qoder status unavailable: ${error}` ``（关键词表因小写 `status` 漏检） | 改为 `` `Qoder 状态不可用：${error}` `` |
| **t6-9** | L424 | low | `<label>` 包裹导致点名称文字即切换开关（`disabled` 时无反馈，放大 t6-7） | 确认是否有意；否则名称移出 `label` |
| **t6-8** | L437 | low | `disabled` 时 `cursor` 仍为 `pointer` | 同 t6-7 一并修复 |
| **t6-10** | L431–462 | low | 无 `:focus-visible` 描边；**未实测**，需浏览器验证 | 参照官方 `Switch.module.css` 加聚焦环 |
| **t6-6** | L421 | low | 折行时 `alignItems:'center'` 造成错落 | 可接受；严格对齐见 t6-4 方案 B |
| **t6-12** | L558 | low | `inject` 含 `locale` 但从未使用，文案全硬编码 | 删除该注入，**或**真正接入 locale（后者属功能改动，超 inScope） |
| **t6-3** | L313, L574 | low | `console.*` 英文日志 | **建议保留**（不进 DOM，便于检索）；可判 wontfix |

**另记（非缺陷，供决策）**：
- L541 `'Qoder'` 品牌名**不译**（已锁闸门）；
- 促销徽章绿色 `rgb(46,160,67)` 为**硬编码**，绕过了主题里已有的
  `--dsw-alias-state-success-primary`（暗色主题下可能对比度不足）；
- 错误红 `#c33` **硬编码 2 处**（L271、L483），同样绕过主题；
- 主题 token 降级种子当前**不会触发**，但若 token 被重命名会**静默接管**。

---

## 7. 给 captain 的落地建议（按修复成本排序）

1. **t6-1**（1 行字符串）+ **t6-2**（1 行模板串）——**本轮汉化收尾**，改完跑 `.ds-c-t6-gate.mjs` 应变绿。
2. **t6-11**（删 1 行死代码）+ **t6-13**（改 1 个常量）——**低风险高收益**，消除死依赖与 404 按钮。
3. **t6-7 / t6-8**（约 4 行样式）——修正"禁用态无处可辨"的真 UX 缺陷。
4. **t6-4 / t6-5**——需方案选择；**若本轮只求"不错位"，选方案 A**（每行内对齐，改动最小）。
5. **t6-12**——**决策点**：删无用注入（1 行），或接入 locale（功能改动，建议排 0.4.0）。
6. **t6-3**——建议 wontfix。

**全部 gating 脚本可用下列命令一次性复跑**（一条一条执行，**不要**用管道串联——见下）：

```
node D:\DSH\.ds-c-t6-scan.mjs
node D:\DSH\.ds-c-t6-layout.mjs
node D:\DSH\.ds-c-t6-raw-literals.mjs
node D:\DSH\.ds-c-t6-instrument-check.mjs
node D:\DSH\.ds-c-t6-gate.mjs
```

⚠️ **复跑注意（本机实测）**：`node … | Select-Object` 会被沙箱拒绝
（`ResourceUnavailable: 程序'node.cmd'运行失败：拒绝访问`，属 AGENTS.md §3/§8 记载的
**piped-stdio 边界**，**不是**脚本失败）。**请勿加管道**；要过滤输出请先重定向到文件再读。
