# CodeBuddy AccountCard 参考基准（供 glm-c 改造后的 UX 对比审查）

**用途**：captain 指派 ds-c 协助 glm-c 的「账号管理」tab 重构，交付后做**同标准 UX 审查**（对比 CodeBuddy 原版找差距）。
**本文件是**准备工作**：把 CodeBuddy 原版的**基准事实**固化下来**，待交付后直接对照。
**状态**：**等待 glm-c 交付**（本文件 writing 时 `client.js` = 840 行 mtime 6:10:00，改造进行中）。
**生成时刻**：2026-09-20。**未改任何文件**（report-only 准备）。

---

## 0. 一句话：captain 给的参考文件**并不自包含**

`D:\DSH\tmp\cb-account-section.js`（476 行）是**截取片段**，它**引用但未定义** 5 个关键符号。
我实测（正则计数）：

| 符号 | 在 476 行里 | 定义位置 |
|---|---|---|
| `avatarTone` | **引用 1 次、定义 0 次** | 截取片段**之外** |
| `ResourceBar` | **引用 1 次、定义 0 次** | 截取片段**之外** |
| `Chip` | **引用 0 次**（但被 `AccountCard` 用了） | 片段**之外** |
| `usableResources` | 定义 0 次 | 片段**之外** |
| `formatNumber$2` | 定义 0 次 | 片段**之外** |

**且该文件第 1 行是一个孤立的 `}`** —— 说明它是从更大的文件里**按行号切**出来的，起点不在函数边界。

⇒ **若只看 captain 给的那 476 行，`avatarTone` 与 `ResourceBar` 的实现细节是看不到的**。
我已从**完整 bundle** 补齐（见 §2、§3）。

> **完整 bundle 路径（只读）**：
> `C:\Users\<user>\AppData\Roaming\dsh-desktop\harness\profiles\web\node_modules\dsh-codebuddy-cli\lib\client.js`
> （**155,258 B**，mtime 2026-9-20 0:02:49）

---

## 1. `AccountCard` 的结构契约（476 行片段，逐段实测）

组件签名：`AccountCard({ account, onChanged, t })`。**五块结构**：

```
<article class=accountCard>
  <header class=accountCardHeader [accountCardActiveHeader if account.active]>
    <div class=accountAvatar style={background: avatarTone(name),
                                 color: var(--dsw-alias-label-primary)}>  ← 首字母大写
    <div style={minWidth:0, flex:1}>
      <h3 class=accountCardName title={name}>{name}
      <div class=accountCardChips>
        checkedInToday===true  ? <Chip tone="success">accountCardCheckedIn
        checkedInToday===false ? <Chip tone="neutral">accountCardNotCheckedIn
        expired                ? <Chip tone="danger">accountCardTokenExpired
    <div style={position:relative, flex:none}>
      <button class=refresh aria-label/title=accountCardMore  「⋯」  ← 二级菜单开关
      menuOpen && <div style={position:absolute, right:0, top:calc(100%+4px), zIndex:50,
                              minWidth:150, padding:4, borderRadius:10,
                              background:var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1,#fff)),
                              boxShadow:var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.16))}>
         [设为当前]  [签到(仅未签到)]  [删除(红色, window.confirm)]  [menuError]
  <section class=accountCardBody>
    creditError    ? <div color=label-error>accountCardCreditError: {creditError}
    credits===undef? <div color=label-secondary>accountCardCreditWaiting
    else           : 总额(formatNumber) + 包数 + 更新时间
                     「accountCardExpiringSoon」 → 前 2 条 ResourceBar
                     all.length>2 && <button class=accountCardViewAll>accountCardViewAll →
  <footer class=accountCardFooter>
    左: [checkInFeedback()] [未签到 && <button class=refresh disabled=busy>签到/签到中]
    右: account.active ? <span class=accountCardActivePill>accountCardActive
                       : <button class=refresh disabled=busy>accountCardSetActive
  resourcesOpen && <全量包对话框>   ← role=dialog, 遮罩 onClick 关闭, 内层 stopPropagation
```

### 1.1 关键交互约定（**审查时逐条对照**）

