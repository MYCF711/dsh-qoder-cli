# v7 定稿 UX 审查报告（`lib/client.js`，主题适配后）

**审查对象**：`D:\DSH\qoder-dsh-plugin\lib\client.js` —— **1149 行 / 48,512 B / mtime 2026-09-20 07:36:28**
**方式**：**report-only，未改任何文件**
**尺子**：`docs/REFERENCE-codebuddy-accountcard.md` §6 checklist + `docs/REVIEW-t6-client-ux.md` §0 方法论
**主题数据来源**：`@deepseek-ai/dsh-client-ui-theme/lib/client.js`（亮 `body{}` @0–11332／暗 `body[data-ds-dark-theme]{}` @11332–15660）

**结论**：**1 个 high、3 个 medium、3 个 low**。**布局健壮性经实测通过**（§4）；主题一致性有 2 处需处理（§5）。

---

## §0 证据与仪器可信度

| 脚本 | 作用 | 结果 |
|---|---|---|
| `.ds-c-t6-scan.mjs` | 旧 t6 闸门（语法/文案/token/开关几何/死代码） | 37/4 —— 4 条红经复核**全部为真** |
| `.ds-c-v7-measure.mjs` | 对比度（**双主题**，token 实际解析） | 3/1 |
| `.ds-c-v7-layout2.mjs` | 长内容健壮性（ellipsis 三件套 + 有界父容器） | **6/0** |
| `.ds-c-v7-themeconsistency.mjs` | 硬编码语义色 × 双主题 | 4/0 |
| `.ds-c-v7-layout.mjs` | 47 处原生色值清单与分类 | 见 §2 |

### 🔴 本次我在**自己的测量仪器上**踩了 3 次坑，都已当场改正

这一节请**优先看**——它决定下面数字的可信度。

1. **主题解析错了 3 版**。初版把 `body{` 到 `body[data-ds-dark-theme]` 当成一个主题，得出
   `light=null / dark=#0f1115`（**明暗完全颠倒**）。根因：CSS 实际是
   `body{…statics…}` **紧接** `body[data-ds-dark-theme]{…statics…}`，
   **亮色 alias 在 @5000–8500、暗色 alias 在 @10000–13500**——我先按"第一个 dark 选择器"切，切错了块。
   **改正方式**：改用 `brand-primary` 的**两次出现**为界（@6002 亮 / @11332 暗），
   并用**决定性 sanity 检查**验伪（亮 `border-l4=#00000029`、暗 `brand=bluish-50` ✅）。
   > **若我直接采信初版数字，会报出整篇"暗色主题下白字看不见"的伪结论。**

2. **ellipsis 断言写错**：我要求 `overflow/textOverflow/whiteSpace` **同一行**，
   而代码里 `displayName` 的 `title:` 与 `style:` 是**相邻两行**（L435/L436）。
   → **假红**。已改为"相邻行"判定。**代码本身是对的。**

3. **旧 t6 闸门有 4 条红**，我逐条确认**不是闸门过期、而是真问题**（见 §1/§3）。

> **方法论提醒（给未来的自己）**：**"我的仪器报红" 与 "被审对象有问题" 在观测上同形**。
> 本次三条都靠"改完再看断言是否仍合理"分辨——**降级不是修 bug，是把断言写对**。

---

## §1 问题清单（按严重度）

### 🔴 HIGH

#### H1｜`--dsw-alias-label-onbrand` 不存在 ⇒ **暗色主题下签到按钮白字不可见**

- **位置**：`client.js:510`（签到按钮）、`client.js:1010`（另一处按钮）
  ```js
  background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  color: 'var(--dsw-alias-label-onbrand, #fff)',   // ← 该 token 全树不存在
  ```
