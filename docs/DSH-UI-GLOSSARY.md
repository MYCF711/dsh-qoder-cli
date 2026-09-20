# DSH UI 术语速查手册

**用途**：把"按钮/卡片/开关"这类口语，换成 **DSH 官方术语**。captain 与 agent 讨论 UI 时用同一套词，减少"我说的是这个、你改的是那个"。
**证据来源**（全部**当场读取源码**，非记忆）：
- **主题体**：`D:\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-client-ui-theme\lib\client.js`
- **primitives**：`…\@deepseek-ai\dsh-client-ui-primitives\lib\index.js`（`@0.1.5-rc.2`）
- **我们的插件**：`D:\DSH\qoder-dsh-plugin\lib\client.js`
**实测规模**：主题体共 **6 个 inline-CSS 块**，合计声明 **374 个 `--dsw-*` 变量**
（主块 `design_platform_css_default` 一个就占 357 个；其余分布在
`base_css` / `corner_shape_css` / `scrollbar_css` / `gradient_shadow_text_css` / `shiki_css`）；
primitives 导出 **123 个名字**（含 30+ 图标）。
**复核纪律**：§6 列出**每一条的自检结果**。所有 token 名**逐个回读源码确认存在**。

---

## §0 先记住三条规则

1. **口语说"按钮"，官方叫 `Button`**；但**我们说"开关"，官方叫 `Switch`** —— 名字**不完全对应中文习惯**，见 §2。
2. **所有颜色走 token，不写死值。** 写法固定为 `var(--dsw-alias-xxx, <降级色>)`。
   **降级色只在 token 缺失时生效**；若 token 名打错，**降级色会静默接管**（本团队已踩过两次，见 §5 的两个真实案例）。
3. **token 分四层**：`--dsw-static-*`（原始色板）→ `--dsw-alias-*`（语义）→ `--dsw-specific-*`（场景）→ `--dsw-elevation-*`/`--dsw-shadow-*`（高度）。
   **业务代码只用 `alias` 与 `specific`**，不要直接用 `static`。

---

## §1 色彩 token 体系（`--dsw-alias-*`）

### 1.0 主题切换的**实际选择器**（实测）

| 主题 | 选择器 | 指纹 |
|---|---|---|
| 亮色 | **`body{…}`**（无属性） | 边框是**黑色**半透明：`--dsw-alias-border-l4: #00000029` |
| 暗色 | **`body[data-ds-dark-theme]{…}`** | 边框是**白色**半透明：`--dsw-alias-border-l4: #fff3` |

> **这意味着**：用 token 写的颜色**自动跟随主题**；写死 hex 则**不会**。这就是为什么必须走 token。

### 1.1 `label` —— 文字色（**最常用**）

| Token | 用途 | 亮色值 | 暗色值 |
|---|---|---|---|
| `--dsw-alias-label-primary` | **主文字**（正文、标题） | `#0f1115` | `#f9fafb` |
| `--dsw-alias-label-secondary` | **次级文字**（说明、副标题） | `#61666b` | `#cfd3d6` |
| `--dsw-alias-label-tertiary` | **三级文字**（更淡的提示） | `#81858c` | `#adb2b8` |
| `--dsw-alias-label-caption` | **图注**（最小号） | `var(--dsw-static-neutral-bluish-400)` | 同左 |
| `--dsw-alias-label-dimmed` | **变暗/禁用态文字** | `var(--dsw-static-neutral-bluish-200)` | 同左 |
| `--dsw-alias-label-primary-foreground` | **主色块上的文字**（如主按钮上的白字） | `#fff` | `#0f1115` |
| `--dsw-alias-label-primary-inverted` | 反色文字 | `#fff` | 同左 |
| `--dsw-alias-label-primary-bluish` | 蓝色系主文字 | `var(--dsw-static-blue-900)` | 同左 |
| `--dsw-alias-label-primary-dimmed` | 主文字变暗版 | `var(--dsw-static-neutral-bluish-950)` | 同左 |
| `--dsw-alias-link` | **链接色** | `var(--dsw-static-deepseek-500)` | 同左 |

> 🗣️ **口语 → 官方**：
> "灰字/说明文字" → `--dsw-alias-label-secondary`
> "黑字/正文" → `--dsw-alias-label-primary`
> "按钮上的字" → `--dsw-alias-label-primary-foreground`（**不是** `label-primary`！）

