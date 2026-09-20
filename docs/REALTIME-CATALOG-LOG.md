# 实时模型目录接入 — 完成台账（2026-09-20）

## 结果：✅ 三层目录链完成 —— 无 Qoder 环境的裸机用户也能看到全部 17 个模型

### 目录解析链（buildCatalog，三层回退）

| 层 | 来源 | 条件 | 数量 |
|---|---|---|---|
| 1. local-cache | Qoder 客户端登录后写的 catalog-v6（WASM 解密） | 本机装过 Qoder 且登录过 | 17（最新鲜） |
| 2. bundled-snapshot | 随包分发的 `lib/qoder/catalog-snapshot.json`（2026-09-20 快照） | 无任何 Qoder 环境（裸机默认） | 17 |
| 3. fallback | FALLBACK_QODER_MODELS（实测最小集） | 快照资源也损坏/缺失（防御层） | 10 |

每条目带 `source` 字段标明来源层。**用户什么都不装、只登录插件，就能看到 17 个模型**。

### 可调用性（与目录展示分离）

chat 网关直连实测（gate-result.json）：**8 个 accepted**（auto/ultimate/performance/qmodel/
kmodel/gmodel/dmodel/mmodel），8 个 REJECTED（degraded 标注），1 个 UNKNOWN（efficient 429）。
被拒的 7+1 个 key 展示但不可调；未来服务端灰度放开后重跑 `node tools/gate-catalog.mjs` 即解锁。

### 快照更新机制

快照过期时：任一装了 Qoder 的机器跑 `node tools/gate-catalog.mjs`（顺带刷新本地缓存），
或直接用本机最新 catalog-v6 覆盖 `lib/qoder/catalog-snapshot.json` 后发版。

### 新增/修改文件（dsh-qoder-cli 仓库内）

| 文件 | 说明 |
|---|---|
| `lib/qoder/wasm/qoder_auth_wasm_bg.wasm` | Qoder 官方 auth WASM（298,606 B；审计无密钥/账号/机器信息） |
| `lib/qoder/catalog-reader.js` | 目录读取器（WASM 最小 glue；decryptCatalog/readLocalCatalog/rawModelToCatalogEntry） |
| `lib/qoder/models.js` | buildCatalog 三层链 + degraded 标记 + FALLBACK 修正（kmodel=Kimi-K2.8-Preview、mmodel ctx=1M） |
| `lib/qoder/catalog-snapshot.json` | 目录快照（120KB，2026-09-20，随包分发） |
| `test/wasm-encrypt-helper.mjs` | 测试加密 helper（Qoder agent 写） |
| `test/catalog-reader.test.mjs` | 8 用例全绿（Qoder agent 写） |
| `test/models-catalog.test.mjs` | 3 用例全绿（Qoder agent 写，用例3已按三层链更新） |
| `test/catalog-fixtures/catalog-1.1.58.json` | 解密目录明文 fixture |
| `test/catalog-fixtures/gate-result.json` | live gate 探测结果 |
| `tools/gate-catalog.mjs` | live 探测器（plugin 凭据 → CLI device-flow 凭据回退） |
| `tools/gate-wasm-helper.mjs` | 探测器 WASM helper |

### 测试终态（2026-09-20）

catalog-reader 8/8 ✓ · models-catalog 3/3 ✓ · core ✓ · device-login ✓ · shim ✓ · store ✓

### 分派工作流经验（Qoder agent，qfmodel 免费档）

- 通道：`qodercli-1.1.58.exe -p --no-session-persistence --dangerously-skip-permissions -m qfmodel "<任务>"`
- 必须 Start-Process + 文件重定向（`&` 管道调用被沙箱 EPERM）
- 任务书必须禁止 agent 跑命令（spawn cmd.exe → EPERM → CLI 崩溃）
- 我的 tool 调用 abort 会连坐杀子进程；login 类长驻进程必须用户终端跑

### 遗留

- [ ] npm pack 0.3.0 → `dsh plugin add` 官方通道升级 dsh-1 与本体
- [ ] 仓库 git init / 推 GitHub / tag（文档脱敏决策：docs/ 是否进公开库待用户拍板）

## 增补（2026-09-20 02:0x）：目录保鲜双层机制

### 1. 每账号 gate 修正（自动，无需用户操作）

- `lib/qoder/gate-cache.js`：登录后首次构建目录时，后台对全部 key 做一轮轻量探测
  （`max_tokens:1`，300ms 间隔），结果缓存 `$DSH_HOME/.qoder-cli-gate-cache.json`（24h TTL）。
- `buildCatalog({gateCache})`：该账号实测的 accepted/rejected **覆盖**快照时代的
  degraded 标注 —— 别的账号灰度放开的模型（如 qfmodel）自动从"不可用"变"可用"，
  反向亦然。探测失败静默，快照标注仍是兜底。
- index.js：`refreshCatalog()` 快路径先 `catalog.set`（选择器永不空），探测落地方案
  后二次 set 刷新。

### 2. 众包目录分享（显式 opt-in）

- 设置卡片（登录后）新增「Share catalog via GitHub」区块：说明文案 + 一键按钮。
- 点击 → `GET /plugins/dsh-qoder-cli/catalog-dump`（loopback 双验，产品数据脱敏：
  仅 id/name/contextWindow/maxTokens/input/reasoning/efforts/degraded/source，
  无凭据、无 uid、无机器信息）→ 打开预填好的 GitHub Issue 页 → 用户确认提交。
- 仓库地址：`lib/client.js` 的 `CATALOG_SHARE_ISSUE_URL` 常量（当前占位
  YOUR-NAME，仓库建立后替换）。用户浏览器无 GitHub 登录态时按钮无害（打开登录页）。
- 合并流程（仓库主手动）：收到 issue → 校验 JSON → 与现快照 diff → 有增量就更新
  `lib/qoder/catalog-snapshot.json` 发版。每天一个人上传即可全量保鲜。

### 增补文件

| 文件 | 说明 |
|---|---|
| `lib/qoder/gate-cache.js` | 每账号探测缓存（TTL 24h、原子写、mock 可测） |
| `lib/qoder/wasm-credential-reader.js` | 库版 WASM 凭据读取（CLI 存储回退用） |
| `lib/qoder/constants.js` | +QODER_CATALOG_DUMP_PATH |
| `lib/qoder/web.js` | +catalogDumpHandler（loopback 双验 + 数据脱敏） |
| `lib/client.js` | +分享区块（opt-in，GitHub issue 预填） |

### 验证

- gate-cache 单元验证：读写往返/expiry/探测分类/dedup 全 PASS
- wasm-credential-reader：真机 CLI 凭据解密 OK
- buildCatalog gate 三态（无缓存/accepted 覆盖/rejected 覆盖）全 PASS
- verify-loads 5/5（DSH runtime 依赖图）+ 全量离线测试全绿