- **实测**（`.ds-c-v7-measure.mjs`，双主题 + token 真实解析）：

  | 主题 | 按钮底 `brand-primary` | 文字（降级 `#fff`） | 对比度 |
  |---|---|---|---|
  | 亮 | `#0f1115`（近黑） | `#fff` | **18.90:1** ✅ |
  | **暗** | **`#f9fafb`（近白）** | `#fff` | **1.05:1** 🔴 |

- **根因**：`brand-primary` 在 DSH 里**不是蓝色**——亮色是近黑、暗色是近白（见 `DSH-UI-GLOSSARY.md` §1.7）。
  写死 `#fff` 在暗色下**白字白底**。
- **仪器自检**：该 token 在主题体**未声明**；**全树 9,906 个文件扫描：提及 0、声明 0**；
  正控 4 个真 token 全 YES、负控 3 个自造名全 NO ⇒ 否定结论可靠（`.ds-c-onbrand-instrument-check.mjs`）。
- **修复**：改用 **`--dsw-alias-label-primary-foreground`**（亮 `#fff`／暗 `#0f1115`，**正是为主色块上的文字设计**）。
- **备注**：这是本冲刺**第三次**同类缺陷（前两次 `--dsw-alias-fill-hover`、t6 关键词假绿）。
  **token 名打错不报错，只静默走降级色。**

### 🟠 MEDIUM

#### M1｜状态 pill 文字对比度不达标（**双主题均不达标**）

- **位置**：`client.js:528-529`（"当前" pill）、同型还有 `L737-738`、`L141`
  ```js
  background: 'rgba(46,160,67,0.14)',   // L528；L737 是 0.12 变体
  color: 'rgb(46,160,67)',
  ```
- **实测**（pill 底 = 绿叠在卡片底上；**两种 alpha 变体都测了**）：

  | 位置 / 变体 | 主题 | pill 底 | 文字 | 对比度 |
  |---|---|---|---|---|
  | L528 `0.14` | 亮 | `#e2f2e5` | `#2ea043` | **2.90:1** 🔴 |
  | L528 `0.14` | 暗 | `#253528` | `#2ea043` | **3.85:1** 🔴 |
  | L737 `0.12` | 亮 | `#e6f4e8` | `#2ea043` | **2.97:1** 🔴 |
  | L737 `0.12` | 暗 | `#243228` | `#2ea043` | **3.99:1** 🔴 |

  **WCAG AA 正文要求 4.5:1 ⇒ 四处全部不达标**（两种 alpha 都救不了，根因是**文字用了与底色同源的绿**）。
- **根因**：把**同一个绿**同时用作"底色的 14% 来源"与"文字色"——
  底色是白的 86% + 绿的 14%，与纯绿**太接近**。
- **建议**：文字改用**更深的绿**（如 `#1a7f37`），或直接用主题 token
  `--dsw-alias-state-success-primary` 的**深色变体**。实测 `#1a7f37` 在亮色 pill 上 = **4.37:1**（接近达标，仍需再深一点或用主题 token）。

#### M2｜硬编码绿色绕过了主题 token，暗色下比主题色**更差**

- **位置**：`L490`（在线圆点）、`L529`、`L738`、`L141` —— 全部硬编码 `rgb(46,160,67)`
- **实测**：主题自带 `--dsw-alias-state-success-primary` = **`#22c55e`**；我们用的是 **`#2ea043`**（两者不同）。

  | 主题 | 我们的绿 | 主题 token |
  |---|---|---|
  | 亮（vs `#fff`） | 3.37:1 | — |
  | **暗（vs `#232324`）** | **4.66:1** | **6.89:1** ← 更亮更清晰 |

- **建议**：改用 `var(--dsw-alias-state-success-primary, #2ea043)`，**保留现有值作降级**。
  这样暗色自动跟随主题（6.89:1），且**不改变亮色观感**。

#### M3｜死代码：3 个顶层 const 已无引用