### 1.2 `bg` —— 背景色

| Token | 用途 | 亮色值 | 暗色值 |
|---|---|---|---|
| `--dsw-alias-bg-base` | **页面底色** | `#fff` | `var(--dsw-static-neutral-bluish-950)` |
| `--dsw-alias-bg-layer-1` | **第一层容器**（卡片） | `#fff` | `#232324` |
| `--dsw-alias-bg-layer-2` | **第二层**（浮层内再分层） | `#fff` | `#2c2c2e` |
| `--dsw-alias-bg-layer-3` | **第三层**（菜单/弹窗底） | `#fff` | `#353638` |
| `--dsw-alias-bg-overlay` | 遮罩层底色 | `var(--dsw-static-neutral-bluish-150)` | `bluish-700` |
| `--dsw-alias-bg-mask-1/2/3` | 半透明遮罩（浅→深） | `#0000003d / 1f / 7a` | `#00000080 / #0003 / 7a` |
| `--dsw-alias-bg-skeleton` | 骨架屏底 | `#0000000a` | `#ffffff14` |
| `--dsw-alias-bg-module-platform` | 平台模块底 | `bluish-60` | `bluish-800` |

> 🗣️ **口语 → 官方**：
> "卡片背景" → `--dsw-alias-bg-layer-1`（**层级越高越"靠上"**，不是"越浅"）
> "弹窗/菜单底" → `--dsw-alias-bg-layer-3`

### 1.3 `border` —— 描边（**注意 l1→l4 是越深越明显**）

| Token | 用途 | 亮色值 | 暗色值 |
|---|---|---|---|
| `--dsw-alias-border-l1` | **最淡**分隔线 | `#0000000a` | `#ffffff0f` |
| `--dsw-alias-border-l2` | 淡描边 | `#0000001a` | `#ffffff1f` |
| `--dsw-alias-border-l3` | 中描边 | `#0000001f` | `#ffffff29` |
| `--dsw-alias-border-l4` | **最明显**（卡片外框） | `#00000029` | `#fff3` |
| `--dsw-alias-border-inverted` | 反色描边 | `#0000`（透明） | `#ffffff0f` |
| `--dsw-alias-border-inverted2` | 反色描边 2 | `#0000` | `#ffffff14` |

> 🗣️ **口语 → 官方**：**"细边"→ `border-l4`**（我们卡片用的就是它，**半像素** `0.5px`）。
> ⚠️ **l4 不是"第 4 层"，是"对比度第 4 档（最明显）"** —— 这是最容易被误解的命名。

### 1.4 `state` —— 语义状态色（**有 primary/secondary/tertiary 三档**）

| Token | 用途 | 亮色值 | 暗色值 |
|---|---|---|---|
| `--dsw-alias-state-success-primary` | **成功** | `var(--dsw-static-green-500)` = `#22c55e` | 同左 |
| `--dsw-alias-state-success-secondary` | 成功（次） | `green-400` | 同左 |
| `--dsw-alias-state-success-tertiary` | 成功（更淡，做底） | `green-100` | 同左 |
| `--dsw-alias-state-error-primary` | **错误** | `var(--dsw-static-red-600)` = `#ec1313` | `red-400` |
| `--dsw-alias-state-error-secondary` | 错误（次） | `red-400` | 同左 |
| `--dsw-alias-state-warn-primary` | **警告** | `var(--dsw-static-amber-500)` = `#f59e0b` | 同左 |
| `--dsw-alias-state-warn-label` | 警告**文字** | `amber-600` | 同左 |
| `--dsw-alias-state-warn-secondary/tertiary` | 警告次/淡 | `amber-400 / 100` | 同左 |
| `--dsw-alias-state-business-primary` | **品牌业务色** | `deepseek-500` = `#4176e6` | `deepseek-400` |
| `--dsw-alias-state-business-tertiary` | 业务色淡底 | `deepseek-100` | 同左 |

> 🗣️ **口语 → 官方**："绿点"→ `--dsw-alias-state-success-primary`；"红点/报错"→ `--dsw-alias-state-error-primary`；"黄/橙警告"→ `--dsw-alias-state-warn-primary`。
> **注意**：`success`/`error`/`warn` 是**语义**；`business` 是**品牌**。别把品牌蓝当"info"用。

