# ARCHITECTURE — dsh-qoder-cli 架构文档（二次开发者指南）

> 面向二次开发者。每个模块的导出面与行为均对照 `lib/` 实际代码核实；带「VERIFIED/实测」字样的结论出自 `docs/QODER-PROTOCOL.md`（机器校验的逆向规格）与 `docs/QODER-PROTOCOL-FINDINGS.md`（实测台账）。

---

## 1. 模块划分

```
lib/
├── index.js                    Cordis 插件入口（宿主侧装配）
├── client.js                   浏览器端设置卡片
└── qoder/
    ├── constants.js            端点/路由/命名空间常量（全部带 VERIFIED 注释）
    ├── models.js               模型目录三层链 + degraded 标记
    ├── catalog-reader.js       本地目录解密（Qoder 官方 WASM 进程内调用）
    ├── quota.js                quota/usage API 客户端
    ├── gate-cache.js           每账号 gate 探测缓存（24h TTL）
    ├── credential-failover.js  凭据多源遍历 + probe + memo
    ├── credentials.js          IDE 桌面端凭据解析（safeStorage/DPAPI/AES-GCM）
    ├── wasm-credential-reader.js  CLI 凭据 WASM 解密（库化封装）
    ├── device-login.js         设备码登录（PKCE 全流程）
    ├── store.js                凭据存储（插件自有副本 vs 发现凭据，取新者）
    ├── wire.js                 请求线格式（URL/头/ body 规范化、SSE 帧解析）
    ├── relay.js                上游客户端（QoderUpstreamClient，错误分类）
    ├── shim.js                 OpenAI 兼容回环 shim
    ├── web.js                  HTTP 路由（状态/开关/模型选项/登录/分享）
    └── catalog-snapshot.json   随包目录快照（三层链第 2 层）
```

### 各模块职责与关键导出

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `index.js` | Cordis 装配：settings schema、shim 启动、provider 注册（`ctx.llm.registerAdapter` + `registerConfigurableProviders`）、web 路由挂载、catalog 引导 | `apply(ctx)`（插件工厂） |
| `client.js` | 浏览器端卡片：账号卡片（头像/剩余 Credits/资源明细展开）、模型开关行、用量统计；通过 6 条 `*_PATH` 与宿主通信 | ModuleLoader 工厂（`id: 'dsh-qoder-cli'`） |
| `models.js` | 三层目录链 + degraded 修正 + allowlist 过滤 | `buildCatalog(options)` / `FALLBACK_QODER_MODELS`(10 键) / `REJECTED_QODER_KEYS` / `filterEnabledModels` / `toPiModel` |
| `catalog-reader.js` | 从 Qoder 官方 `qoder_auth_wasm_bg.wasm` 进程内解密本地目录 `~/.qoder/.models/<uid>/catalog-v6`（AES-GCM，密钥=uid），零网络零签名 | `readLocalCatalog()` / `decryptCatalog(b64, uid)` / `rawModelToCatalogEntry(raw)` / `initAuthWasm()` |
| `quota.js` | `GET /api/v2/quota/usage`（VERIFIED §5.1）；**任何失败静默返回 null**（display-only 数据不许弄断 status 路由） | `fetchQuotaUsage(token, {region, fetchImpl})` / `QODER_QUOTA_USAGE_PATH` |
| `gate-cache.js` | 每账号 chat 网关可达性：1 token 探测（间隔 300ms），结果缓存 `$DSH_HOME/.qoder-cli-gate-cache.json`，TTL 24h，原子写（temp+rename） | `loadGateCache` / `saveGateCache` / `probeCatalog` / `resolveProbeToken` / `GATE_CACHE_TTL_MS` |
| `credential-failover.js` | 请求遇 401/403/invalid_model_error 时遍历备用凭据；probe 通过者 memo 化进程生命周期 | `findWorkingCredential` / `isCredentialFailure` / `FAILOVER_KINDS` / `resetFailoverMemo`（测试钩子） |
| `credentials.js` | IDE 桌面端凭据：`auth.v1.dat` = v10+nonce+ciphertext+tag，AES-256-GCM；`Local State` DPAPI 解 32 字节密钥（koffi 进程内，不走子进程管道——DSH 运行时禁止） | `discoverCredential` / `decryptSafeStorage` / `extractSafeStorageKey` / `parseQoderCredential` |
| `device-login.js` | PKCE 设备码流：verifier(64 字符 RFC 7636)→challenge S256→`qoder.com/device/selectAccounts`→轮询 `deviceToken/poll`（1s，5 分钟超时）→`userinfo` 组装凭据 | `createDeviceLoginAttempt` / `waitForDeviceToken` / `buildCredentialFromDeviceLogin` |
| `store.js` | 插件自有凭据副本（`$DSH_HOME/.qoder-cli-auth.json`）与发现凭据**取 mtime 新者**；刷新降级（refresh 抛错→用缓存 token） | `QoderCredentialStore` / `QoderNotSignedInError` / `isStale` |
| `wire.js` | 线格式：chat URL（`QODER_MODEL_SERVER_HOST` 可覆盖，兼容 scheme/尾斜杠）、Cosy-* 头族、body 规范化（坏 JSON 抛错不发）、SSE 帧判定 | `qoderChatUrl` / `qoderHeaders` / `prepareChatBody` / `parseSseDataFrame` |
| `relay.js` | 上游客户端：非 2xx 分类（401/403→auth_error、408/429→rate_limit、5xx→server_error）+ in-band 错误帧提取 | `QoderUpstreamClient`（`chatStream`）/ `classifyUpstreamStatus` / `KIND_STATUS` |
| `shim.js` | 本机回环 HTTP 服务：只绑 127.0.0.1 随机端口；进程内随机 bearer（常数时间比较）；Host/Origin 双回环校验防 DNS rebinding；补 Cosy-* 头转发；凭据 failover 钩子 | `createQoderShim`（`ready/baseUrl/token/chat`）/ `hostIsLoopback` / `originIsLoopback` |
| `web.js` | 设置卡片的数据面：status 聚合（account+models+quota 并发拉取，quota 失败静默）、allowlist/模型选项写路由（loopback Host+Origin+JSON content-type 三重校验）、设备码登录 registry、目录分享 dump（脱敏） | `buildStatus` / `registerQoderRoutes` / 各 handler |

