# 账号管理 UI 调研 —— DSH 同类插件参照（Qoder 卡片「账号管理」tab 前期调研）

**任务来源**：Qoder 卡片新增「账号管理」tab（多账号卡片、头像、签到状态、积分包、设为当前），需要同类 DSH 插件的 UI 实现参照。
**方法**：GitHub 引擎搜索（`dsh-plugin account management` / `deepseek harness plugin multi-account` / `dsh-plugin account switching`）+ 仓库 README/文档精读 + 本机已提取的 CodeBuddy 卡片源码逐行分析（`D:\DSH\tmp\cb-account-section.js`，476 行）。
**搜索局限声明**：GitHub 搜索只覆盖公开仓库，结果按 star 排序不代表全网；命中插件多为个人项目（star 0–287），其 README 是能力声明而非经审计的实现——本文涉及「实现方式」的结论只在有源码/本机提取佐证时标注，纯 README 声明均标 ⚠️。
**未改 lib/，纯调研报告。**

---

## 0. 参照物清单

| # | 项目 | star | 与我们场景的相关度 |
|---|---|---|---|
| A | CodeBuddy 插件卡片（**本机提取** `cb-account-section.js`） | —（官方兄弟插件） | ★★★ 最高：同宿主、同 React/JSX-runtime、同 DSH 设计令牌，且是**已验证可跑**的多账号实现 |
| B | [feibi-mochi/deepseek-harness-control-center](https://github.com/feibi-mochi/deepseek-harness-control-center)（钱包） | 72 | ★★★ 加密多账号 + 换号确认 + 凭据 seam 写入，交互细节最完整 |
| C | [wuyan19/dsh-plugin-zquota](https://github.com/wuyan19/dsh-plugin-zquota) | 0 | ★★☆ 多账号额度 meter（分档配色/倒计时）+ 「设为当前」语义 + 安全边界设计 |
| D | [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider) / [chaos-03x/dsh-agy](https://github.com/chaos-03x/dsh-agy) | 287 / 41 | ★☆☆ 仅 README 级参照（多账号池、429 轮换的产品形态），未读源码 |

---

## 1. 参照 A：CodeBuddy AccountCard —— 我们真正的对照组

这是唯一拿到**逐行源码**的参照，结构如下（组件树 + 状态 + 样式三视角）：

### 1.1 组件结构（article 四段式）

```
<article .accountCard>
├─ header .accountCardHeader（active 时追加 .accountCardActiveHeader）
│  ├─ .accountAvatar        ← 首字母头像：name.charAt(0).toUpperCase()，
│  │                          背景 = avatarTone(name)（按名字确定性选色）
│  ├─ 名称 h3（title=全名防截断）+ chips 行
│  │   ├─ 签到 Chip：checkedInToday===true → success「已签到」
│  │   │             ===false → neutral「未签到」（===undefined 则不渲染）
│  │   └─ 过期 Chip：expiresAtMs>0 && < Date.now() → danger「令牌已过期」
│  └─ 「⋯」按钮 + 弹出菜单（absolute 定位，zIndex 50）
│      ├─ 设为当前（run SWITCH_ACCOUNT {id}）
│      ├─ 签到（仅 checkedInToday !== true 时出现——幂等隐藏）
│      ├─ 删除（window.confirm 确认 → run DELETE {id}，danger 色）
│      └─ menuError 内联错误行（红色，不弹 toast）
├─ body .accountCardBody    ← 三态分支：
│  ├─ creditError !== undefined → 红色错误行（查询失败≠没数据，分开呈现）
│  ├─ credits === undefined    → 次要色「查询中」（等待态有自己的 UI）
│  └─ 正常 → 总量+套餐数+更新时间行；「即将过期」区默认只显 2 条
│             （visible = resources.slice(0,2)），「查看全部 →」开弹窗
├─ footer .accountCardFooter
│  ├─ 左：签到反馈 checkInFeedback()（ok/already→绿、fail→红）+ 签到按钮
│  └─ 右：active ? 「使用中」pill（非按钮） : 「设为当前」按钮
└─ 全部套餐弹窗（fixed backdrop + 440px dialog，role="dialog"，
   每条：包名 + 过期文案 + remain/total + used + 进度条 .progressTrack/.progressFill）
```

### 1.2 状态管理（极简，值得抄）

- **5 个 useState**（resourcesOpen / busy / menuOpen / menuError / checkInNote）+ **1 个 mounted ref**。
- **busy 单闸**：所有写操作共用一个 busy，期间禁用全部按钮——不搞 per-button loading。
- **`run(path, body)` 通用请求封装**：setBusy → fetch（`credentials: "same-origin"`）→ !ok 时从 body 提取 `error` 字符串否则 `HTTP <status>` → 成功 `onChanged()`（**父级重拉，本地不缓存业务数据**）→ catch 内 `if (mounted.current)` 才 setState（防卸载后泄漏警告）。
- **错误就地呈现**：menuError 显示在菜单底部、checkInNote 显示在 footer——不全局 toast，不丢上下文。
- 签到三态：`ok` / `already`（视为成功）/ 失败带 message——**"already" 是一等状态**，不是错误。

### 1.3 样式方案

- CSS Modules（`*.module.css`）为主 + 少量内联（菜单/弹窗这类一次性布局直接内联）。
- 颜色/阴影/背景**全部走 DSH 令牌**：`var(--dsw-alias-label-*)`、`var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1, #fff))`（带 fallback 链）、`var(--dsw-elevation-prominent, …)`——深浅主题自动跟随。
- 头像底色 `avatarTone(name)`：按名字 hash 确定性取色，无头像图也能稳定区分账号。

---

## 2. 参照 B：deepseek-harness-control-center（钱包，README 级 ⚠️）

多账号语义与我们最接近的部分（README「Multi-account」节）：

- **账号管理入口**：钱包面板 → 「Account Management」增删账号（名称+Key）、切换当前。
- **激活必须经宿主确认**：添加首个账号时尝试把 Key 同步进宿主凭据库，**写成功才激活**；被拒绝则保留账号但不标为计费当前——「保存」与「激活」是两个状态。
- **切换有确认弹窗**：因为切换会改变后续请求的计费归属——写凭据 seam（`credentials.set('DEEPSEEK_API_KEY',…)`），下一条请求即生效、无需重启。
- **密钥永不出宿主**：静态加密（Windows DPAPI / 其他平台 owner-only AES-GCM），`.bak` 恢复副本，两份都读不了就**锁写不覆盖**；UI 只显示掩码 Key。
- **环境变量遮蔽检测**：`DEEPSEEK_API_KEY` 由 shell 提供时**拒绝切换**并给出明确错误（凭据引用被遮蔽，写了也无效）。
- 错误预算提示、阈值告警（低于阈值 chip 变红+呼吸动画）、充值链接硬编码官方域名（防钓鱼）。

**对我们最有价值的三点**：①「已保存 ≠ 已激活」的双状态语义；②切换动作的**后果性确认**；③宿主遮蔽（我们场景=环境变量/桌面端登录态优先）时明确拒绝而不是静默失败。

## 3. 参照 C：dsh-plugin-zquota（README 级 ⚠️）

- **额度 meter 三格**（5h 窗口/每周/MCP 月）：**≥70% 橙、≥90% 红**的分档配色；倒计时 >1天精确到小时、<1天精确到分钟（时间粒度跟随紧迫度）；MCP 细节悬停显示。
- **「设为当前」= 写凭据 + 自动补齐配置**：只补缺失、不覆盖显式用户配置；「使用中」徽章**跟着当前默认模型实际解析到的凭据走**（不是跟 UI 里最后点的按钮走）——徽章是**从真实状态推导**的，双端点并存也不会出现两个徽章。
- **安全边界**：机密在宿主侧文件（0600 原子写），浏览器永远收不到明文（state 响应只含 `live` 标志）；API 路由带自定义头 + loopback Host 校验（防跨站简单请求与 DNS rebinding）——与我们 web.js 的 loopback 防线同构。
- 样式：完整使用 `--dsw-alias-*` 令牌，深浅色自动跟随。

## 4. 参照 D：形态速览（仅 README，不作实现依据）

- **dsh-commandcode-provider**（287★，TypeScript）：多账号 + live 目录 + 按套餐选模型——证明「多账号 + 模型目录」可以同卡共存。
- **dsh-agy**（41★）：多账号**池** + 429 自动轮换 + 设备指纹 + CLI/Web 双登录——账号池是「轮换资源」语义（账号是给调度器挑的），与我们的「用户身份」语义不同，UI 上不应照搬。

---

## 5. 三方对比表

| 维度 | A: CodeBuddy（源码） | B: 钱包（README） | C: zquota（README） |
|---|---|---|---|
| 账号呈现 | **每账号一张卡片**（article），卡片即操作面 | 面板内列表管理（名称+Key 表单） | 每账号 meter 面板行 |
| 头像 | 首字母 + `avatarTone(name)` 确定性底色 | ⚠️ 未提 | ⚠️ 未提 |
| 当前账号 | 卡片 header 高亮 + footer「使用中」pill /「设为当前」按钮二选一 | 激活状态独立于保存（写宿主成功才亮） | 「使用中」徽章**由默认模型实际路由推导** |
| 签到/积分 | 签到 Chip 三态 + 积分包 ResourceBar + 「查看全部」弹窗 | 余额/用量行 + 低额告警 | 三格 meter 分档配色 + 倒计时 |
| 状态管理 | 5×useState + busy 单闸 + `onChanged()` 父级重拉 | ⚠️ 未提 | ⚠️ 纯函数 planner + 三态测试 |
| 错误处理 | 就地内联（menuError/checkInNote），错误与等待态都有专属 UI | 遮蔽拒绝、写失败不激活 | 查询失败保留上次快照 |
| 样式 | CSS Modules + 令牌（fallback 链） | 令牌 + 安全 fallback | 全令牌、深浅自动跟随 |
| 安全 | `credentials: "same-origin"`、删除需 confirm | 静态加密+掩码显示+锁写 | 明文不出宿主、自定义头+loopback |

---

## 6. 可直接应用到 Qoder 卡片的建议（基于 `status.account`：user_id/name/email/avatar_url/expires_at）

> 我们现有数据比 CodeBuddy 多 `email`/`avatar_url`、少 `credits`/`checkedInToday`；建议按「先有数据的做好，后要数据的留位」排序。

### 建议 1：首字母头像 + avatar_url 渐进降级（成本低，视觉收益最大）

照抄 CodeBuddy 的 `avatarTone(name)` 方案：**有 `avatar_url` → `<img>`（onerror 回退首字母）；无 → `name.charAt(0).toUpperCase()` + 按名字确定性取色的底色**。名字取 `name ?? email?.split('@')[0] ?? user_id`，`h3` 带 `title=` 防截断。纯 client 改动，不需要任何新后端数据。

### 建议 2：expires_at 变成「过期 Chip」，粒度跟随紧迫度

CodeBuddy 只有二态（过期/不显示）——结合 zquota 的紧迫度思想升级为**三态**：
- `expiresAt < now` → `danger`「已过期」
- 剩余 < 7 天 → `warning`「N 天后过期」（ OUR 场景 token 距到期 30 天，7 天窗口合理）
- 其余 → `neutral`「MM-DD 到期」或干脆不渲染（避免噪声）
数据已有（`status.account.expires_at`），纯前端换算。

### 建议 3：账号卡 footer 用「pill/按钮二选一」而非复选标记

当前账号的视觉锚点用 CodeBuddy 方案：`active ? <span class=pill>使用中</span> : <button>设为当前</button>`——**「使用中」是状态不是按钮**，且参考 zquota：active 判定必须**从宿主真实状态推导**（我们=卡片加载时 status 接口返回的账号 vs 本地选中态），不要在点击后本地翻转变假绿。**切换动作要带后果确认**（钱包的做法）：切换会改变后续请求计费归属，confirm 文案应写明「后续请求将使用账号 X」。

### 建议 4：为「积分包 / 签到」预占 UI 位——三态分支骨架照抄 CodeBuddy body

CodeBuddy body 的三态分支（`creditError` / `credits===undefined` / 正常）是我们未来接入 Qoder 配额/签到数据时最该抄的骨架：**失败、等待、正常三种呈现分开，查询失败绝不渲染成"没数据"**。「查看全部」弹窗（fixed backdrop + `role="dialog"` + 进度条 remain/total）可直接作为 Qoder 积分包 UI 的模板。现阶段 tab 先渲染「暂未接入」占位 + 该骨架，避免后续返工。

### 建议 5：写路径安全复用我们已有的 web.js 防线 + 两条新交互守则

未来账号写接口（switch/remove/checkin）落在 web.js 时：沿用 `checkLoopbackPost`（loopback Host/Origin + JSON content-type）+ body 上限；UI 侧两条守则来自参照：①**删除类操作一律 `window.confirm`**（CodeBuddy），且危险项在菜单里用 error 色（`--dsw-alias-label-error`）；②**busy 单闸**——一个卡片同时只允许一个在途写请求，全部按钮统一 disabled，避免双击双写。

---

## 7. 反向发现（不要抄的）

- **账号池轮换语义（dsh-agy 式 429 轮换）不适合 Qoder**：我们的账号是用户身份而非可轮换资源，UI 上做「自动轮换」会混淆「谁在计费」的责任。
- **CodeBuddy 的 `window.confirm` 删除确认**够用但廉价；钱包的「写宿主失败则不激活」告诉我们：删除/切换的**失败反馈比确认框更重要**——失败必须内联可见（CodeBuddy 的 menuError 位置），不能只弹 toast。
- 搜索到的低 star 插件（0–1★）功能描述与实现可能脱节，本文只采信其 README 中可交叉验证的机制描述，未采信任何截图/未验证声明。