| 位置 | 常量 | 状态 |
|---|---|---|
| `L25` | `const primitives = require('@deepseek-ai/dsh-client-ui-primitives')` | **t6-11 遗留，仍未修**（全文仅此 1 次出现） |
| `L32` | `const CATALOG_DUMP_PATH = '/plugins/…/catalog-dump'` | **新增死代码**（1 次出现） |
| `L36` | `const CATALOG_SHARE_ISSUE_URL = ''` | **新增死代码**（1 次出现；空串本身即"隐藏分享块"的设计，但路由/常量已成孤儿） |

- **连带影响（需 captain 决策）**：
  - `L25` 是**外部依赖**，且同时声明在 `package.json` 的 `dsh.client.external`——
    删它时应**一并评估该 external 条目**是否还需要（跨文件，超出本审查范围）。
  - `L32/L36` 说明**「通过 GitHub 分享目录」功能已被移除**，但 `/plugins/…/catalog-dump` 路由
    在 `web.js` 侧**可能仍注册着**（本审查未核 host 侧，**建议一并清理或确认保留**）。

### 🟡 LOW

#### L1｜次要文字 `opacity: 0.55` 在亮色下略低于 AA

- **位置**：`L443`（邮箱）、`L467`（"剩余 Credits" 标签）
- **实测**：亮色 `label-primary@55%` = `#7b7c7e` on `#fff` → **4.18:1**（AA 要 4.5）
  暗色 = **5.52:1** ✅
- **建议**：亮色下把 `opacity` 提到 `0.62` 左右，或改用 `--dsw-alias-label-secondary`（亮色 `#61666b` = 5.7:1）。

#### L2｜暗色主题下的**边框**：`border-l4` 用的是亮色值

- **发现**：`--dsw-alias-border-l4` 在暗色块中**被重新声明为 `#fff3`**，
  但**卡片多处的降级写法**是 `var(--dsw-alias-border-l4, rgba(128,128,128,0.4))` —— **降级不触发，安全**。
  ⚠️ 真正需要注意的是 `L1076`：`var(--dsw-alias-border-l3, rgba(128,128,128,0.35))` ——
  `border-l3` 暗色为 `#ffffff29`，**可用**。⇒ **此项无缺陷，仅记录已核对**。

#### L3｜47 处原生色值中 **12 处非降级、非语义**

- 清单见 `.ds-c-v7-layout.mjs` A 段输出。其中多为 **avatar 调色板**（L100–105，六个品牌色，**属有意设计，建议保留**）
  与**暖色徽章**（L138/L140/L141）。
- **建议**：这 12 处**登记为"设计色板"**而非"漏改"（captain 已在 `DOCS-PUBLIC-POLICY` 相关回合记录过登记意向）。
- **附实测**：暖色徽章 `L140`（`rgba(163,106,3,.16)` 底 + `rgb(154,103,0)` 字）对比度
  亮 **3.97:1** / 暗 **2.74:1** —— **双主题均低于 4.5:1**，建议与 M1 一并处理。

---

## §2 原生色值登记（captain 第 2 问）

**实测 47 处**原生色值，三分类：

| 类别 | 数量 | 处置 |
|---|---|---|
| **token 降级值**（`var(--dsw-…, <色>)` 的第二参） | 31 | ✅ **保留**——这是正确用法 |
| **语义色**（品牌蓝 `#4d6bfe`、成功绿、头像品牌六色） | 4 | ✅ **保留**（但见 M2：绿色建议改走 token） |
| **非降级、非语义的裸色** | 12 | ⚠️ **登记**（avatar 调色板 + 暖/冷徽章），见 L3 |

**"有没有漏改的中性色"**：**没有发现"应该走 token 却写死灰色"的中性色**。
所有灰色系（`rgba(128,128,128,…)`）**都出现在 `var()` 的降级位**，用法正确。✅

---

## §3 对比度（captain 第 3 问）