### 1.5 `interactive` —— 交互态底色（**hover/active 专用**）

| Token | 用途 | 亮色值 | 暗色值 |
|---|---|---|---|
| `--dsw-alias-interactive-bg-hover` | **悬停底** | `#2631480f` | `#ffffff14` |
| `--dsw-alias-interactive-bg-active` | **按下底** | `#2631481a` | — |
| `--dsw-alias-interactive-bg-hover-accent` | 强调色悬停底 | `#26314824` | — |
| `--dsw-alias-interactive-bg-hover-danger` | **危险悬停底** | `#ec13130d` | — |
| `--dsw-alias-interactive-bg-hover-solid` | 实心悬停底 | `bluish-75` | — |

> 🗣️ **口语 → 官方**："鼠标移上去变色" → `--dsw-alias-interactive-bg-hover`（**不是** `fill-hover`，那个不存在）。

### 1.6 `button` / `fill` —— 按钮与填充

| Token | 用途 |
|---|---|
| `--dsw-alias-button-primary-fill` | **主按钮底** = `var(--dsw-alias-brand-primary)` |
| `--dsw-alias-button-primary-hover` | 主按钮悬停 |
| `--dsw-alias-button-primary-dimmed` | 主按钮变暗（弱化） |
| `--dsw-alias-button-ghost-active-fill` / `-border` / `-hover` | **幽灵按钮**（无底、仅描边/文字）激活态 |
| `--dsw-alias-button-floating-fill` / `-hover` | **浮动按钮** |
| `--dsw-alias-button-elevated-fill` | **抬升按钮** |
| `--dsw-alias-button-contrast-fill` | **高对比按钮** |
| `--dsw-alias-button-tool-bar-fill` / `-hover` / `-fill-invisible` | **工具栏按钮** |
| `--dsw-alias-button-info-fill` / `-hover` | 信息按钮 |

### 1.7 `brand` —— 品牌主色

| Token | 用途 | 亮色 | 暗色 |
|---|---|---|---|
| `--dsw-alias-brand-primary` | **主色**（选中态、开关打开底） | `#0f1115`（近黑） | `#f9fafb`（近白） |
| `--dsw-alias-brand-primary-invert` | 反色主色 | `bluish-1000` | `bluish-50` |
| `--dsw-alias-brand-text` | 品牌文字 | `bluish-1000` | — |
| `--dsw-alias-brand-primary-new-colorprimary-new-color` | 新版品牌蓝 | `#4176e6` | `deepseek-450` |

> ⚠️ **反直觉**：DSH 的"主色"在亮色主题下是**近黑**（`#0f1115`），不是蓝。
> **别假设 `brand-primary` 是蓝色**——若要品牌蓝，用 `--dsw-alias-state-business-primary` 或 `#4176e6`。

### 1.8 `specific` —— 场景专用（**在别处找不到合适 token 时用**）

| Token | 用途 |
|---|---|
| `--dsw-specific-menu` | **菜单/弹窗底** = `var(--dsw-alias-bg-layer-3)` |
| `--dsw-specific-bubble` / `-highlight` | 对话气泡 |
| `--dsw-specific-input-major` / `-login-input` | 输入框底 |
| `--dsw-specific-selector` | 选择器底 |
| `--dsw-specific-sidebar-fill` / `-nav-item-hover` / `-nav-item-active` / `-nav-item-active-accent` | 侧栏 |
| `--dsw-specific-tip` | 提示条 |

### 1.9 `elevation` / `shadow` —— 阴影（**层级越高越"浮"**）

> ⚠️ **重要（我自检时改正的一处错误）**：这些 token **不在**主 token 块（`body{}`）里，
> 而在**另一个 inline-CSS 块** `gradient_shadow_text_css_default` 中，选择器是 **`body, body *`**（全局继承）。
> ⇒ **它们同样全局可用**，但**别去主块里找它们**（我去找过，会"查无此 token"而误判为不存在）。
> 另：`--dsw-corner-shape` 在 **`@supports (corner-shape:superellipse(1.5))`** 内声明，
> **不是无条件存在** —— 不支持的浏览器里该 token **不存在**，使用者必须带降级值。