### 前后端通信契约

| 路由（constants.js） | 方法 | 用途 |
|---|---|---|
| `/plugins/dsh-qoder-cli/status` | GET | 卡片聚合状态（含 `quota`，t15 起并发拉取） |
| `/plugins/dsh-qoder-cli/enabled-models` | POST | allowlist 写入（id 与 live catalog 求交） |
| `/plugins/dsh-qoder-cli/model-options` | POST | 每模型 contextLabel / thinkingEffort |
| `/plugins/dsh-qoder-cli/auth/start` `auth/poll` | POST / GET | 设备码登录起停与轮询 |
| `/plugins/dsh-qoder-cli/catalog-dump` | GET | 脱敏目录分享（无凭据/uid/机器信息） |

---

## 2. 数据流

### 2.1 模型请求流（chat）

```
DSH 模型选择器
  → pi-ai provider（index.js 注册，id=qoder-cli）
    → shim（127.0.0.1 随机端口，OpenAI Chat Completions 形态）
      ├─ bearer 校验（进程内随机密钥，常数时间比较）
      ├─ Host/Origin 回环校验
      ├─ prepareChatBody（model/messages 保真，坏 JSON 400）
      ├─ store.resolve()：插件副本 vs 发现凭据取新者
      │    └─ 失败且 isCredentialFailure → findWorkingCredential（failover walk）
      ├─ relay.chatStream → wire.qoderChatUrl + qoderHeaders（Cosy-* 头族）
      └─ api2-v2.qoder.sh（SSE 原样透传；in-band 错误帧→对应 HTTP 状态）
```

**为什么必须有 shim**：Qoder 网关要求每请求带 `Cosy-ClientType` / `Cosy-Version` / `Cosy-MachineId` 动态头，pi-ai provider 描述符只能设静态头。shim 在回环层补齐。

### 2.2 卡片数据流

```
浏览器卡片（client.js）
  → GET /status
    → web.buildStatus：
        store.resolve() → account（user_id/name/email/avatar_url/expires_at）
        └─ 同时并发 fetchQuotaUsage(token) → quota（失败→null，字段整体缺省）
  → 渲染：账号卡片（头像/剩余 Credits/资源明细展开）+ 模型行（开关/下拉/徽章）

开关/下拉变更
  → POST /enabled-models 或 /model-options（loopback 三重校验）
    → settings.update(qoder-cli 命名空间)
```

### 2.3 目录引导流