| 元素 | 亮色 | 暗色 | 判定 |
|---|---|---|---|
| **剩余 Credits 数字**（brand 色） | **18.90:1** | **15.03:1** | ✅ **双主题达标** |
| **签到按钮**（brand 实底 + 文字） | 18.90:1 | **1.05:1** | 🔴 **暗色不达标**（H1） |
| ↳ 同按钮 `opacity:.5`（禁用态） | 3.55:1 | 1.03:1 | 禁用态可放宽，但**暗色仍不可读** |
| **状态 pill**（"当前"） | **2.90:1** | **3.85:1** | 🔴 **双主题不达标**（M1） |
| 在线圆点（非文字 UI，门槛 3:1） | 3.37:1 | 4.66:1 | ✅ 达标（但见 M2） |
| 次要文字 `opacity:.55` | 4.18:1 | 5.52:1 | ⚠️ 亮色略低（L1） |
| 暖色徽章（promo） | 3.97:1 | 2.74:1 | ⚠️ 双主题偏低（L3 附） |

---

## §4 布局健壮性（captain 第 4 问）—— **实测通过 ✅**

`.ds-c-v7-layout2.mjs` **6/0 全绿**。逐项：

| 检查 | 实测 |
|---|---|
| 账号名 ellipsis 三件套 | ✅ `L436`：`overflow:hidden + textOverflow:ellipsis + whiteSpace:nowrap` |
| 邮箱 ellipsis 三件套 | ✅ `L443`：同上 |
| **有界父容器**（ellipsis 生效的前提） | ✅ **`L88`（及 L430 同名容器）：`{ minWidth: 0, flex: 1 }`** —— **关键**：flex 子元素**默认不收缩**，没有 `minWidth:0` 时 ellipsis **不会触发**。此处写法**正确**。 |
| Credits 数字列不被挤压 | ✅ `L455`：`flex:'none'` + `minWidth:'80px'` |
| Credits 数字自身不换行 | ✅ `L463`：`whiteSpace:'nowrap'`（`1,234,567` 不会从中间断开） |
| 右侧组（圆点+chip+签到+pill+箭头）单行 | ✅ `L479`：`flexWrap:'nowrap'` + `whiteSpace:'nowrap'` |

**结论**：**超长账号名/邮箱会 ellipsis，超大 Credits 数字不换行不挤压**。
⚠️ **一项无法离线验证**：`minWidth:'80px'` 对 `1,234,567`（9 字符 @14px 粗体）**是否够宽**——
需要浏览器实测。若不够，数字会**溢出 80px 容器**（因 `nowrap` + `flex:'none'`）。
**建议**：把 `minWidth` 提到 `'96px'` 或给该 div 加 `overflow:'hidden'`，二选一即可（**无需实测即可消除溢出风险**）。

---

## §5 主题一致性（captain 第 5 问）

| 元素 | 暗色表现 | 判定 |
|---|---|---|
| 卡片边框 `border-l4` | 暗色块重声明为 `#fff3`（白色 20%） | ✅ 可见 |
| hover 衬底 `interactive-bg-hover` | 亮 `#2631480f` / **暗 `#ffffff14`** | ✅ 双主题有定义 |
| 次要文字 `label-secondary` | 亮 `#61666b` / **暗 `#cfd3d6`** | ✅ 对比度足够 |
| **签到按钮文字** | 🔴 **白字 on 近白底 = 1.05:1** | **H1** |
| 状态 pill 文字 | 🟠 3.85:1 | **M1** |
| 在线圆点 | 4.66:1（主题 token 可达 6.89:1） | **M2** |

**结论**：暗色下**边框、hover、次要文字都清晰**；**唯一真正"看不清"的是 H1 的签到按钮**。

---

## §6 与 CodeBuddy 原版的差距（`REFERENCE-codebuddy-accountcard.md` §6 checklist）