| Token | 用途 | 声明位置 |
|---|---|---|
| `--dsw-elevation-stroke` | 0.5px 描边（**细微**） | `body, body *` |
| `--dsw-elevation-stroke-color` | 上述描边的颜色 = `var(--dsw-alias-border-l4)` | 主块 |
| `--dsw-elevation-soft` | 轻浮起 | `body, body *` |
| `--dsw-elevation-panel` | 面板 | `body, body *` |
| `--dsw-elevation-prominent` | **最明显**（菜单/弹窗用） | `body, body *` |
| `--dsw-shadow-lv1` / `-blur` / `lv2` / `lv3` | 通用阴影四级 | `body, body *` |
| `--dsw-mask-blur` | `blur(2px)` | 主块 |
| `--dsw-corner-shape` | 全局圆角风格 `superellipse(1.5)` | **`@supports` 内**（可能不存在） |

---

## §2 组件术语（primitives **实际导出**的组件名）

primitives `@0.1.5-rc.2` 共导出 **123 个名字**。**可交互组件**如下（其余为图标/工具函数）：

| 口语 | **官方组件名** | 说明 |
|---|---|---|
| 按钮 | **`Button`** | 主/次/幽灵由 token 决定 |
| **开关 / 拨杆** | **`Switch`** | ⚠️ **不是 `Toggle`**。内部用 `aria-checked` 表达开合（不靠平行 class），样式在 `Switch.module.css` |
| 药丸徽章 / 小标签 | **`Pill`** | 圆角胶囊，常用于状态 |
| 标签 / 徽标 | **`Tag`** | 与 Pill 不同：Tag 更偏"分类标记" |
| 输入框 | **`Input`** | |
| 菜单 | **`Menu`** | |
| 弹窗 / 对话框 | **`Modal`** | |
| 气泡提示 | **`Tooltip`** | 悬停浮现 |
| 悬浮卡片 | **`HoverCard`** | 比 Tooltip 重，可放结构 |
| 轻提示 | **`Toast`** | 短时浮出 |
| **状态小圆点** | **`StateDot`** | ⚠️ **不是 `Dot`/`Badge`**。`props.state` ∈ `done / warning / ongoing / error / idle`；`ongoing` 是 3×3 方点动画 |
| 折叠行 | **`DisclosureRow`** | **可展开行**（我们的卡片头部就是这种形态） |
| 风险确认 | **`RiskConfirmation`** | 危险操作二次确认 |
| 连接指示 | **`ConnectionIndicator`** | |
| 文件类型图标 | **`FileTypeIcon`** | |
| 代码块 | **`CodeBlock`** | |
| 差异块 | **`DiffBlock`** | |
| 读取块 | **`ReadBlock`** | |
| 搜索块 | **`SearchBlock`** | |
| 终端块 | **`TerminalBlock`** | |
| 网页块 | **`WebBlock`** | |
| JSON 树 | **`JsonTree`** | 可展开 |
| JSON 块 | **`JsonBlock`** | |
| Markdown 渲染 | **`MarkdownText`** | |
| 引导面 | **`OnboardingSurface`** | |
| 鱼形 Logo | **`FishLogo`** / **`BrandWordmark`** | DSH 品牌标识 |
| 图标 | **`Icon*Outline14/16/20`** 等 30+ | 命名规则：`Icon<名><Outline|Fill><尺寸>` |

> **没有的组件（别指名要）**：**没有 `Card`、没有 `Progress`/`ProgressBar`、没有 `Avatar`、没有 `Checkbox`、没有 `Tabs`。**
> 这些要么用 `div` + token 自己搭（**我们就是这么做的**），要么在别的基础包（如 `dsh-client-ui-layout`）里。
> 例如**进度条**：CodeBuddy 与我们都用 `div` + `width: ${percent}%` 自建（见 §5）。

**工具函数（也是导出）**：`classifyFileType`、`classifyLinkPath`、`diffTotals`、`extractMarkdownPlainText`、`fileExtension`、`fileSizeText`、`projectUserText`、`rankByName`、`relativeTime`、`useAnchoredMaxHeight`、`useAnchoredPosition`、`useDismissOnOutsidePointer`、`writeClipboard`。

