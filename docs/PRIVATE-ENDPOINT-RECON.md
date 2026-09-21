# 私有端点 `agent_chat_generation` 侦察报告

**任务**：t-(P0) 方案 B 先期侦察 —— 摸清私有 SSE 端点的请求格式与权限。
**执行者**：ds-a · **限时**：30 分钟（已完成）
**结论：可以打通传输与签名层（HTTP 200 + 有效 COSY 签名），但请求体格式尚未对齐 —— 需再一轮实验。**

---

## 0. 可行性结论（先给答案）

| 层 | 状态 | 证据 |
|---|---|---|
| **DNS / 传输** | ✅ 可用 | 直连 `api3.qoder.sh` 成功，无需 HTTPDNS |
| **端点存在** | ✅ 存在 | HTTP 200，`content-type: text/event-stream;charset=UTF-8` |
| **COSY 签名** | ✅ 被接受 | `prepareInferRequest` 产出的 `Bearer COSY.<jwt>` 未触发 401/403 |
| **请求体格式** | ❌ **未对齐** | 服务端保持连接但**不吐任何 SSE 数据**（25 秒零字节） |
| **`prepareRequest` 路径** | ❌ 不适用 | 同一端点用 `prepareRequest` 签名 → SSE 体内 `{"code":"101","message":"Signature invalid"}` |

**总体判断：值得继续（方案 B 可行），但还差"最后一块拼图"——正确的请求体。**
关键突破是：**必须用 `qodercontext_prepareInferRequest`（不是 `prepareRequest`）**，它才会产出服务端认可的 `Bearer COSY.*` 签名；这一点此前未知。

---

## 1. 请求体字段结构（从 obf 提取，含行号）

**来源**：`D:\Qoder\resources\app.asar.unpacked\node_modules\@qoder-ai\qoder-agent-sdk\dist\_worker\qoder-worker-runtime.obf.mjs`（33,492,358 字符）

### 1.1 关键常量与函数定位

| 目标 | 命中数 | 字符偏移 |
|---|---|---|
| `/algo/api/v2/service/pro/sse/agent_chat_generation` | 1 | @4,080,792 |
| `sendRemoteChatAsk` | 4 | @3,825,045 / @8,735,666 / @8,736,989 / @8,737,262 |
| `qodercontext_prepareRequest` | 1 | （wasm 导出） |
| `model_config` | 24 | @4,159,144 起 |
| `prepareRequest` | 25 | — |

### 1.2 端点的两处出现（重要）

1. **@4,080,792** — 一个**白名单判断**：
   ```js
   function ltc(A){let e=A.path??"";return!(!e.includes("/algo/api/v2/service/pro/sse/agent_chat_generation")
     &&!e.includes("/model/v1/chat/completions"))}
   ```
   ⇒ 该端点与 `/model/v1/chat/completions` 被并列为**"需要特殊处理的两条请求路径"**。

2. **@8,735,666** — 真正的发送逻辑：
   ```js
   {operation:"sendRemoteChatAsk", route:g}), B=$Xt(c,g), Q=JSON.stringify(A),
    E=A.model_config?.key??"unknown", I=A.model_config?.source??"system"
   ...
   let I=await To({beforeSend:l, operation:"sendRemoteChatAsk", endpointType:"infer",
     method:"POST", requestClass:"infer-sse", url:u.url, ...
     injectClientIdentityHeaders:!n.isServiceAccount(),
     init:{method:"POST", headers:Q, body:u.body, signal:t}, contract:i, ...})
   ```
   ⇒ 路由契约：`operation=sendRemoteChatAsk`、`endpointType=infer`、`requestClass=infer-sse`、`addressFailover` + `preRequestAddressFailover` 均为真。

### 1.3 请求体构造器（@8,814,500 附近，函数 `A6e`）

