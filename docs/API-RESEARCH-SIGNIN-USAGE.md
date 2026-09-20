# 签到 API 与用量统计 API 调研报告（t18）

**任务**：调研 Qoder 的签到 API 与用量统计 API（用户提供关键线索：PC 客户端有"每日领取 100 credits"活动；用量统计在 https://qoder.com/account/usage 可查）。
**性质**：调研-only，**未改 lib/**；实验脚本在 `tmp/qoder-catalog/try10..12-*.mjs`（临时区）。
**方法**：①扫 PC 客户端 Electron 日志（`%APPDATA%\com.qoder.app.stable\logs\*\main.log`）→ 定位 `[Campaign]` 模块与请求原文；②扫 `app.asar`（分块 60MB/80MB）→ 提取 Campaign 服务类完整源码与 credits 统计端点；③用本机 CLI 凭据（Bearer）**真实请求全部发现端点**并记录 status/响应体。

---

## 0. 结论速览

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 签到 API 是否存在？ | ✅ **存在**：`GET https://openapi.qoder.sh/sash/api/v1/me/campaigns`（活动状态：claimable/claimStatus/benefit.amount=100 CREDITS）。**但领取动作不在 CLI/主进程可达的 REST 端点**——领取发生在 `campaignUrl`（`https://openapi.qoder.sh/growth-page/activity-iframe`）的 **iframe 活动页内**（网页侧流程），PC 客户端主进程只有状态查询与遥测 |
| 2 | 用量统计 API（今日/7天/月/按模型） | ⚠️ **部分可得**：credits 按天热力图 ✅（`/sash/api/v1/ai-conversations/credits-heatmap?days=N`，任意天数窗口，371 天全量验证）；credits 总量/峰值 ✅（`credits-summary`）；活跃天数 ✅（`seat-activity`）。❌ **没有按模型分解**——`me/usage` 十键中无任何 per-model 字段 |
| 3 | 资源包子项列表 | ❌ 无 API：`quota/usage` 与 `me/usage` 的 `dedicatedResourcePackages` 均 **null**（实测），个人账号无该结构；`addOnQuota.detailUrl` 指向的网页是唯一明细来源 |

---

## 1. 签到 API —— 已定位端点，领取动作有结构限制

### 1.1 活动状态端点（已验证 200）

```
GET https://openapi.qoder.sh/sash/api/v1/me/campaigns
headers: Accept: application/json
         Authorization: Bearer <token>
         User-Agent: Qoder
         Cosy-ClientType: 10        ← PC 客户端用 10；CLI 身份实测也能 200
         Cosy-Version: 0.3.4
         Cosy-MachineOS / Cosy-MachineHostname / Cosy-MachineId /
         Cosy-MachineToken / Cosy-MachineCode / Cosy-MachineType
```

**本机实测响应**（200，今天）：
```json
{"uid":"00000000-…","showCampaign":false,"claimable":false,"campaignUrl":"","campaigns":[]}
```

**PC 客户端日志中的历史响应**（活动进行时，`main.log @16655` 原文）：
```json
{"uid":"00000000-…","showCampaign":true,"claimable":false,"campaignUrl":"https://openapi.qoder.sh/growth-page/activity-iframe",
 "campaigns":[{
   "campaignId":"00000000-0000-0000-0000-000000000001",
   "campaignKey":"act-00000000-001",
   "actionType":"CLAIM_BENEFIT",
   "startAt":1789783200,"endAt":1789869540,
   "claimStatus":"CLAIMED",              ← UNCLAIMED 才可领
   "benefit":{"kind":"CREDITS","amount":100,          ← "每日 100 credits" 就是它
              "modelScope":{"modelSeries":"…"},
              "validity":{"mode":"RELATIVE_DAYS","days":30}},
   "placements":[{"type":"POPUP","campaignUrl":"…"},{"type":"USAGE","content":"…"}]}]}
```

### 1.2 领取动作：不在主进程 REST 面（关键裁定）

- **PC 客户端主进程 Campaign 服务类**（`app.asar` `@32790897` 起，已提取全文）只有两类网络方法：
  1. `getStatus()` → `GET /sash/api/v1/me/campaigns`（只读状态）；
  2. `getLimitedNumber()` → `GET /sash/api/v1/me/campaigns/client_launch_26/limited-number`（活动限量名额，实测 200：`{"hasNumber":true,"number":18199551,"createdAt":"2026-09-18T06:56:22Z"}`）。
- **没有任何 POST/PUT claim 端点**：`app.asar` 全文（139MB 分块扫描）中 `me/campaigns` 仅有上述 2 个变体；无 `claim`/`benefit/claim`/`claimBenefit` 路径字面量。
- **领取发生在 `campaignUrl` 的 iframe 页面内**：客户端用 `openSurface(webContentsId, {campaignUrl})` 打开 `https://openapi.qoder.sh/growth-page/activity-iframe`，由 `nativeCampaignRequestService` 给该 surface 注入 token 后，**由页面内网页代码**完成领取交互。
- 用户看到的 `claimable:false` + `claimStatus:"CLAIMED"`（本账号 9-18 已领过当期活动）与此一致。

**对实现的裁定**：
- ✅ **可以做"签到状态查询"**：`fetchCampaigns(token)` → 返回 `showCampaign/claimable/claimStatus/benefit.amount`，按钮三态（可领 `claimable:true`｜已领 `claimStatus:"CLAIMED"`｜无活动 `showCampaign:false`）。
- ❌ **不能做"一键领取"**：领取动作在活动 iframe 页内（网页登录态流程），CLI Bearer 直接 POST 无已知端点。诚实方案：按钮三态中的"可领"态点击时**打开 `campaignUrl`**（`window.open`），让用户在官方活动页完成领取——这与客户端自己的行为一致（客户端也是开 iframe）。
- ⚠️ 活动有窗口期（本例 `startAt/endAt` 仅约 24h），`campaigns:[]` 是常态；"每日 100 credits"是**活动制**（act-00000000-001），非长期固定功能。

### 1.3 试过但失败的路径（如实记录）

| 路径 | 结果 |
|---|---|
| `GET /api/v2/checkin` | 404 空 body |
| `GET /api/v1/checkin` | 404 `{"errorCode":"NotFound"…}` |
| `GET /api/v2/check-in`、`/api/v2/signin`、`/api/v2/user/checkin`、`/api/v2/quota/checkin` | 404 |
| app.asar 内搜 `check-in/sign-in/reward/claim-benefit/claimBenefit` | 0 命中 |
| bundle 全部 44 条 API 路径枚举 | 无任何 checkin/sign 路径 |

---

## 2. 用量统计 API —— 按天热力图可接入；按模型分解不存在

### 2.1 credits 按天热力图（✅ 推荐，能力超预期）

```
GET https://openapi.qoder.sh/sash/api/v1/ai-conversations/credits-heatmap?organization_id=&days=371
headers: 同 campaigns
```
**实测 200**（本机）：
```json
{"unit":"credits",
 "levels":[408.81,409.81,410.81,411.81],        ← 4 档渲染阈值
 "items":[{"date":"2026-09-18","value":408.8148625},{"date":"2026-09-19","value":0},…],
 "total":408.8148625,
 "year":2026}
```
- `days` 参数**任意**（371 是客户端常量；实测 `days=7` 也 200 且返回 7 条）→ **今日消耗 / 近 7 天 / 本月**都能从 items 聚合；
- 响应校验器（`eKe`，asar 内提取）确认契约：`unit==="credits"`、`levels` 恰 4 档递增、`items[]` 每项 `{date:"YYYY-MM-DD", value≥0}` 唯一日期、`total` 非负。

### 2.2 credits 摘要与活跃度（✅ 可一并接入）

```
GET /sash/api/v1/ai-conversations/credits-summary   → {"peakCredits":408.81,"peakDate":"2026-09-18","totalCredits":408.81,"unit":"credits"}
GET /sash/api/v1/ai-conversations/seat-activity     → {"cumulativeActiveDays":1,"currentConsecutiveDays":0,"lastActiveDate":"2026-09-18","maxConsecutiveDays":1}
GET /sash/api/v1/me/achievements                    → {"achievements":[]}
```
（三个都实测 200；summary 的 `totalCredits` 与 heatmap `total` 一致。）

### 2.3 按模型分解 —— ❌ 不存在（如实报告）

- `me/usage`（200）`qoderUsage` 十键：`userId/userType/usageType/totalUsagePercentage/isQuotaExceeded/expiresAt/upgradeUrl/userQuota/addOnQuota/isPlanQuotaProrated` —— **无任何 per-model 字段**；
- `quota/usage` 同构；
- asar/obf 全文检索 `modelUsage/modelBreakdown/perModel` 无此概念；
- **用量统计 tab 的"按模型条形图"无 API 支撑**，建议 UI 改为：**credits 按天条形图**（heatmap items 聚合 7/30 天，数据真实可得）替代"按模型"维度。

### 2.4 `me/usage` vs `quota/usage`（给前端的数据源选择）

两者计账数字相同（`userQuota/addOnQuota` 逐字一致）；`me/usage` 多 `upgradeUrl` + `isPlanQuotaProrated`，且企业账号的 detailUrl 语义在 `normalizeUsagePresentation` 里处理。**推荐前端统一用 `status.usage`（me/usage），`status.quota` 保留为兼容字段。**

---

## 3. 资源包子项列表 —— ❌ 无 API（如实报告）

- `quota/usage` 与 `me/usage` 实测 `dedicatedResourcePackages: null`、`orgResourcePackage: null`——个人账号无此结构；
- bundle 校验器显示该字段存在（企业账号才有）：`{id, available, …计账}`；
- `addOnQuota.detailUrl`（`https://qoder.com/account/usage`）**就是**官方的子项明细入口（网页登录态）；
- **裁定**：保持现有占位 + 「查看资源包明细 →」外链方案；企业账号后续若需要，再按 `dedicatedResourcePackages[]` 结构接入。

---

## 4. 给实现任务的建议拆分

| 项 | 端点 | 建议实现 |
|---|---|---|
| 签到状态 | `GET /sash/api/v1/me/campaigns` | `lib/qoder/signin.js`：`fetchCampaignStatus(token)` → `{showCampaign, claimable, claimStatus, benefitAmount, campaignUrl}`；web.js 挂 `status.campaign`；前端按钮三态：可领（点击 `window.open(campaignUrl)`）｜已领｜无活动 |
| 用量统计 | `credits-heatmap?days=N` + `credits-summary` + `seat-activity` | `quota.js` 加 `fetchCreditsHeatmap(token,{days})` / `fetchCreditsSummary(token)`；web.js 挂 `status.usage`（已有）+ `status.creditsTimeline`；前端四格改为：今日 credits / 近7天 / 本月 / 累计（来自 heatmap+summary），条形图按天 |
| 资源包子项 | 无 | 保持占位 + 外链（已有） |

## 5. 证据索引

| 证据 | 位置 |
|---|---|
| Campaign 请求原文（URL/头/响应） | `%APPDATA%\com.qoder.app.stable\logs\20260919-190351.302-6056-a069fbce\main.log` @16655（`[Campaign] 活动状态请求发出/返回`） |
| Campaign 服务类全文（无 claim 方法） | `app.asar` 头 60MB `@32790897`（`zJt="/sash/api/v1/me/campaigns"` 起的类定义，已通读） |
| credits-summary/heatmap/seat-activity 调用器 | `app.asar` `@29995223`–`@30001400`（`getAccountCreditsHeatmap`/`getAccountProfileMetrics`） |
| heatmap 响应校验器（字段契约） | `app.asar` `function eKe(`（`unit/levels[4]/items[{date,value}]/total`） |
| 全部实测请求 | `tmp/qoder-catalog/try10-usage-probe.mjs`、`try11-signin-probe.mjs`、`try12-heatmap.mjs`（输出见运行记录） |
