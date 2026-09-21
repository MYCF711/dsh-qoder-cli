# DSH Qoder Connect

> **⚠️ 免责声明**：本项目为**非官方**第三方插件，与 Qoder 官方无任何关联，未获其授权或认可。
> 仅供个人学习研究，只驱动**使用者本人**已登录的 Qoder 账号；使用者需自行遵守 Qoder 的服务条款。

把 **Qoder**（[qoder.com](https://qoder.com) 桌面端）的模型接入 DeepSeek Harness 的模型选择器。

两种登录方式，零 API Key 配置：本机装有 Qoder 桌面端时直接复用其登录态；没有桌面端也可以在设置卡片里一键设备码登录。

**可交互预览**：[`preview/qoder-card-interactive.html`](preview/qoder-card-interactive.html) —— 单文件零依赖，双击浏览器打开即可体验全部界面（账号卡片 / 资源明细 / 模型开关 / 用量统计）。

---

## 功能

### 账号卡片（v0.3.0，多账号形态）

- **账号信息**：头像圆圈（`avatar_url` 优先显示，加载失败或缺失时回退首字母 + 按名字确定性取色的淡底）+ 账号名 / 邮箱（超长省略号截断）。
- **剩余 Credits**：卡片 header 独立一列大数字（订阅 + 资源包余额加总，来自 quota API）。
- **令牌到期三态 chip**：正常 → 绿色（显示到期日期）；不足 7 天 → 橙色「N 天后过期」；已过期 → 红色「已过期」。悬停始终有完整日期。
- **签到状态**：读取 `/sash/api/v1/me/campaigns`，三态——可领取（按钮打开 Qoder 官方活动页）/ 今日已领 / 暂无活动。**明确说明：不做一键领取**——Qoder 的领取动作在官方网页 iframe 内完成，第三方代点既不可靠也不合规。
- **当前 / 备选**：当前账号显示绿色「当前」pill；「设为当前」按钮为多账号存储预留（UI 已按多账号设计，后端暂为单账号）。

### 资源明细（点击账号卡片展开）

- **订阅版本的资源**：当前计划的月度配额与使用情况——`已使用 / 总量` 大数字 + 百分比 + 进度条 + 剩余数。
- **个人资源包**：通过活动或购买获得的包总量与使用情况；子项列表（包名(总计:N) + 剩余 credits + 有效期）。
- 数据来自 `/api/v2/quota/usage`（协议 §5.1 VERIFIED）；查询失败时显示「数据不可用」而不是假装 0。

### 用量统计 tab

- **四格数字卡**：今日消耗 / 近 7 天 / 本月 / 累计总计（含单日峰值提示）。
- **credits 条形图**：最近 14 天逐日消耗（数据来自 `/sash/api/v1/ai-conversations/credits-heatmap`，实测 200 VERIFIED）。

### 模型目录与 gate 探测

- **三层模型目录（17 个模型，永不空选）**：按信息新旧依次取用，任何一层失败自动落到下一层：
  1. **本地缓存**：Qoder 桌面端自己缓存的服务器目录（`~/.qoder/.models/<uid>/catalog-v6`，AES-GCM 加密，密钥即账号 uid）。插件从本机 Qoder 安装里提取 Qoder 自带的 `qoder_auth_wasm_bg.wasm`，在进程内原样解密——不联网、不签名、不改写任何文件。本机有 Qoder 客户端登录过时这是最新鲜的一层。
  2. **随包快照**（`lib/qoder/catalog-snapshot.json`）：一份解密后的服务器目录**已随包分发**，没有 Qoder 桌面端也能看到完整 17 模型目录（`auto` / `ultimate` / `performance` / `efficient` / `smodel`(Sonus) / `cmodel`(Cantus) / `qmodel` 系列 / `kmodel` 系列 / `gmodel` 系列 / `dmodel` 系列 / `mmodel`(MiniMax-M3)）。
  3. **内置最小集**：10 个逐个实测被网关接受的键，快照也读不到时兜底——目录出任何问题都不允许把 provider 整个弄失效。
- **每账号 gate 自动探测**：服务器目录是"全账号"视角，聊天网关却按账号放行。插件在后台用当前凭据对每个模型做一轮 1 token 的轻量探测（间隔 300ms），结果按账号缓存在 `$DSH_HOME/.qoder-cli-gate-cache.json`，**24h 有效**；到期后台重新探测，从不阻塞。探测结果**动态修正 degraded 标记**：本账号 `accepted` 的模型会清掉快照时代的降级备注，`rejected` 的标"不可用"。探测失败静默——快照时代的标记继续兜底。

### 模型选择与显示

- **模型开关（iOS 样式）**：绿色药丸 + 滑动 knob 的 toggle，决定该模型是否出现在选择器；一个都不开 = 全部提供。已固定某模型的既有会话不受开关影响（继续可用，不中断）。
- **每模型选项**（目录里有的才显示）：
  - **思考档位**：关闭 / 低 / 中 / 高 / 极高 / 最大，服务器声明的档位阶梯与默认档自动带入；
  - **上下文档位**：200K / 400K / 1M 等带标签的窗口阶梯，默认档预选；
  - **积分倍率**：`×N.NN` 徽章显示该模型的服务器计费倍率（`priceFactor`）；
  - **促销徽章**：服务器促销（夜间免费/限时免费等）以绿色徽章显示，悬停看说明；
  - **不可用标记**：gate 探测或快照标记 degraded 的模型灰显标注，不隐藏。
- **真实 SSE 流式输出**：Qoder 网关本身就是 OpenAI Chat Completions 形态的 SSE。

### 凭据 failover（v0.3.0）

主凭据请求失败（401/403/模型被拒）时，插件自动遍历所有可发现的备用凭据——IDE 桌面端 store（DPAPI）→ CLI 设备流 store（WASM AES）→ `QODER_CLI_AUTH_FILE` 显式文件——每个候选先做一次 1 token 真实探测，通过者记忆为进程级凭据（后续请求跳过遍历）。全部失败时原始错误原样上抛，不吞错。

### 主题适配（v0.3.0）

全部中性色（边框 / 次要文字 / hover 衬底 / 错误文字）走 `--dsw-alias-*` 主题 token，跟随 DSH 的亮 / 暗 / 彩色主题；每个 token 均带降级种子，主题缺失时视觉不劣化。语义色（成功绿 / 警告琥珀 / 错误红 / 头像六色）保持固定，不跟随品牌色。

### 两种登录方式

1. **复用 Qoder 登录态**：直接读取 Qoder 桌面端自己的加密凭据（`%APPDATA%\com.qoder.app.stable\auth.v1.dat`），在 Qoder 里重新登录后自动跟随。**从不改写 Qoder 的任何文件。**
2. **卡片内设备码登录**：设置 → 插件 → DSH Qoder Connect 卡片 → **网页登录添加账号**，浏览器打开 qoder.com 完成登录，插件经 PKCE 设备码流（与 Qoder 桌面端同款流程）自动取回令牌，存入插件自己的凭据文件（`$DSH_HOME/.qoder-cli-auth.json`）。无需安装 Qoder 桌面端。

## 安装

```powershell
# 1. 打包
cd <本仓库目录>
npm pack

# 2. 装进 web profile（用 tarball，不要用 link:，见下方「为什么不能用 link」）
dsh plugin --profile web add <路径>\dsh-qoder-cli-<版本>.tgz

# 3. 重启 DSH（插件在启动时加载）
```

装完后：模型选择器里会出现 Qoder 的模型；设置页会出现配置卡片。

### ⚠️ 为什么不能用 `link:` / `pnpm add <目录>`

实测：`dsh plugin --profile web add link:<目录>` 会装出一个 junction，
而 Node 解析模块时会**跟随 junction 到真实路径**。那里没有 DSH 的内部依赖，
于是 `@deepseek-ai/schemastery` 等全部解析失败，插件在启动时加载不了。

用 tarball 安装时，pnpm 会把包实体放进 profile 自己的 `.pnpm` 目录内，
向上查找能命中 profile 的 `node_modules`，依赖才解析得到。

## 配置

设置 → 插件 → **DSH Qoder Connect**（点击标题行展开）：

| 项 | 说明 |
|---|---|
| 网页登录添加账号 / 刷新 | 设备码登录入口与账号数据刷新（tab 栏上方，常驻可见） |
| 账号卡片 | 头像 / 账号名 / 邮箱 / 剩余 Credits / 令牌到期三态 chip / 签到 / 当前状态；**点击卡片展开资源明细** |
| 可选模型 tab | 每模型一行 iOS 样式开关 + 思考档位 + 上下文档位下拉；带积分倍率 `×N.NN` 与促销徽章 |
| 用量统计 tab | 今日 / 近 7 天 / 本月 / 累计四格数字卡 + 最近 14 天 credits 条形图 |

## 命令行

```powershell
dsh plugin --profile web exec dsh-qoder-cli status   # 登录状态（--json 机器可读）
```

## 它是怎么工作的

插件有**两条通道**，按模型自动择一：

```
① REST 通道（多数模型）
   DSH ──(OpenAI SSE, 无自定义头)──▶ 本机回环 shim ──(补 Cosy-* 头)──▶ api2-v2.qoder.sh

② CLI 通道（网关拒绝、但本地 CLI 能服务的模型）
   DSH ──▶ 回环 shim ──▶ qodercli -p -o stream-json ──▶ 把事件流转译成 OpenAI SSE
```

**为什么必须有一个 shim**：Qoder 网关要求每个请求都带 `Cosy-ClientType` /
`Cosy-Version` / `Cosy-MachineId` 这几个头，而 pi-ai 的 provider 描述符只能设静态头，
没有"每请求注入动态头"的钩子。所以插件在本机起一个回环 HTTP 服务，把请求接住、补齐头、再转发。

shim 的安全边界：只绑 `127.0.0.1` 随机端口；每次调用都要带进程内随机生成的 bearer
（常数时间比较）；`Host` 与 `Origin` 都必须是回环，挡住 DNS rebinding。

### CLI 通道（v0.5.0）

有些模型（`qfmodel` / `qmodel_38max` / `qmodel_38flash` / `smodel` / `cmodel`）
会被 REST 网关以 `invalid_model_error` 拒绝，但本地 CLI 的私有
`agent_chat_generation` 路径能服务它们。插件对这批模型改用 CLI：

```
qodercli -p --no-session-persistence -m <model> -o stream-json "<prompt>"
```

`-o stream-json` 是关键：CLI 每行吐一个 JSON 事件，并在**单次 `-p` 调用内**
跑完自己的工具循环（`tool_use` → 执行 → `tool_result` → 最终 `text`）。

> ⚠️ **CLI 通道下工具调用会降级为文本进度提示**（形如 `[qoder-cli: ran Bash, Read]`），
> **不会**发标准 OpenAI `tool_calls` 帧。
>
> 原因是结构性的：`-p` 是一次性进程，它跑完工具循环就退出了。
> 若把 `tool_use` 译成 `tool_calls`，调用方会去执行工具并等待结果，
> 而**那个进程已经不存在了 → 死锁**。
>
> ⇒ **需要用真工具调用的场景，请选用 REST 通道的模型**
> （`kmodel` / `gmodel` / `dmodel` / `mmodel` / `auto`）。

## 凭据是怎么读出来的

Qoder 桌面端用 Electron `safeStorage` 存凭据。Windows 上的形态是：

1. `Local State` → `os_crypt.encrypted_key`（base64，前 5 字节是 `DPAPI`）
2. 去掉前缀后交给 DPAPI `CryptUnprotectData`(CurrentUser) → 32 字节 AES 密钥
3. `auth.v1.dat` = `v10`(3B) + nonce(12B) + ciphertext + tag(16B)，AES-256-GCM 解密
4. 得到 JSON：`{schemaVersion, token, refreshToken, expiresAt, refreshTokenExpiresAt, user}`

DPAPI 是用 **koffi 在进程内**调的。不从进程外调 PowerShell，因为 DSH 运行时拒绝与子进程
之间走管道 stdio，那种设计在终端里能跑、在 harness 里跑不了。

**设备码登录**（不依赖桌面端）：与 Qoder 桌面端同款的 PKCE 流程——
生成 `verifier`（64 字符，RFC 7636 非保留字符集）→ `challenge = base64url(sha256(verifier))`
→ 浏览器打开 `https://qoder.com/device/selectAccounts?challenge=…&challenge_method=S256&nonce=…&machine_id=…&client_id=…`
→ 插件每 1 秒轮询 `https://openapi.qoder.sh/api/v1/deviceToken/poll`（404 = 未完成，5 分钟超时）
→ 成功后再取 `GET /api/v1/userinfo` 组装凭据文档。`verifier` 只存在于宿主进程内存，
浏览器永远接触不到令牌材料。端点与参数均从 Qoder 桌面版 bundle 实测提取，
证据见 [`docs/QODER-PROTOCOL.md`](docs/QODER-PROTOCOL.md) §2.6。

## 已知限制

- **主测环境是 Windows + Web profile。** macOS / Linux 的候选目录写了但未实测。
- **令牌刷新未实现**：`refreshCredential()` 原样返回。设备码登录给出的 token 距到期有 30 天，
  桌面端登录态更长；刷新端点的请求体已从 bundle 挖出（`docs/QODER-PROTOCOL.md` §2.5）但**未实测过**，
  **不猜协议**。过期后表现为一次正常的 401，重开 Qoder 端或在卡片里重新登录即可。
- **`efficient` 可能无后端**：网关认得这个键（不是 `invalid_model_error`），
  但实测中多次回 `429 provider_error / All backends failed`。卡片上标「不可用」，
  gate 探测会按账号动态修正这一标记。
- **模型目录不是实时拉取的**：Qoder 的 `/api/v2/model/list` 列表端点无法直接联网拉取——
  `api2-v2.qoder.sh` 上实测 404；端点选举出的 `api3.qoder.sh` 上返回 403 Signature invalid
  （见下「故障排查」对该错误的分析）。目录来自上面说的三层结构（本地缓存解密 →
  随包快照 → 内置最小集）；快照时代无法逐账号核实的键以 gate 探测的实测结果修正
  （见「每账号 gate 自动探测」）。
- **未测图片输入**：所有模型只声明 `text`。没有实测过任何一次图片请求，
  声明 `image` 会让 DSH 把图片发给可能拒收的模型。

## 故障排查

- **Qoder 状态显示「未登录」，但 Qoder IDE 里明明已登录**：
  IDE 与 CLI/插件用的是**两套独立凭据存储**——IDE 走
  `%APPDATA%\com.qoder.app.stable\auth.v1.dat`（Electron safeStorage 加密），
  CLI 设备流存储在 `~/.qoder/.auth/user`，插件自己的凭据在
  `$DSH_HOME/.qoder-cli-auth.json`；三者互不自动同步。
  **解决**：在设置卡片点一次「登录 Qoder」（设备码登录）即可。
- **模型标注「不可用」**：模型目录是服务器全量视角，但 chat 网关**按账号灰度放行**，
  部分模型（快照时代实测 8 个 rejected、`efficient` 429）对本账号直连被拒。
  **解决**：等灰度放开——每账号 gate 探测会自动按账号修正标记（24h 缓存）；
  或在任一装了 Qoder 的机器上重跑 `node tools/gate-catalog.mjs` 刷新探测与快照；
  期间可在 Qoder 客户端内使用该模型。
- **`Signature invalid`（403）**：仅影响 model/list 在线拉取实验（三层目录链不依赖它，
  不影响插件正常使用）。COSY 签名已能产出且**与 endpoint 绑定**——对 A host 计算的签名
  拿去请求 B host 必然 403。但实验已证明这不是"缺材料"：端点选举复刻本身 200 成功
  （匿名 sign 模式即可通过网关验签，证明 WASM 签名链路完整），且 umid 设备指纹
  （阿里聚安全 sgsdk.dll）已被证伪为嫌疑——WASM 签名上下文没有 umid 通道，
  官方客户端同样不带。当前结论：**模型列表路由策略未公开**，该路径对复刻通道不开放
  （官方 bundle 的 transport 层还注入了复刻面之外的特征）。实验数据见
  [`docs/experiment-endpoint-election.md`](docs/experiment-endpoint-election.md)。
- **设置卡片里的模型开关在操作时变灰**：这是正常的 busy 禁用态视觉反馈
  （写入请求进行中开关临时禁用），操作完成即恢复，不是故障。

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— **二次开发者指南**：模块划分、数据流、关键机制（三层目录 / gate 探测 / 凭据 failover）、扩展点（如何加模型 / 加数据源 / 改 UI）与已知限制。
- [`docs/QODER-PROTOCOL.md`](docs/QODER-PROTOCOL.md) —— Qoder 桌面版 worker bundle 的逆向规格：
  端点表、鉴权链路、chat 线格式、错误码、配额；全部偏移断言经机器校验（59 present + 4 absent 全绿）。
- [`docs/QODER-PROTOCOL-FINDINGS.md`](docs/QODER-PROTOCOL-FINDINGS.md) —— 实测台账，每条结论附证据来源。
- [`docs/experiment-endpoint-election.md`](docs/experiment-endpoint-election.md) —— 端点选举复刻与
  model/list 全链实验台账：选举 200 成功、403 隔离矩阵（14 条请求流水）与根因裁定。
- [`docs/ACCOUNT-UI-REFERENCE.md`](docs/ACCOUNT-UI-REFERENCE.md) —— 账号管理 UI 调研：CodeBuddy AccountCard 逐行分析 + 同类插件参照。
- [`docs/CODEBUDDY-ARCHITECTURE.md`](docs/CODEBUDDY-ARCHITECTURE.md) —— 架构对标的兄弟插件笔记。
- [`preview/qoder-card-interactive.html`](preview/qoder-card-interactive.html) —— 完整可交互界面预览（单文件零依赖）。

## 目录结构（二次开发）

```
lib/
├── index.js                    Cordis 插件入口：settings schema、shim 启动、provider 注册、catalog 引导
├── client.js                   浏览器端设置卡片（账号卡片 / 模型行 / 用量统计）
└── qoder/
    ├── constants.js            端点 / 路由 / 命名空间常量（全部带 VERIFIED 注释）
    ├── models.js               模型目录三层链 + degraded 标记 + allowlist 过滤
    ├── catalog-reader.js       本地目录解密（Qoder 官方 WASM 进程内调用）
    ├── catalog-snapshot.json   随包目录快照（三层链第 2 层）
    ├── quota.js                quota / usage / credits heatmap API 客户端（失败静默 null）
    ├── campaign.js             签到活动状态（/sash/api/v1/me/campaigns）
    ├── gate-cache.js           每账号 gate 探测缓存（24h TTL、原子写）
    ├── credential-failover.js  凭据多源遍历 + 1 token probe + 进程级 memo
    ├── credentials.js          IDE 桌面端凭据解析（safeStorage / DPAPI / AES-GCM，koffi 进程内）
    ├── wasm-credential-reader.js  CLI 凭据 WASM 解密（库化封装）
    ├── device-login.js         设备码登录（PKCE 全流程）
    ├── store.js                凭据存储（插件自有副本 vs 发现凭据取新者）
    ├── wire.js                 请求线格式（URL / Cosy-* 头 / body 规范化 / SSE 帧解析）
    ├── relay.js                上游客户端（错误分类：auth_error / rate_limit / server_error）
    ├── shim.js                 OpenAI 兼容回环 shim（安全边界见「它是怎么工作的」）
    └── web.js                  HTTP 路由（status 聚合 / 开关写入 / 登录 / 数据源并发拉取）
```

模块职责与数据流的完整说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 开发

```powershell
npm pack                  # 打包 tgz
node test\run-all.mjs     # 全量测试（离线套件必须全绿；live 套件需本机有 Qoder 登录态，缺失时显式 SKIP）
node test\verify-loads.mjs  # 宿主加载结构验证（必须在 DSH profile 环境下跑）
node tools\snapshot-refresh.mjs  # 刷新随包目录快照
```

## 免责声明

仅供个人学习研究，只驱动**使用者本人**已登录的 Qoder 账号。使用者需自行遵守 Qoder 的服务条款。
本项目与 Qoder 官方无任何关联，未获其授权或认可。

## License

[GPL-3.0](LICENSE)