---

## §3 状态术语（交互态的**官方叫法**）

| 口语 | 官方名 | 在 DSH 里怎么表达 |
|---|---|---|
| 鼠标移上去 | **hover** | `:hover` 伪类；颜色用 `--dsw-alias-interactive-bg-hover`。**React 内联样式里写不了 `:hover`** → 我们用 `onMouseEnter/Leave` + state 模拟（见 §5） |
| 按下去 | **active** | `:active`；底色 `--dsw-alias-interactive-bg-active` |
| 聚焦（键盘 Tab） | **focus-visible** | ⚠️ **重点是 `:focus-visible` 而非 `:focus`** —— 只有键盘导航才显示焦点环，鼠标点击不显示 |
| 禁用 | **disabled** | `disabled` 属性。官方 `Switch` 的样式：`.switch:disabled { cursor: default; opacity: 0.5 }` |
| 选中（多选里的勾） | **checked** | `aria-checked` / `checked` |
| 当前选中项（列表/标签页） | **active** 或 **selected** | 侧栏用 `--dsw-specific-sidebar-nav-item-active` |
| 展开 / 收起 | **open / closed** | 我们的卡片用 `open` state + 箭头 `rotate(180deg)` |
| 加载中 | **loading** / **pending** | 我们登录轮询用 `state: 'pending'` |
| 空态 | **empty** | 类名惯例 `.empty`（跨包高频，见 §4） |
| 无效 | **invalid** | 类名惯例 `.invalid` |
| 可见但只给读屏 | **visually hidden** | 类名惯例 `.visuallyHidden`（DSH 官方就用这个词） |

> 🔴 **最常被搞错的两个**：
> 1. **`focus` vs `focus-visible`** —— 用 `:focus` 会让鼠标点击也画焦点环，**视觉上像 bug**。
> 2. **`hover` 在 React 内联样式里不存在** —— 必须用 JS 事件模拟；**这不是"我们的取巧"，CodeBuddy 原版也这么做**。

---

## §4 布局术语

| 口语 | 官方名 | 说明 |
|---|---|---|
| 横排 | **flex row**（`display: flex`） | 主轴水平 |
| 竖排 | **flex column**（`flexDirection: 'column'`） | 主轴垂直 |
| **网格** | **CSS Grid**（`display: grid` + `gridTemplateColumns`） | 我们模型行用的就是它（`34px 1fr 96px 100px 56px`） |
| 弹性伸缩 | **flex: 1** / `flex: none` | ⚠️ **`flex:1` 会吸收全部剩余空间**；多列布局里滥用会导致**列漂移**（我们踩过，见 §5） |
| 自动换行 | **flexWrap: 'wrap'** | 与 grid 二选一 |
| 子项间距 | **gap** | 现代写法，替代 `margin` 拼凑 |
| 交叉轴对齐 | **alignItems** | `center`/`flex-start`/`baseline` |
| 主轴分布 | **justifyContent** | |
| **内边距** | **padding** | 口语"留白"通常指它 |
| **外边距** | **margin** | |
| **贴边定位** | **inset** | `inset: 0` = 上下左右全 0（比写 `top/right/bottom/left` 简洁） |
| 槽宽 / 栅格间距 | **gutter**（在 grid 里就是 `gap` / `columnGap`） | DSH 未用 `gutter` 作 token 名，用 `gap` |
| 定位上下文 | **position: relative / absolute / fixed** | 我们的菜单用 `absolute` + `right:0` |
| 堆叠顺序 | **zIndex** | 菜单 `zIndex: 50`、对话框 `zIndex: 1000` |
| 溢出滚动 | **overflow: 'auto' / 'hidden'** | |
| 文本截断 | **textOverflow: 'ellipsis'** + `whiteSpace: 'nowrap'` + `overflow: 'hidden'`（**三件套缺一不可**） | |
| 圆角 | **borderRadius** | 胶囊=高度一半；DSH 另有 `--dsw-corner-shape`（`superellipse(1.5)`，**在 `@supports` 内，可能不存在**）作为全局圆角风格 |