```js
return {
  request_id: s,
  request_set_id: o?.requestSetId ?? s,
  chat_record_id: s,
  ...void 0!==o?.customContext ? { custom_context: o.customContext } : {},
  session_id: n,
  ...void 0!==o?.sourceSessionId ? { source_session_id: o.sourceSessionId } : {},
  stream: true,
  chat_task: "FREE_INPUT",
  chat_context: S,                 // ← S = jJc(WJc(E), a, l.is_reasoning)
  is_reply: true,
  is_retry: false,
  source: 1,
  version: "3",
  agent_id: "agent_common",
  task_id: o?.taskId ?? OJc(m?.type) ?? o?.policyTaskId ?? "common",
  session_type: process.env[ybA] ?? (og() ? KVe : yPA),
  aliyun_user_type: "",
  model_config: l,
  custom_model: g,
  system: d,
  messages: E,
  tools: o?.tools ?? [],
  parameters: h,
  ...o?.patches && Object.keys(o.patches).length>0 ? { patches: o.patches } : {},
  ...void 0!==m ? { business: m } : {},
}
```

**`parameters`（变量 `h`）的来源**（同函数上文）：
- `h = eOA(o?.generation)` — 由 generation 选项初始化
- `max_tokens` ← `q8(o.maxOutputTokens)` 或由模型 `max_output_tokens` 兜底
- `reasoning_effort` / `enable_thinking` / `reasoning_budget_tokens` — 由模型能力（`efforts`、`supports_disabled`）与请求选项共同决定
- `context_length` — 由 `o?.contextWindow` 且通过 `TZ(u, o.contextWindow)` 校验后写入

**`chat_context`（变量 `S`）** = `jJc(WJc(E), a, l.is_reasoning)` —— 由 messages + 模型 key + 是否 reasoning 三者派生，**不是**简单的 `{version:"3"}`。

### 1.4 与已复刻的端点选举一致

`region/endpoints` 命中 2 处、`inferNodes` 命中 1 处，与任务书给出的一致：
`GET https://center.qoder.sh/algo/api/v3/service/region/endpoints → inferNodes:["https://api3.qoder.sh"]`

---

## 2. 签名要求判断

**结论：需要 COSY 签名，且必须是"infer 专用"签名。**

实验对照（同一端点、同一凭据）：

| 签名方法 | 结果 |
|---|---|
| `qodercontext_prepareRequest(ctx, host, path, 'POST', 'auth', body)` | HTTP 200，但 SSE 体内 `{"code":"101","message":"Signature invalid"}`，`statusCodeValue:403` |
| `qodercontext_prepareInferRequest(ctx, host, path, body)` | HTTP 200，`Authorization: Bearer COSY.<jwt>`，**无 Signature invalid** |
| `authMode='none'`（去掉 Authorization） | 与 'auth' 同样收到 Signature invalid（说明不是"缺头"问题，是**签名算法/材料不对**） |

**证据**：obf 里真实客户端用的是 `prepareInferRequest`：
```js
function ari(A,e,t,i,n){ if(n.isServiceAccount()) return cri(n,"text/event-stream",n=>n.prepareInferRequest(A,e,t,i));
  let r=Wd(n=>n.prepareInferRequest(A,e,t,i)); return {url:r.url,headers:gd(r.headers),body:r.body,free:...} }
```

**产出差异**（实测）：
- `prepareRequest` → 19 个 COSY 头（`Cosy-Key`/`Cosy-User`/`Cosy-MachineToken` …），但服务端判定签名无效
- `prepareInferRequest` → `Accept: text/event-stream`、`Content-Type: application/json`、`Authorization: Bearer COSY.<jwt>`，且 URL 自动附上
  `?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`

⇒ **`FetchKeys=llm_model_result` 与 `AgentId=agent_common` 是签名时由 WASM 自动附加的**，调用方不需要拼。

---

## 3. 最小实验结果（原始请求 + 原文响应）

**脚本**：`D:\DSH\tmp\recon2.mjs`（复用 `try3.mjs` 的 wasm glue，仅新增 `prepareInferRequest`/`rrBody` 绑定）
**输出**：`D:\DSH\tmp\recon-endpoint-out.txt`