```
index.js refreshCatalog()（启动时）：
  buildCatalog({dshHome, gateCache}) → catalog.set（快路径，选择器永不空）
  └─ 无有效 gateCache 且未在探测中 → 后台 probeCatalog → saveGateCache
     → buildCatalog(带探测结果) → catalog.set（二次刷新，degraded 按本账号修正）
```

---

## 3. 关键机制

### 3.1 三层模型目录回退（models.js `buildCatalog`）

| 层 | 来源 | 条件 | 规模 |
|---|---|---|---|
| 1 local-cache | Qoder 客户端写的 `catalog-v6`（WASM 进程内解密） | 本机装过 Qoder 且登录过 | 最新鲜（实测 17） |
| 2 bundled-snapshot | `lib/qoder/catalog-snapshot.json`（随包分发） | 无 Qoder 环境（裸机默认） | 17 |
| 3 fallback | `FALLBACK_QODER_MODELS` 硬编码 | 上两层损坏/缺失（防御层） | 10（逐个实测被网关接受的键） |

每层包 try/catch，任何失败降级到下一层——**目录出任何问题都不允许 provider 失效**。快照时代无法逐账号核实的键带 `degraded` 备注（`REJECTED_QODER_KEYS` 是实测被拒的记录，非猜测缺失）。

### 3.2 gate 探测（gate-cache.js + index.js）

- **动机**：服务器目录是全账号视角，chat 网关按账号灰度放行（如 `efficient` 长期 429 NO_BACKEND）。
- **做法**：后台对每个 key 发 1 token 探测（`PROBE_INTERVAL_MS=300` 温和间隔），结果三态 `accepted / rejected / unknown`。
- **缓存**：`$DSH_HOME/.qoder-cli-gate-cache.json`，TTL 24h（`GATE_CACHE_TTL_MS`），原子写。
- **修正语义**（models.js）：本账号实测 `accepted` **覆盖**快照时代的 degraded 备注（别的账号放开的模型自动"变可用"），反向亦然；探测失败静默，快照标注兜底。
- **并发安全**：`gateProbing` 闭包标志在 spawn 前同步置位（无 await 间隙，同 tick 不可能双开）；`stopped` 守卫覆盖整条异步链，`finally` 必然复位（t7 审查实测确认）。

### 3.3 凭据 failover（credential-failover.js）

- **触发**：上游 401/403 或 body 含 `invalid_model_error`（`isCredentialFailure`；注意 200 body 引用该词**同样**算失败——status-blind 设计）。
- **遍历序**：IDE 桌面 store（DPAPI）→ CLI 设备流 store（WASM AES）→ `QODER_CLI_AUTH_FILE` 显式文件（全部只读）。
- **probe**：1 token 真实 chat 请求，HTTP 200 才算通过。
- **memo**：胜者存进程级变量，后续请求跳过遍历；`resetFailoverMemo()` 供测试复位。
- **降级**：全部失败时调用方的原始错误原样上抛（不吞）。

### 3.4 安全边界（shim.js / web.js）

- shim：随机端口 + 进程内随机 bearer（常数时间比较）+ Host/Origin 双回环（防 DNS rebinding）。
- web 写路由：loopback Host + loopback Origin + JSON content-type 三重校验；body 上限 64KiB。
- catalog-dump：产品数据脱敏（仅 id/name/窗口/档位/degraded/source，无凭据/uid/机器信息），用户显式点击才提交。

---

## 4. 扩展点

### 4.1 加新模型

模型目录**不硬编码在 UI**——改目录有三个入口（按优先级）：

1. **服务端新增**（无需改码）：本机装 Qoder 登录一次，`catalog-v6` 自动含新键；或跑 `node tools/snapshot-refresh.mjs` 刷新随包快照后发版。
2. **快照更新**：`lib/qoder/catalog-snapshot.json` 直接覆盖（scene 取 assistant > chat > app > qwake 首个非空）。
3. **fallback 层**：仅当新键在无快照环境也要可用时，往 `models.js FALLBACK_QODER_MODELS` 加条目——**必须先实测**网关接受该键；被拒键加入 `REJECTED_QODER_KEYS` 留档。

不需要动 client.js：模型行由 `status.models` 驱动，字段（reasoningEfforts/contextOptions/priceFactor/promotion/degraded）由 `rawModelToCatalogEntry` 从服务器原始条目自动映射。

### 4.2 加新数据源（参照 t15 quota 的接入方式）

t15 的五步是模板：