**跨包高频类名（实测词频，供参考命名习惯）**：
`root`(15) `label`(11) `body`(10) `title`(6) `icon`(5) `empty`(5) `panel`(5) `footer`(4) `header`(4) `actions`(4) `summary`(4) `details`(4) `sep`(4) `visuallyHidden`(4) `hint`(3) `notice`(3) `invalid`(3) `status`(3) `pill`(3)

---

## §5 我们卡片已用到的 token 对照表

**实测**：`lib/client.js` 共用 **7 个** `--dsw-*` token。

| Token | 我们在做什么 | **建议的准确说法** | 状态 |
|---|---|---|---|
| `--dsw-alias-brand-primary` | iOS 开关**打开**时的轨道底色 | "开关的**选中态轨道底**用 `brand-primary`" | ✅ 已声明 |
| `--dsw-alias-border-l4` | 卡片外框、开关**关闭**态轨道、按钮描边 | "**最明显的描边档** `border-l4`（0.5px）" | ✅ 已声明 |
| `--dsw-alias-bg-layer-3` | 按钮底、分享区块底 | "**第三层容器底**"（菜单/浮层同层） | ✅ 已声明 |
| `--dsw-alias-bg-layer-1` | 账号卡片底 | "**第一层容器底**" | ✅ 已声明 |
| `--dsw-alias-interactive-bg-hover` | 模型行 **hover** 衬底（t10 加） | "**交互悬停底**" | ✅ 已声明 |
| `--dsw-alias-label-primary` | 头像文字、正文 | "**主文字色**" | ✅ 已声明 |
| **`--dsw-alias-label-onbrand`** | 主按钮上的文字（L461/L880） | ⚠️ **这个 token 不存在** | ❌ **见下方** |

### 🔴 实测发现：`--dsw-alias-label-onbrand` **不存在**

- **用途**：`client.js:461` 与 `client.js:880` 写 `color: 'var(--dsw-alias-label-onbrand, #fff)'`。
- **实测**：主题体**未声明**该 token；**全树扫描 9,906 个文件，提及数 0、声明数 0**；
  插件仓库内**1 处提及、0 处声明**。
- **后果**：**降级色 `#fff` 恒定生效**。在亮色主题下按钮底是近黑 `#0f1115`，白字**可读**；
  但**暗色主题下 `brand-primary` 变成近白 `#f9fafb`**，**白字将完全看不见**。
- **仪器自检**（防假阴性）：正控 4 个真 token 全 YES；负控 3 个自造名全 NO；
  扫描面覆盖 `@deepseek-ai` 全树 → 否定结论可靠。
- **正确写法**：改用 **`--dsw-alias-label-primary-foreground`**（亮=`#fff`、暗=`#0f1115`，**正是为主色块上的文字设计的**）。

> **这与本团队前两次同类缺陷同源**（`--dsw-alias-fill-hover`、本项目 t6 的关键词假绿）：
> **token 名打错不会报错，只会静默走降级色。** 新写 token 时**必须回读源码确认存在**。

### 5.1 我们**自建**而没有用 primitives 组件的地方（术语说明）

| 我们做的 | 官方最近似的组件 | 为什么自建 |
|---|---|---|
| 模型行里的开关 | **`Switch`** | 已按 `Switch.module.css` 的形状（34×19、圆胶囊）手写；**若要收敛可改用官方组件** |
| 「不可用」暖色徽章 | **`Pill`** 或 **`Tag`** | 自建 span + 圆角 |
| 积分/进度条 | **无对应组件**（primitives 不含 Progress） | CodeBuddy 与我们**都**用 `div` + `width: %` |
| 头像圆圈 | **无 `Avatar` 组件** | 自建 `div` + `borderRadius: '50%'` + `avatarTone()` |
| 折叠卡片头 | **`DisclosureRow`** | 自建（CodeBuddy 风格） |
| 菜单 | **`Menu`** | 自建 absolute 定位 div |

---

## §6 自检记录（本手册的**每条主张**如何被验证）