| 约定 | 实现 | 值得对照的点 |
|---|---|---|
| **异步竞态防护** | `const mounted = useRef(true)`；`useEffect` 卸载置 `false`；所有 `setState` 前判 `mounted.current` | glm-c 若直接 `await` 后 `setState`，**卸载后会警告/报错** |
| **busy 语义** | `run()` 与 `runCheckIn()` 各自 `setBusy(true)`，`finally` 复位 | 按钮 `disabled={busy}` |
| **错误显示位置** | **菜单内**（`menuError`），非全局 | |
| **菜单点完即关** | 每个菜单项 `onClick` 先 `setMenuOpen(false)` 再执行 | |
| **删除需确认** | `window.confirm(t("accountConfirmDelete"))` | |
| **签到成功反馈** | `checkInNote` → `checkInFeedback()`，**独立于菜单**，渲染在 footer 左侧 | 见 §4 |
| **签到按钮双入口** | 菜单里 + footer 里（`checkedInToday !== true` 才显示） | |
| **credits 三态** | `creditError` / `credits===undefined`（等待）/ 正常 | **不可合并**——三态各有文案 |

---

## 2. `avatarTone` 完整实现（**captain 点名要的**）

**取自完整 bundle @24253**：

```js
/** Avatar color tones (deterministic from the display name). */
const AVATAR_TONES = [
  "rgba(16, 185, 129, 0.14)",   // emerald
  "rgba(139, 92, 246, 0.14)",   // violet
  "rgba(14, 165, 233, 0.14)",   // sky
  "rgba(245, 158, 11, 0.14)",   // amber
  "rgba(244, 63, 94, 0.14)",    // rose
  "rgba(13, 148, 136, 0.14)"    // teal
];
function avatarTone(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = hash * 31 + name.charCodeAt(i) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
```

**审查要点**：
- **确定性**：同一 `name` 恒得同色（`hash*31 + charCode`，`>>>0` 保证 uint32）。
- **`>>> 0` 的优先级陷阱**：`hash * 31 + name.charCodeAt(i) >>> 0` 中 `>>>` 优先级**低于** `+`，
  所以等价于 `(hash*31 + code) >>> 0` —— **这是对的**；但写成 `hash * 31 + (code >>> 0)` 语义就不同。
  **glm-c 若转写，此处必须逐字核对。**
- **色调只用于背景，文字固定** `var(--dsw-alias-label-primary)` —— 保证**对比度不随色相变化**。
- **alpha 0.14 很淡**：是"浅色底 + 深色字"的设计，**不是实心彩色头像**。
- **6 色**：同账号列表 >6 时**必然撞色**，但 `name` 稳定 ⇒ 撞色也稳定。

---

## 3. `ResourceBar` 完整实现 + 积分包语义（**captain 点名要的**）

**取自完整 bundle @26195**：

```js
function ResourceBar({ resource, t }) {
  const percent = resource.total > 0
    ? Math.max(0, Math.min(100, resource.remain / resource.total * 100)) : 0;
  const expiryClass = resource.expired
    ? css.accountCardResourceExpiryExpired
    : resource.expiringSoon ? css.accountCardResourceExpirySoon : void 0;
  const expiryText = resource.expired ? t("accountCardExpired")
    : resource.expiringSoon ? t("accountCardExpiresIn7d")
    : resource.expireAtMs !== void 0 ? t("accountCardExpiresAt", { date: formatExpiry(...) })
    : t("accountCardLongLived");
  return (
    <div class=accountCardResource>
      <div class=accountCardResourceRow>
        <span class=accountCardResourceRemain>{formatNumber(remain)}
        <span class=accountCardResourceName title={packageName}>{packageName}
        <span class={cx(accountCardResourceExpiry, expiryClass)}>{expiryText}
      <div class=progressTrack role="progressbar"
           aria-valuemin=0 aria-valuemax=100 aria-valuenow={percent}
           aria-label={packageName}>
        <div class=progressFill style={{width: `${percent}%`}} />
```

### 3.1 `usableResources` —— 可见资源的筛选与排序（@25663）

```js
function usableResources(credits) {
  if (credits === void 0) return [];
  return credits.accounts
    .filter((a) => a.remain > 0)                       // ① 只留“还有余额”
    .map((account, index) => ({ account, index }))
    .sort((l, r) => {                                   // ② 按到期升序
      const le = l.account.expireAtMs ?? Number.POSITIVE_INFINITY;
      const re = r.account.expireAtMs ?? Number.POSITIVE_INFINITY;
      return le === re ? l.index - r.index : le - re;   // ③ 同到期稳定序
    })
    .map((e) => e.account);
}
```
**要点**：`?? Infinity` 把"长期有效"排到**最后**（而非最前）；同到期用**原索引**做稳定排序。

### 3.2 主卡与全量对话框的**两套渲染，语义不同**（易错点）