1. **协议核实**：确认端点在 `docs/QODER-PROTOCOL.md` 有 VERIFIED 记录（如 §5.1 `@18993360`）——不猜协议。
2. **新建客户端模块**（`lib/qoder/quota.js` 样板）：导出 `fetchXxx(token, {region, fetchImpl})`；**失败静默返回 null**（display-only 数据不许弄断 status）；camelCase/snake_case 双兼容解析（`pickQuotaBlock` 样板）。
3. **web.js buildStatus 并发接入**：`quotaPromise = fetchXxx(token).catch(() => null)`，与凭据解析并行；结果 `...(quota === null ? {} : { quota })` 条件展开——**字段整体缺省而非填假值**。
4. **前端降级**：client.js 读 `status.quota` 时逐字段判空（`num()` + `?? '—'`），缺失显示 '—' 而非 0。
5. **离线单测**：fetchImpl 注入 mock（web.test.mjs / t15 quota 契约用例样板）。

### 4.3 改 UI

- **设计参照**：`preview/qoder-card-interactive.html`（完整可交互四 tab 预览，样式值与 client.js 同步）。
- **实现位置**：全部在 `lib/client.js`（浏览器端，React `createElement`——无 JSX/TS 转换）。
- **主题适配守则**：中性色一律 `var(--dsw-alias-*, 降级种子)` 形态；**token 名必须先在主题体核实**（`D:\DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-client-ui-theme\lib\client.js`）——已实测发现 `--dsw-alias-label-error` / `--dsw-alias-fill-tertiary` 不存在（正确名：`--dsw-alias-state-error-primary`；fill 家族整体缺失）。语义色（促销绿/警示琥珀/错误红/头像六色）不跟随主题，保持硬编码。
- **React 内联样式限制**：不支持 `:hover` 伪类（用 state 驱动，参照 hoverId）；伪元素/伪类一律不可用。
- **离线验证**：client.js 不能在 node import，用 `test/client-layout.test.mjs` 的源码级断言 + `vm.Script` 解析模式。

### 4.4 加新宿主路由

`constants.js` 定义路径常量 → `web.js` 写 handler（写路由复用 `checkLoopbackPost`）→ `registerQoderRoutes` 注册（effect 内，随插件卸载自动清理）→ `client.js` 加对应 `*_PATH`。

---

## 5. 已知限制

| 限制 | 现状 | 影响 |
|---|---|---|
| **model/list 在线拉取不通** | `/api/v2/model/list` 全 host 实测 403 Signature invalid；签名已产出（WASM glue 闭环）但 umid 设备指纹（阿里聚安全 sgsdk.dll）疑未参与签名 info 加密，调查进行中（`docs/MODEL-LIST-SIGNATURE-LOG.md`） | 目录依赖三层链（本地缓存/快照/fallback）；服务端新增模型需快照刷新才能触达无 Qoder 环境用户 |
| **签到未接入** | 卡片签到按钮 disabled + title 说明；三态分支（ok/already/fail）已按 CodeBuddy 预留 | 用户无法在卡片内签到领积分 |
| **多账号存储未实现** | UI 已按多账号设计（卡片数组形态、「设为当前」按钮位、active 置顶排序点），但后端仅单账号（store.resolve 单凭据） | 当前恒显示一张卡；多账号需要 store 层扩展（多凭据持久化 + switch 路由 + 「写宿主成功才激活」语义，参照 docs/ACCOUNT-UI-REFERENCE.md 参照 B） |
| **令牌刷新未实现** | `refreshCredential()` 原样返回；刷新端点请求体已挖出（协议 §2.5）但未实测，**不猜协议** | token 过期表现为一次正常 401，重开 Qoder 端或卡片重新登录即可 |
| **主测环境 Windows + Web profile** | macOS/Linux 的候选目录写了但未实测 | 其他平台凭据发现路径未验证 |
| **未测图片输入** | 所有模型只声明 `text` | 声明 `image` 会让 DSH 把图片发给可能拒收的模型 |

---

## 6. 测试

```
node test/run-all.mjs          # 全量（离线套件必须全绿；live 需本机 Qoder 登录态）
node test/client-layout.test.mjs  # 卡片布局源码级断言（含负向仪器自检）
node tools/snapshot-refresh.mjs   # 刷新随包目录快照
node tools/gate-catalog.mjs       # live gate 探测（无凭据显式 SKIP）
```

离线 12 套件约 197 用例；live 套件（live-credential / e2e-live）需真实 Qoder 登录态，缺失时显式 SKIP。