| # | 主张 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 主题体声明 **357** 个 `--dsw-*` | 正则枚举 + 去重 | ✅ 357 |
| 2 | 亮/暗是**两个** token 块 | 定位两个 `brand-primary` 声明 + 选择器文本 | ✅ `body{` 与 `body[data-ds-dark-theme]{` |
| 3 | 亮色边框是黑、暗色是白 | 读 `border-l1` 值 | ✅ `#0000000a` vs `#ffffff0f` |
| 4 | primitives 导出 **123** 个名字 | 解析 `export {}` 语句 | ✅ 123 |
| 5 | **没有** `Card`/`Progress`/`Avatar` | 在导出列表中逐个查找 | ✅ 均**不存在** |
| 6 | `Switch` 用 `aria-checked` | 读 `Switch.module.css` | ✅ 注释明写"keys off aria-checked rather than a parallel class" |
| 7 | §5 的 7 个 token | 逐个回读主题体 | ✅ 6 个存在、**1 个不存在**（已单列） |
| 8 | `label-onbrand` 不存在 | 正控 4 YES + 负控 3 NO + **全树 9,906 文件扫描** | ✅ 0 声明（**仪器已自检**） |
| 9 | 跨包类名词频 | 扫 5 个 UI 包的 className | ✅ 见 §4 |
| 10 | **主题体有 6 个 inline-CSS 块、共 374 token** | 枚举 `var X = "…"` 块并分别提取 | ✅ 6 块 / 374 |
| 11 | elevation/shadow **不在主块** | 定位声明块名 | ✅ 在 `gradient_shadow_text_css_default`（`body, body *`） |
| 12 | `corner-shape` **在 `@supports` 内** | 读 `corner_shape_css_default` 块 | ✅ 条件存在 |

### 🔴 我在本手册自检中改正的**两处自己的错误**（留档）

1. **初稿只扫了 1 个 token 块**（`design_platform_css_default`），于是把
   `--dsw-elevation-*` / `--dsw-shadow-*` 当成"存在但查不到"。
   **实际它们在 `gradient_shadow_text_css_default` 块（选择器 `body, body *`）。**
   ⇒ 已在 §1.9 加显著说明。**教训：主题体不是"一个 token 表"，是 6 个块。**
2. **初稿把 `--dsw-corner-shape` 写成无条件存在**，实际它在
   **`@supports (corner-shape:superellipse(1.5))`** 内 —— **不支持的浏览器里该 token 根本不存在**。
   ⇒ 已在 §1.9 与 §4 标注"可能不存在，使用者必须带降级值"。

> 这两处都是**"扫的面不够宽"**导致的误判 —— 与我在 `DOCS-PUBLIC-POLICY.md`
> 里踩的"只认 `@N` 不认 `file:line`"是**同一类错误**：**检查器覆盖面不足，会报出假的"不存在"。**

**复跑**：
```
node D:\DSH\.ds-c-glossary-selfcheck.mjs        # 15/15（含正控/负控/跨块）
node D:\DSH\.ds-c-glossary-tokens.mjs           # 全量 token + 值
node D:\DSH\.ds-c-onbrand-instrument-check.mjs  # label-onbrand 全树取证
```
⚠️ **裸调，勿加管道/重定向**（沙箱边界，非脚本失败）。

---

## §7 一句话对照速记

```
按钮            → Button 组件
开关 / 拨杆      → Switch 组件（不是 Toggle）
药丸徽章         → Pill 组件
状态小圆点       → StateDot 组件（state: done|warning|ongoing|error|idle）
可展开行         → DisclosureRow 组件；或 open/closed 状态
灰字 / 说明      → --dsw-alias-label-secondary
正文黑字         → --dsw-alias-label-primary
主色块上的字     → --dsw-alias-label-primary-foreground（不是 label-primary）
卡片底           → --dsw-alias-bg-layer-1
菜单 / 弹窗底     → --dsw-alias-bg-layer-3 或 --dsw-specific-menu
细边             → --dsw-alias-border-l4（对比度第 4 档，不是"第 4 层"）
鼠标悬停底       → --dsw-alias-interactive-bg-hover（不是 fill-hover）
成功绿           → --dsw-alias-state-success-primary
错误红           → --dsw-alias-state-error-primary
品牌蓝           → --dsw-alias-state-business-primary（brand-primary 其实是近黑！）
弹窗阴影         → --dsw-elevation-prominent
键盘焦点环       → :focus-visible（不是 :focus）
禁用态           → :disabled（官方加 opacity:.5 + cursor:default）
网格             → CSS Grid，gridTemplateColumns
贴边             → inset: 0
间距             → gap（不是 gutter）
```