```
=== A. prepareInferRequest + our JSON ===
  url: https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1
  auth: Bearer COSY.eyJ2ZXJzaW9uIjoidjEiLCJyZXF1ZXN0SWQiOiI4NTBhOGMzYy0zZTllLT...
  HTTP 200
  ERR: This operation was aborted          ← 25 秒内 SSE 未吐出任何数据
```

**响应头（原文）**：
```
content-type: text/event-stream;charset=UTF-8
cache-control: no-cache
connection: keep-alive
ga-request-id: 0fe710666fdbd40097b1df5caf108793
entry-timestamp: 1789879860699   req-cost-time: 5   resp-start-time: 1789879860703
```

**对照组（`prepareRequest` 签名）响应体原文**：
```
data:{"headers":{"Content-Type":["application/json"]},"body":"{\"code\":\"101\",\"message\":\"Signature invalid\"}","statusCodeValue":403,"statusCode":"FORBIDDEN"}
```

**读法**：用 `prepareInferRequest` 时**没有**再出现 `Signature invalid` —— 说明签名已过关；服务端接受了请求并在等"后续数据"，但**从不吐帧**，这与"请求体形状不对、服务端无法开始生成"一致。

---

## 4. 未解的问题（下一轮要打的点）

1. **`chat_context` 的确切形状**：obf 里是 `jJc(WJc(E), a, l.is_reasoning)`，需要反查 `WJc`/`jJc` 两个函数体。
2. **`parameters` 的完整字段集**：`h` 由 `eOA(generation)` 初始化，需反查 `eOA` 的默认值。
3. **`session_type` 的取值**：`process.env[ybA] ?? (og() ? KVe : yPA)` —— `ybA`/`KVe`/`yPA` 都是混淆名，需回溯。
4. **是否还需要 `business`/`patches`**：二者都是条件字段，但真实 CLI 走的是 agent 链路，**很可能带 `business`**。
5. **`prepareInferRequest` 是否接受第 5 个参数**（`d`）：我们的绑定按 4 参数调用（`0,0` 传空），真实调用点是 `prepareInferRequest(A,e,t,i)` 四参 —— 与实测一致，但仍值得确认 `rrBody` 何时返回非 null（我们的调用抛 `null pointer passed to rust`，说明该字段对本构造为可选）。

> ⚠️ **`rrBody` 抛 `null pointer passed to rust` 是正常的**：说明 `prepareInferRequest` 的返回结果里 body 为空（由调用方自带 body）。不要把它当成故障。

---

## 5. 复现步骤

```powershell
node D:\DSH\tmp\obf-recon.mjs        # 字符串/上下文提取 -> obf-recon-out.txt + obf-recon.txt
node D:\DSH\tmp\recon2.mjs           # 端点最小实验 -> recon-endpoint-out.txt
```

**环境注意（本轮踩到的）**：
- DSH 沙箱**拒绝 `node <file> | ...` 管道**（`ResourceUnavailable`），也拒绝 `> file 2>&1` 重定向。所以脚本内部用 `appendFileSync` 自己写日志文件。
- Windows 下 ESM 动态 import 必须用 `file:///` URL；`data:` URL 里**不能**调 `createRequire(import.meta.url)`。
- HTTPDNS **未造成影响**，直连即可。

---

## 6. 给 captain 的建议

1. **方案 B 值得继续**：传输层、端点、签名三关已过，只剩请求体。
2. **下一轮 30 分钟的最优路径**：反查 `WJc` / `jJc` / `eOA` 三个函数体（都在同一个 obf 里，可用同一套偏移提取脚本），拼出真实 body，再发一次最小请求。
3. **抓包对照更快**：`C:\Users\Administrator\.qoder\logs\runs\...\qodercli.log` 第 250-262 行有真实请求；若日志含请求体摘要（或可开启 body 记录），可直接拿到 ground truth，省去逆向。
4. **风险提示**：该端点会消耗真实配额；建议继续用 `max_tokens: 16` 量级的最小请求试探。

---

*本报告为只读侦察，未修改 `lib/` 任何文件；所有实验脚本位于 `D:\DSH\tmp\`。*