| | 主卡（前 2 条） | 全量对话框（`all`） |
|---|---|---|
| 组件 | `<ResourceBar>` | **内联展开**（不复用 ResourceBar） |
| 布局 | 横向行 + 进度条 | 左侧名称/到期，**右侧 `remain / total`** |
| 到期文案 | `formatExpiry` = `MM/DD` | `formatFullDate` = `YYYY/MM/DD` |
| 进度条 | 有 | 有 |
| `role`/aria | `progressbar` + `aria-valuenow` | **仅 progressTrack，无 role/aria** |

⇒ **同一份数据两套渲染 = CodeBuddy 自身的不一致**。
**审查 glm-c 时**：若他统一成一套，**属于改进而非缺陷**；若他两套都照抄，需指出 `role`/`aria` 缺失。

---

## 4. 签到状态与"绿点/红点"（captain 点名要的）

### 4.1 签到**不是**绿点/红点，而是 **`Chip` + 文字**

captain 描述为"签到状态、状态绿点/红点"。**实测有两套不同的视觉语言，勿混**：

**(a) 签到状态 → `Chip`（药丸 + 文字）**，三种 tone：

| 条件 | tone | 文案 key |
|---|---|---|
| `checkedInToday === true` | `success` | `accountCardCheckedIn` |
| `checkedInToday === false` | `neutral`（**不是 danger**） | `accountCardNotCheckedIn` |
| 令牌过期（`expiresAtMs < Date.now()`） | `danger` | `accountCardTokenExpired` |

> **注意**：`checkedInToday === undefined`（未知）**不渲染 Chip**——
> 即"未签到"与"状态未知"**视觉上不同**（`false` 渲染中性药丸，`undefined` 什么都不显示）。**这个三态极易被简化掉。**

**(b) 登录状态 → `statusDot`（真正的点）** —— 在**别的区块**（非 AccountCard）：
类名 `statusDot` / `statusDotSignedIn` / `statusDotSignedOut` / `statusDotError`（见 §5 类名表）。

### 4.2 `Chip` 的 tone 实现（@28444）—— **用了 `color-mix`**

```js
if (tone === "success") {
  style.background = "color-mix(in srgb, var(--dsw-alias-state-success-primary, #22a06b) 12%, transparent)";
  style.color      = "var(--dsw-alias-state-success-primary, #22a06b)";
} else if (tone === "warning") { ... #d97706 ... }
else if (tone === "danger") {
  style.background = "color-mix(in srgb, var(--dsw-alias-label-error) 12%, transparent)";
  style.color      = "var(--dsw-alias-label-error)";
} else {  // neutral
  style.background = "var(--dsw-alias-bg-layer-3)";
  style.color      = "var(--dsw-alias-label-secondary)";
}
```
**审查要点**：`color-mix()` 是较新的 CSS；**若目标浏览器不支持，背景会整条失效**（`background` 落空）。
`danger` 与 `success`/`warning` 的**降级策略不一致**：前者**无 fallback 颜色**（只给了 `var()` 无第二参）。

### 4.3 签到响应契约（`checkInFeedback`，片段 @82–92）

```js
if (checkInNote === void 0) return null;
if (checkInNote.status === "ok" || checkInNote.status === "already") → Ok 样式
return <span class=accountCardCheckInFail>{t("checkInFailed", {message: checkInNote.message})}</span>
```
⇒ **`status` 词表只有三值**：`"ok"` / `"already"` / 其它（失败）。
**"already" 视为成功**（幂等重签不报错）——**这是重要的语义**，审查时别把"已签到"当失败。

---

## 5. 参考素材：CodeBuddy 用到的类名与 i18n key（供逐条比对）

**AccountCard 相关的 CSS 类（子集，实测自 bundle）**：
`accountAvatar` `accountCard` `accountCardActiveHeader` `accountCardActivePill` `accountCardBody`
`accountCardCheckInFail` `accountCardCheckInOk` `accountCardChips` `accountCardCreditMeta`
`accountCardCreditRow` `accountCardCreditTotal` `accountCardCreditUpdated` `accountCardFooter`
`accountCardHeader` `accountCardName` `accountCardResource` `accountCardResourceExpiry`
`accountCardResourceExpiryExpired` `accountCardResourceExpirySoon` `accountCardResourceName`
`accountCardResourceRemain` `accountCardResourceRow` `accountCardSectionLabel` `accountCardViewAll`
`accountGrid` `progressTrack` `progressFill` `refresh` `statusDot` `statusDotError`
`statusDotSignedIn` `statusDotSignedOut` `tab` `tabActive` `tabBar`