| checklist 项 | 现状 | 判定 |
|---|---|---|
| A. 头像用 `avatarTone(name)` 确定性取色 | ✅ 已实现（哈希算法**逐值验证等价**） | pass |
| A. 头像文字色与底色**成对** | ✅ `label-primary` + alpha 0.14 淡底（**已按方案 ③ 修正**） | pass |
| B. 签到三态（true/false/undefined） | ⚠️ **签到功能未接入**（`disabled` + tooltip 说明"接口尚未接入"） | **不适用**（如实标注，非缺陷） |
| B. `status === "already"` 按成功处理 | ⚠️ 无对应实现（同上） | 不适用 |
| C. 资源条 `usableResources` 排序 | ✅ 有 `pctWidth(sub)`/`pctWidth(packs)` 双段进度条（L620–665） | pass |
| D. `mounted` ref 防卸载后 setState | **未查到**（本版未见 `mounted.current` 模式） | ⚠️ **见下** |
| D. 删除需确认 | 无删除入口（单账号场景） | 不适用 |
| E. 颜色走 token + 降级 | 46/47 正确；**H1 用了不存在的 token** | **H1** |

### 🟡 L4｜建议补 `mounted` ref（异步 setState 防护）

CodeBuddy 的 `AccountCard` 用 `const mounted = useRef(true)` + 卸载置 `false`，
所有 `await` 后的 `setState` 都判 `mounted.current`。
**本版未见该模式** ⇒ 若用户**在请求飞行中收起卡片/切走 tab**，`setState` 会落在已卸载组件上
（React 18 不再告警，但**仍是泄漏/竞态**）。
**建议**：在 `saveEnabledModels` / `setModelOptions` 等异步路径补 `mounted` 判据。
（**severity: low** —— 不导致崩溃，仅潜在竞态。）

---

## §7 建议修复顺序（给 captain）

| 顺序 | 项 | 改动量 | 理由 |
|---|---|---|---|
| 1 | **H1** 换 `label-primary-foreground` | 2 行（L510、L1010） | **暗色下按钮文字完全不可见**，用户可见缺陷 |
| 2 | **M1** pill 文字改深绿 | 3 处（L141/529/738） | 双主题不达标，WCAG 失败 |
| 3 | **M2** 绿色改走 `state-success-primary`（保留降级） | 4 处 | 暗色提亮至 6.89:1，亮色不变 |
| 4 | **M3** 删 3 个死常量 | 3 行 + 评估 `package.json` external | 消除死代码；`primitives` 是外部依赖需连带评估 |
| 5 | **L1 / L3 徽章** 提对比度 | 各 1–2 行 | 轻微不达标 |
| 6 | **L4** 补 `mounted` ref | ~6 行 | 竞态防护，非阻塞 |
| 7 | **§4 末** `minWidth` 80→96px | 1 行 | 消除大数字溢出**风险**（无需实测） |

**全部修复后请复跑**：
```
node D:\DSH\.ds-c-t6-scan.mjs          # 应无 FAIL
node D:\DSH\.ds-c-v7-measure.mjs       # 应 4/0
node D:\DSH\.ds-c-v7-layout2.mjs       # 应 6/0
node D:\DSH\.ds-c-v7-themeconsistency.mjs
```
⚠️ **裸调，勿加管道/重定向**（沙箱边界，非脚本失败）。

---

## §8 本报告边界

- **未在浏览器渲染**：所有对比度是**计算值**（WCAG 相对亮度公式 + token 真实解析），
  **不含**"好不好看"的主观判断。§4 末与 L1 的视觉观感**建议 GUI 实测一次**。
- **未核 host 侧**：M3 提到的 `/plugins/…/catalog-dump` 路由**未检查 `web.js`**（超本文范围）。
- **主题数据**取自 `dsh-client-ui-theme` 当前版本；**该包升级后 token 值可能变化**，
  引用数字前请复跑 `.ds-c-v7-measure.mjs`。
- 本次审查**未改任何文件**。