**账号/签到相关 i18n key（实测 49 个，account/checkIn/credit/stats 类）**：
`accountCardActive` `accountCardAdd` `accountCardAllPackages` `accountCardCheckIn` `accountCardCheckedIn`
`accountCardCreditError` `accountCardCreditWaiting` `accountCardDelete` `accountCardExpired`
`accountCardExpiresAt` `accountCardExpiresIn7d` `accountCardExpiringSoon` `accountCardLongLived`
`accountCardMore` `accountCardNoAccounts` `accountCardNoCredit` `accountCardNotCheckedIn`
`accountCardPackageCount` `accountCardPackagesOf` `accountCardSetActive` `accountCardTokenExpired`
`accountCardUnnamed` `accountCardUpdatedAt` `accountCardUsed` `accountCardViewAll`
`accountConfirmDelete` `accountLoginFailed` `accountLoginOpen` `accountLoginPolling`
`accountLoginStarting` `accountLoginTimeout` `accountPanelHeading` `accountPanelHint`
`bulkCheckInButton` `bulkCheckInResult` `bulkCheckInRunning` `checkInFailed` `checkingIn`
`collapse` `creditEmpty` `creditLoading` `creditPackageUnknownSize` `requestFailed`
`tabAccounts` `tabCreditStats` …

> ⚠️ **CodeBuddy 用 `t()` 走 i18n**；而 Qoder 插件 `client.js` 目前是**硬编码中文**
> （见 `REVIEW-t6-client-ux.md` 的 t6-12：`inject` 声明了 `locale` 但从未使用）。

### ✅ 已裁定（captain，2026-09-20）：**沿用硬编码中文，不引 locale 依赖**

captain 的三条理由：① 用户群就是**中文用户**；② CodeBuddy 的 i18n 体系是为**多语言市场**准备的，我们不需要；
③ 引 locale 依赖 = **功能扩张**，增加维护负担。

⇒ **审查标准按「硬编码中文正确性」执行**：
- **不要求**逐字复刻 `t("accountCardXxx")` 结构，**也不得**引入 `locale` 依赖；
- 但**必须**覆盖 CodeBuddy 用到的**全部文案语义** —— 以上面 49 个 key 作为**语义清单逐条比对**：
  某个 key 承载的状态在中文版里**缺失或被合并**（例：把"未签到"与"状态未知"合并）**即为缺陷**；
- 用词可直接沿用现有卡片的中文风格（如「不可用」「令牌到期」）。

> **判据**：**i18n 是 CodeBuddy 的实现手段，不是它的功能。** 我们复刻的是**功能与信息量**，
> 不是它的**多语言基础设施**。审查时逐条问：**"这个 key 表达的信息，中文版有没有地方承载？"**

---

## 6. 待办：交付后的审查 checklist（预先写好，交付即可执行）

### 6.0 ✅ 已裁定并**已实测验证**的两项

**(a) 头像对比度 → 采用方案 ③ 的**架构**（Captain 2026-09-20 指令，**已由 glm-c 落地并复核通过**）**

**问题**：glm-c 曾把 `avatarTone` 换成 HSL 实心渐变 + `color: '#fff'`。
实测（WCAG 相对亮度，取渐变两端较差 stop）：

| 名字 | `#fff` on gradient |
|---|---|
| `demo-user`（示例账号） | **3.67:1** ❌ |
| `test` | **2.07:1** ❌ |
| `admin` | 2.11:1 ❌ |
| `Bob` | 3.82:1 ❌ |

全色相扫描：**211/360 个色相**低于 AA 4.5:1；26 个真实名字样本中 **16 个不达标**。

**✅ 落地结果（我当场复核，`lib/client.js` mtime 6:16:39 / 931 行）**：
glm-c 采用了方案 ③ 的**架构**（`alpha 0.14` 淡底 + `label-primary` 文字），
但**替换了自己的品牌配色**（非 CodeBuddy 六色）：

```js
const AVATAR_TONES = [
  'rgba(77,107,254,0.14)',  // brand blue
  'rgba(46,160,67,0.14)',   // green
  'rgba(163,106,3,0.14)',   // amber
  'rgba(136,78,206,0.14)',  // purple
  'rgba(31,143,166,0.14)',  // teal
  'rgba(200,60,60,0.14)',   // red
]
color: 'var(--dsw-alias-label-primary, inherit)'   // L429，不再是 #fff
```

> ⚠️ **因为配色不同，我先前基于 CodeBuddy 六色算出的数字不能直接搬用**——
> 我**按实际落地的调色板重算**（`D:\DSH\.ds-c-avatar-landed-check.mjs`）：

| 色调 | 亮主题 | 暗主题 |
|---|---|---|
| `rgba(77,107,254,.14)` | 15.85:1 | 16.51:1 |
| `rgba(46,160,67,.14)` | 16.21:1 | 16.04:1 |
| `rgba(163,106,3,.14)` | 15.83:1 | 16.62:1 |
| `rgba(136,78,206,.14)` | 15.61:1 | 16.86:1 |
| `rgba(31,143,166,.14)` | 16.04:1 | 16.24:1 |
| `rgba(200,60,60,.14)` | 15.43:1 | 17.05:1 |

⇒ **最差 15.43:1（原为 2.07:1），远超 AA 4.5:1**。**修复经实测确认安全。**
并已确认 `--dsw-alias-label-primary` **在主题体中有声明** ⇒ 该 `inherit` 兜底**实践中不会触发**。

> 🔴 **关键提醒（保留给未来改动者）**：**底色与文字色必须成对修改**。
> 本次缺陷的成因正是"改了背景语义（淡洗→实心）、没改文字色（仍白）"——
> 单改任一侧都会出错（淡底 + 白字同样不可读）。

**(b) i18n → 硬编码中文**（见 §5 末的裁定），审查按「中文文案语义完整性」执行。

---

**A. 结构对齐**
- [ ] 五块结构（header/body/footer/dialog）是否齐全？
- [ ] `accountAvatar` 是否用 **`avatarTone(name)` 确定性取色**（而非随机/固定色）？
- [ ] **`>>> 0` 表达式的优先级是否逐字正确**？（§2 陷阱）
- [ ] 头像文字是否用固定色 `label-primary`（保证对比度）？

**B. 状态三态（最易简化）**
- [ ] 签到是否保留 **true / false / undefined 三态**（undefined 不渲染）？
- [ ] 「未签到」是否为中性（**不是红**）？只有**令牌过期**才红？
- [ ] `status==="already"` 是否按**成功**处理？
- [ ] **绿点/红点（statusDot）** 与 **Chip** 是两套语言——是否被错误合并？

**C. 资源条**
- [ ] `usableResources` 是否 `remain>0` 过滤 + **到期升序** + `?? Infinity` 垫底？
- [ ] 主卡只显示 **前 2 条**、`>2` 才出「查看全部」？
- [ ] 进度条是否有 `role="progressbar"` + `aria-valuenow`（主卡有、CodeBuddy 对话框**没有**）？
- [ ] 百分比是否 `Math.max(0, Math.min(100, ...))` 钳制、`total=0` 时取 0（**避免 NaN/Infinity**）？

**D. 交互与健壮性**
- [ ] 是否有 **`mounted` ref 防护**（卸载后不 setState）？
- [ ] 每个菜单项是否**先关菜单再执行**？
- [ ] 删除是否**有确认**？
- [ ] `busy` 期间按钮是否 `disabled`？
- [ ] 错误是否显示在**菜单内**（而非全局吞掉）？

**E. 样式与主题**
- [ ] 所有颜色是否走 **`var(--dsw-alias-*, fallback)`** 且 **token 真实存在**？
      （本团队已有先例：`--dsw-alias-fill-hover` 不存在导致降级种子恒定生效——**须跨全树复核，排除假阴性**）
- [ ] `color-mix()` 是否有降级？
- [ ] 是否引入了未登记的**原生色值**？

**F. 与既有成果的一致性**
- [ ] 是否保持 `client-layout.test.mjs` 已钉住的 **t6-4/t6-5/t6-8** 不回归？
- [ ] 全量套件 `node test/run-all.mjs` 是否仍全绿？**记录时刻**（绿数有半衰期）。
- [ ] i18n 分歧点（§5 末）是否已确认预期？

---

## 7. 本文件边界

- §1/§4 的**行号与片段**均取自 captain 给的 476 行文件（逐段 `read`）。
- §2/§3/§4.2 的实现**取自完整 bundle**（路径见 §0），因 476 行片段**不含**这些定义（实测计数为证）。
- **未做**：没有在浏览器里渲染过任一版本 —— 视觉结论（如"色调是否好看"）**本文件不给**，待交付后按需实测。
- **未改任何文件**；本文件为**准备性留档**，审查报告将另出 `REVIEW-<tab>-account-section.md`。
