# qworker 调度器：把 qodercli 当外部工人批量派活

> 面向后续维护者。本文每条结论都标注了**实测证据来源**；没有实测的一律写进 §7「未验证」。
> 证据基线日期：**2026-09-21**。工具实现：`D:\DSH-ZJ\qworker.mjs`（682 行）。

---

## 0. 一页速览

| 问题 | 结论 | 依据 |
|---|---|---|
| 免费模型能走 REST 吗？ | **不能**。`qfmodel` / `qmodel_38max` 被网关 `HTTP 400 invalid_model_error` 拒绝 | §1 |
| 那免费模型怎么用？ | 只能走 **CLI**（`qodercli -p -m qfmodel`）的私有对话通道 | §1 |
| CLI 能当 tool-calling agent 吗？ | **不能，会死锁**。工具循环在 CLI 进程**内部**闭环 | §2、§3 |
| 那 CLI 能干什么？ | 当**自包含工人**：给任务 → 它自己用工具 → 返回最终答案 | §2 |
| 花钱吗？ | **不花**。`credits=0`、`price_factor=0`、`billable:false` | §6 |
| 怎么批量用？ | `qworker.mjs`：单任务 + plan DAG（依赖排序 / 并发 / 结果前传） | §4 |
| 和 AgentTeams 什么关系？ | 成员用 bash 调 qworker 派活，**qodercli 是外部工人，不是团队成员** | §5 |

---

## 1. 为什么免费模型只能走 CLI

### 1.1 实测：REST 网关拒绝免费 key

探针 `D:\DSH-ZJ\_rest.mjs` 直接对 `https://api2-v2.qoder.sh/model/v1/chat/completions`
发同 token、同 body（`{"model": <key>, "messages":[{"role":"user","content":"hi"}], "stream":false, "max_tokens":1}`），
逐 key 对比。原始输出 `D:\DSH-ZJ\_restout.txt`：

```
qfmodel        HTTP 400  REJECTED
      {"code":"invalid_model_error","message":"Unsupported model \"qfmodel\"","request_id":"f520594e6453-52e9-c5d4-996a-a996f512","type":"invalid_model_error"} 
qmodel         HTTP 200  SERVED
qmodel_38max   HTTP 400  REJECTED
      {"code":"invalid_model_error","message":"Unsupported model \"qmodel_38max\"","request_id":"6c74eb98cfa4-9a5b-e414-f28d-180b2fdb","type":"invalid_model_error"} 
```

复跑命令：

```powershell
cd D:\DSH-ZJ; node _rest.mjs
```

### 1.2 读法：拒绝是**按 key**，不是按账号余额

关键区分：`qmodel` 同一时刻 **200**，说明 token 有效、网关可达、账号没被封。
被拒的只是 `qfmodel` / `qmodel_38max` 这两个 key 在 **REST 通道**上没有放行。

这一点在插件侧有独立佐证 —— `D:\DSH-ZJ\_msg7.txt`（提交说明）记录：

```
The usage endpoint returns

    userQuota : { total: 0,   used: 0, remaining: 0   }
    addOnQuota: { total: 200, used: 0, remaining: 200 }
    isQuotaExceeded: false
```

⇒ 账号里 200 积分分文未动，计费 key 却仍被拒。**这就是"免费 key 被 REST 拒绝、却仍可用"的证明**：
不是余额问题，是**通道 + key 的组合**问题。

### 1.3 结论：CLI 是免费 key 的唯一入口

免费 key 在 REST 上 400，但在 CLI 的私有对话通道（`agent_chat_generation`）上可用：
`qodercli -p -m qfmodel "..."` 正常出词（见 §6 的 credits 证据）。

**因此想用免费模型，就必须驱动 CLI，没有第二条路。**

> ⚠️ 别把这条读成"CLI 通道是 REST 的等价替代品"。它是**另一条通道**，
> 计费主体、能力边界、工具行为都与 REST 不同（§2、§3）。

---

## 2. CLI 工具循环在进程内部

这是整个设计的地基：**CLI 自己就是一个完整的 agent**，工具循环在 `-p` 进程内部闭环。

### 2.1 `num_turns ≥ 2`：多轮工具循环实测

`D:\DSH-WJ` 证据文件 `D:\DSH-ZJ\_loop.txt`（`qodercli -m qfmodel` 真实运行）：

```json
{"type":"assistant","message":{...,"stop_reason":"tool_use",...,"content":[
  {"type":"tool_use","id":"call_c75faca34f9d4746aa4a2db9","name":"Bash",
   "input":{"command":"find . -name \"*.mjs\" -type f | wc -l",...}}],...}}
...
{"type":"assistant","message":{...,"stop_reason":"end_turn",...,"content":[
  {"type":"text","text":"There are **454** `.mjs` files in the current directory."}],...}}
```

⇒ 一次 `-p` 调用里发生了 **`tool_use` → 工具真的执行 → `tool_result` → 最终 `text`**。
该次运行的收尾 `result` 事件（同文件 `_loop.txt`）直接给出轮数：

```json
{"type":"result","subtype":"success","duration_ms":6215,"is_error":false,
 "num_turns":2,"result":"There are **454** `.mjs` files in the current directory.",
 "stop_reason":"end_turn","total_cost_usd":0,"total_credits":0}
```

⇒ **`num_turns:2`**，且同一帧里 `total_credits:0`（成本见 §6）。
qworker 自己也在真实运行中观测到 `turns=2` 与 `turns=3`（§4.7）。

### 2.2 内置 31 个工具

`D:\DSH\tmp\p0-crypto\t10-cli-tools.md` §1 的 CLI 事件流探针原始输出：

```
EVENT {"type":"system","subtype":"init","tool_count":31}
```

原文结论：

> CLI 内置 **31** 个工具，**我们不需要实现任何工具**。

### 2.3 Write 真的落盘

`D:\DSH-ZJ\_w2.txt`（`qfmodel` 真实运行）三段连续事件：

```json
// ① 模型发出 Write
{"type":"assistant","message":{...,"content":[{"type":"tool_use",
  "id":"call_c737105d2e7b48078aa69bc2","name":"Write",
  "input":{"file_path":"D:\\DSH-ZJ\\_worker_proof.txt","content":"WORKER_OK"}}],...}}

// ② 工具真的执行了，返回真实文件系统结果
{"type":"user","message":{"role":"user","content":[{"type":"tool_result",
  "tool_use_id":"call_c737105d2e7b48078aa69bc2",
  "content":"File created successfully at: D:\\DSH-ZJ\\_worker_proof.txt"}]},...,
 "tool_use_result":{"success":true,"file_path":"D:\\DSH-ZJ\\_worker_proof.txt","bytesWritten":9,...}}

// ③ 模型收尾，且计费为 0
{"type":"result","subtype":"success",..."num_turns":2,...,
 "total_cost_usd":0,"total_credits":0,
 "modelUsage":{"qfmodel":{..."credits":0}}}
```

⇒ `Write` 不是被"声明"了，是**真的写了 9 字节到磁盘**（`bytesWritten:9`），
且 `success:true`。这证明 CLI 的工具**有真实副作用能力**。

### 2.4 设计含义

CLI 是一个 **自包含工人（self-contained worker）**：

```
qworker 把任务交给 CLI → CLI 自己规划 → 自己调 31 个工具 → 自己收尾 → 返回最终文本
```

调用方**不需要实现任何工具，也不需要参与循环**。这正是 qworker 能把它当批处理工人用的原因。

---

## 3. 为什么不能当 tool-calling agent（必然死锁）

**这是最容易踩的坑：不要试图把 CLI 的 `tool_use` 翻译成 OpenAI `tool_calls` 交给 harness。**

### 3.1 实测结论

`D:\DSH\tmp\p0-crypto\t10-cli-tools.md` §3「⚠️ 设计改判：为什么不发 `tool_calls`」原文：

> **A（发 tool_calls）的致命缺陷** —— 不是"可能有害"，是"必然悬空"：
>
> ```json
> {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,
>   "id":"call_0ea74a21fd3e4357afbb080e","type":"function",
>   "function":{"name":"Bash","arguments":"{\"command\":\"find . -name \\\"*.txt\\\" | wc -l\"}"}}]},
>   "finish_reason":null}]}
> ```
>
> 这是一个**语法完全合法**的 OpenAI `tool_calls` 帧 ⇒ harness 会**照单执行**，
> 然后等待回传 `tool_result`。但**产生该 call 的 `-p` 进程已经退出** ⇒ 回传无处可去 ⇒ **死锁 / 空转**。
> 即：A 的产物不是"多此一举"，而是**主动触发一个永远不会完成的状态机**。

### 3.2 死锁链路

```
CLI 进程: 发出 tool_use → 自己执行 → 自己拿到 tool_result → 收尾退出（num_turns=2，进程结束）
   ↓ 若把它翻译成 tool_calls 发给 harness
harness:  收到 tool_calls → 照单执行 → 等待 tool_result 回传
   ↓
需要回传的那个进程：已经退出了  ⇒  状态机永远停在"等待中" ⇒ 死锁
```

**根因**：`tool_use` 与 `tool_result` **本来就都发生在 CLI 进程内部**（§2.1），
循环已经跑完、`-p` 进程已经退出。再向外发一次 `tool_calls`，等于要求 harness
去完成一个**已经被完成、且执行者已消失**的握手。

### 3.3 已经做出的处置（有回归守卫）

该设计在插件侧已落地为**反向断言**（`D:\DSH\tmp\p0-crypto\t10-cli-tools.md` §5 变异自检）：

```
MUTATION 1 applied (re-introduce tool_calls)
  FAIL wrapAsSse: tool_use is NOT re-emitted as a harness-executable tool_calls frame
  FAIL wrapAsSse: tools-bearing request answers without a live tool_calls frame
== 18 passed, 4 failed ==
```

⇒ **谁把 `tool_calls` 发射器改回去，立刻 4 条红。** 这不是口头约定，是测试守卫。

> **给维护者**：如果你打算"让 qfmodel 当 DSH 成员"，先读本节。
> 那不是接线问题，是**工具循环归属权**的产品决策 —— 见 §5.4。

---

## 4. qworker 用法

工具：`D:\DSH-ZJ\qworker.mjs`。两种模式：**单任务**、**plan DAG**。

### 4.1 单任务模式

```powershell
node qworker.mjs --task "统计 D:\DSH-ZJ 下 .mjs 文件数" --cwd D:/DSH-ZJ --json
```

### 4.2 plan DAG 模式

```powershell
node qworker.mjs --plan D:\DSH-ZJ\_plan.json --concurrency 4 --out D:\DSH-ZJ\_qwork\final
```

### 4.3 plan JSON 格式

plan 是一个**对象数组**；`depends` 边决定派发时序，所以它是**真正的 DAG，不是队列**。
来自 `D:\DSH-ZJ\_plan.json`（真实使用过的文件）：

```json
[
  {
    "id": "survey-test-suite",
    "task": "Read D:\\DSH\\qoder-dsh-plugin\\test\\run-all.mjs and report exactly how it discovers and runs test files: ...",
    "cwd": "D:/DSH-ZJ"
  },
  {
    "id": "count-assertions",
    "task": "Count the total number of assertion statements across every *.test.mjs file in D:\\DSH\\qoder-dsh-plugin\\test. ...",
    "cwd": "D:/DSH-ZJ"
  },
  {
    "id": "synthesize",
    "task": "You are given three survey results about a test suite. Write a short brief (max 200 words) ... Base every claim ONLY on the provided results; if something is missing, say so rather than inventing it.",
    "depends": ["survey-test-suite", "survey-catalog-tests", "count-assertions"]
  }
]
```

字段（校验逻辑见 `qworker.mjs` 的 `validatePlan`，`:281`）：

| 字段 | 必填 | 类型 | 含义 |
|---|---|---|---|
| `id` | ✅ | 非空字符串，**全局唯一** | 任务标识。也是 `--out` 下的 `"<id>.md"` 文件名 |
| `task` | ✅ | 非空字符串 | 交给 CLI 的提示词 |
| `cwd` | ❌ | 字符串 | 该任务 CLI 的工作目录（Windows 下 `D:/x` 正斜杠写法可用） |
| `depends` | ❌ | 字符串数组 | 前置任务 id 列表；**数组顺序无关**，允许前向引用 |

### 4.4 依赖语义（核心）

来自 `qworker.mjs` 的 `runPlan` 实现（`:357`）与 doc 注释（`:346`）：

1. **只有全部前置成功，任务才派发**。任一前置未成功 ⇒ 该任务标 `BLOCKED`，
   **永不派发**（绝不"用缺失输入运行"）。
2. **阻塞传递**：`BLOCKED` 的下游同样 `BLOCKED`，逐级传播。
3. **失败隔离**：一个任务超时/非零退出，**不会取消**它无关的兄弟任务。
4. **结果前传**：前置的正文作为上下文拼进下游的 task：

   ```
   --- result of <dep> ---
   <该前置的正文>
   ```

   所以下游工人看到的是**前置真实产出**，而不是空。
5. **并发**：独立任务并发跑，上限 `--concurrency`。
6. **续跑**：`--out` 中已标 `status: OK` 的文件视为**已完成** —— 不重复派发（省额度），
   但**仍然**满足下游的 `depends` 边、**仍然**前传正文。打印 `RESUME <id>`。

### 4.5 全参数表

| 参数 | 默认 | 含义 |
|---|---|---|
| `--task "..."` | — | 单任务模式：要执行的提示词 |
| `--plan FILE` | — | plan DAG 模式：plan JSON 路径 |
| `--cwd DIR` | 当前目录 | 单任务模式的工作目录 |
| `--model KEY` | `qfmodel` | 模型 key（免费档） |
| `--concurrency N` | `4` | 并发工人上限（正数，否则 exit 2） |
| `--timeout MS` | `600000` | 单工人超时，**到期 SIGKILL**（正数，否则 exit 2） |
| `--out DIR` | — | 每任务落 `<id>.md`（status / exit_code / reason / tools / turns / duration_ms / depends / `## Task` / `## Result` / `## Stderr`） |
| `--json` | — | 单任务模式：打印原始结果对象 |
| `--plan-relaxed` | — | 已记录的 BLOCKED/FAILED **不**影响退出码（续跑安全） |
| `--thinking <mode>` | `disabled` | 默认关闭思考链（原因见 §6） |
| `--help` / `-h` | — | 用法 |

**退出码**（`qworker.mjs` `:40`）：

| 码 | 含义 |
|---|---|
| `0` | 所有任务 OK（或 `--plan-relaxed` 下失败是**此前**已记录的） |
| `1` | 至少一个派发过的任务失败 / 超时 / 被阻塞 |
| `2` | 用法或 plan 校验错误（stderr 报错，**不派发任何任务**） |

### 4.6 参数校验（exit 2，全部实测）

来自 `D:\DSH-ZJ\t1-HARDENING-EVIDENCE.md` §2.1 真实 CLI 路径实测：

```
$ node qworker.mjs --plan D:\DSH-ZJ\_no_such_plan.json
qworker: cannot read plan file "D:\DSH-ZJ\_no_such_plan.json": ENOENT        exit=2

$ node qworker.mjs --plan _tmp-cycle.json
qworker: dependency cycle: a -> b                                            exit=2

$ node qworker.mjs --plan _tmp-ghost.json
qworker: task "a" depends on unknown id "ghost"                              exit=2

$ node qworker.mjs --bogus
qworker: unknown argument "--bogus"                                          exit=2
```

覆盖：文件缺失 / JSON 非法 / 非数组 / 空数组 / 缺 `id` / 重复 `id` / 缺 `task` /
`depends` 非数组 / 依赖未知 id / 自依赖 / **成环**（Kahn 算法，**含环的传递下游**）/
`--concurrency` `--timeout` 非正数 / `--out` 指向文件。

### 4.7 真实端到端（4 任务 DAG）

`D:\DSH-ZJ\_qw-verify-live2.txt`：

```
qworker: 4 task(s), concurrency=4, model=qfmodel
cli: C:\Users\Administrator\.qoder\bin\qodercli\qodercli-1.1.58.exe

RUN      survey-test-suite  (model=qfmodel, cwd=D:/DSH-ZJ)
RUN      survey-catalog-tests  (model=qfmodel, cwd=D:/DSH-ZJ)
RUN      count-assertions  (model=qfmodel, cwd=D:/DSH-ZJ)
RUN      synthesize  (model=qfmodel)

[OK] survey-test-suite   tools=Read     turns=2 (13.5s)
[OK] survey-catalog-tests tools=Read    turns=2 (12.7s)
[OK] count-assertions    tools=Glob,Grep turns=3 (32.7s)
[OK] synthesize          turns=1 (12.3s)

4/4 succeeded
```

三个上游**并行**先跑；`synthesize` 最后跑，且其输出**同时引用了三个上游的正文**：

```
**Total assertion count:** 749 assertion statements across all test files ...
**What the catalog tests cover:** ... These tests validate the gate-catalog functionality.
```

⇒ **`depends` 生效、结果前传真实作用于真实任务**（不是 mock）。
注意 `count-assertions` 用了 `Glob,Grep` **两个**工具、`turns=3` —— 即 CLI 内部工具循环确实多轮。

### 4.8 离线测试与变异自检

```
$ node test/qworker.test.mjs       → == 37 passed, 0 failed ==  exit=0
$ node test/qworker.mutation.mjs   → == 14/14 mutants killed ==  exit=0
```

变异自检证明**测试能报红**（尺子本身有效），被杀变异体包括：未知依赖不拒、成环恒返回 null、
非数组 plan 接受、失败依赖不阻塞、worker 异常吞成 ok、超时不杀、并发上限忽略、
`is_error` 忽略、`num_turns` 写死、BLOCKED 覆盖旧正文、失败仍返回 0、
上下文不前传、续跑重复派发、续跑丢弃旧正文。（来源：`t1-HARDENING-EVIDENCE.md` §4.2）

---

## 5. 与 AgentTeams 的结合方式

### 5.1 一句话

**成员用 bash 调 qworker 派活；qodercli 是"外部工人"，不是团队成员。**

```
┌─────────────────────────────────────────────┐
│ AgentTeams（成员都是计费模型，有额度）        │
│                                             │
│  captain ──派任务──▶ member                 │
│                        │                    │
│                        │ bash:              │
│                        │ node qworker.mjs   │
│                        ▼                    │
│                  ┌───────────────┐          │
│                  │  qworker.mjs  │  ← 进程内 DAG 调度
│                  └───────┬───────┘          │
│                          │ spawn            │
└──────────────────────────┼──────────────────┘
                           ▼
              ┌────────────────────────────┐
              │ qodercli -p -m qfmodel ×N  │  ← 外部工人（免费，无 AgentTeams 身份）
              │ 各自内部 31 工具循环        │
              └────────────────────────────┘
```

### 5.2 具体做法

成员在自己的回合里执行：

```powershell
node D:\DSH-ZJ\qworker.mjs --plan D:\DSH-ZJ\_plan.json --out D:\DSH-ZJ\_qwork\batch1
```

- **并发批量**：plan 里一次放 N 个独立任务，`--concurrency` 控并发。
- **串行依赖**：用 `depends` 表达阶段性（先侦察 → 再汇总）。
- **结果回收**：读 `--out` 下的 `<id>.md`，或看 stdout 的 `[OK]/[FAIL]` 行。

### 5.3 为什么这样切分是对的

| | AgentTeams 成员 | qodercli 工人 |
|---|---|---|
| 身份 | 团队成员，有 mailbox / task / attempt | **无身份**，就是一个被 spawn 的进程 |
| 通信 | `agent_teams_*` 工具 | stdin/stdout + 退出码 |
| 计费 | 计费模型（有额度墙） | **`credits=0`**（§6） |
| 工具循环 | harness 提供 | **CLI 自己内部闭环**（§2） |
| 适合的活 | 需要协作、需回传、需长记忆 | **可并行、自包含**的调研/分析批处理 |

⇒ 分工原则：**协作与编排留在 AgentTeams，可并行的脏活外包给 CLI 工人。**

### 5.4 ⚠️ 这不是"让 qfmodel 当成员"

必须明确区分，否则会走进死路：

- ❌ **"把 qfmodel 注册成 AgentTeams 成员"** —— 做不到。
  成员是通过 harness 的模型通道驱动的；而 `qfmodel` 在 REST 上 `HTTP 400 invalid_model_error`（§1）。
  即使勉强接上，还会撞上 §3 的 `tool_calls` **必然死锁**。
- ✅ **"把 qodercli 当外部工人调用"** —— 可行，就是本文方案。
  CLI 进程退出时**已经给出最终答案**，调用方只需读答案，**永远不参与它的工具循环**。

**这是"外包给外部进程"，不是"把免费模型变成队友"。**

---

## 6. 成本：实测为 0

三个独立证据源一致：

**① 真实 CLI 运行的 result 事件**（`D:\DSH-ZJ\_w2.txt`）：

```json
{"type":"result","subtype":"success",..."total_cost_usd":0,"total_credits":0,
 "modelUsage":{"qfmodel":{..."costUSD":0,"credits":0}}}
```

**② 逐次 assistant 事件都带 `"billable":false`**，例如同一文件：

```json
{"type":"assistant","message":{... "usage":{... "credits":1.0285137500000001,
 "original_credits":1.0285137500000001,"billable":false, ...}}}
```

⇒ 注意这里有一个**很有价值的细节**：单轮 `credits` 数值**非零**（1.028），
但 `billable:false`，且最终 `total_credits` 为 **0**。
**读成本要看 `result` 事件的 `total_credits` / `billable`，不要看单轮的 `credits` 数值。**

**③ 模型目录记录 `price_factor: 0`**（`D:\DSH-ZJ\_msg7.txt`）：

> `qfmodel` is Qwen3.8-Flash: the catalog snapshot records `price_factor: 0`, `is_free: true`.

对照（同文）：`qmodel / gmodel / kmodel / dmodel -> "You've reached your credit usage limit"`，
而 `qfmodel` 正常出词。

**成本结论**：用 `qfmodel` 跑 qworker，**实测不消耗积分**。

> **顺带（`--thinking disabled` 为何是默认）**：`qworker.mjs:184` 的注释给出的是
> **两个实测理由**，原文：
>
> > `--thinking disabled` is the default for two measured reasons: it removed the
> > cost variance (a default run was seen at **6.765 credits vs a stable ~0.55**), and
> > `qfmodel` is the free key so the saving is real either way. Override with
> > `--thinking enabled` when a task genuinely needs reasoning — note the CLI
> > **rejects `--thinking enabled` without `--thinking-budget`**.
>
> 即默认关思考链主要是为了**消除成本方差**（不是"更快"——那是我的推测，见下）。
> 另外**想开启思考链时必须同时给 `--thinking-budget`**，否则 CLI 拒绝。
> ⚠️ 相关旁证：`COST-REDUCTION-FINDINGS.md` §二 在 **REST 通道**实测
> `enable_thinking:false` 可把 qmodel 一族的 completion 从 1024 砍到 3。
> 但**"关思考链让 CLI 更快"这一条我没有实测**，不作为结论。

---

## 7. 边界与未验证（诚实清单）

### 7.1 已实测的边界

| 边界 | 实测值 | 来源 |
|---|---|---|
| 单工人超时会真的杀掉 | 2000ms 预算 → **2052ms** 被杀，`timedOut:true` | `t1-HARDENING-EVIDENCE.md` §3 (B1) |
| 并发上限生效 | 测试实测**峰值恰为 2** | `t1-HARDENING-EVIDENCE.md` §2.4 |
| 单任务耗时量级 | 12–33s（`turns=1..3`） | `_qw-verify-live2.txt` |
| 工具数 | CLI 内置 **31** | `t10-cli-tools.md` §1 |

### 7.2 多轮工具循环的极限 —— ⚠️ **未验证**

- 实测到的最大 `num_turns` 是 **3**（`count-assertions`，用 Glob+Grep 两工具）。
- **更长的循环（10 轮、20 轮）会不会退化、截断、或撞上下文上限 —— 未验证。**
- 已知相关：长循环会让单次 `-p` 长时间不返回，**必须配 `--timeout`**，
  否则 §7.3 的超时问题会出现。
- **没有测到"最大轮数"这个数**。不要把 31 个工具的存在读成"能无限轮"。

### 7.3 超长任务的超时行为 —— ⚠️ **部分未验证**

- **已实测**：超时机制本身可用，SIGKILL 会在预算附近触发（2052ms / 2000ms 预算）。
- **已修复的历史缺陷（值得记住）**：曾有 B1 —— 超时定时器被 `unref()`。
  `unref` 的 timer 作为唯一待处理句柄时 Node 直接退出事件循环，导致
  **挂死的 CLI 永远不会被超时杀掉，整个 plan 永久挂住**。已改为 ref 并加了源码级回归守卫。
- **未验证**：超长任务（> 600s 默认预算）被 SIGKILL 时，**CLI 是否留下孤儿进程 /
  半写文件 / 会话残留**。也**未验证** plan 中途被外部 kill 时的落盘一致性。
- **未验证**：超时发生在 CLI **工具执行中途** 时的行为（会不会留下部分副作用）。

### 7.4 并发上限的实际天花板 —— ⚠️ **未验证**

- `--concurrency` 默认 4，**实测只跑过 4**（`_qw-verify-live2.txt`：4 task，concurrency=4）。
- **该跑到多少会撞服务端限流 / 本机 CPU / 内存 —— 未验证。**
- 线索但不构成结论：`COST-REDUCTION-FINDINGS.md` §五 提到用户观察到
  "有时 100 积分就 429" ⇒ 服务端**存在频率限制轴**。
  **免费 key 的限流阈值是否更严 —— 未验证。**
- **建议**：从 4 起步，逐步加压并观察 `nonzero-exit` / 限流类报错，不要一次性上大并发。

### 7.5 其它未验证项

| 项 | 状态 |
|---|---|
| 其它模型（`qmodel_38max` 等）走 CLI 的行为 | **未验证**，本次全程只用 `qfmodel` |
| 跨机器可移植性 | **未验证**。真实运行绑定本机路径 `C:\Users\Administrator\.qoder\bin\qodercli\qodercli-1.1.58.exe`；可用 `QODER_CLI_PATH` 覆盖（**覆盖方式本身未实测**） |
| `--plan-relaxed` | 仅有**离线测试**覆盖，**未做真实 CLI 演练** |
| CLI 通道上 `--thinking disabled` 的实际省时比例 | **未验证**（省 token 的实测在 REST 通道上做的） |
| 并发工人共享同一凭证的竞争行为 | **未验证** |

---

## 8. 维护者检查清单

改动前先确认：

1. **不要给 CLI 的 `tool_use` 发 `tool_calls`** —— 必然死锁（§3）。有回归守卫，改了会红。
2. **不要给超时定时器加 `unref()`** —— 会让挂死 CLI 永远杀不掉（§7.3 B1）。
3. **改 `--out` 落盘逻辑时保住两条**：BLOCKED 不覆盖真实正文；续跑仍要前传正文（§4.4 第 6 条）。
4. **改并发/依赖逻辑后跑两个套件**：
   ```powershell
   node D:\DSH-ZJ\test\qworker.test.mjs       # 期望 37 passed, 0 failed
   node D:\DSH-ZJ\test\qworker.mutation.mjs   # 期望 14/14 mutants killed
   ```
   第二个套件是**尺子的刻度校验** —— 它绿了才说明第一个套件真的能报红。
5. **成本判定看 `result.total_credits`**，不要看单轮 `credits` 数值（§6）。
6. **任何"没真跑过"的结论，写进 §7，不要写成"通过"。**

---

## 附：证据文件索引

| 文件 | 内容 |
|---|---|
| `D:\DSH-ZJ\qworker.mjs` | 调度器实现（682 行） |
| `D:\DSH-ZJ\_plan.json` | 真实使用过的 plan DAG |
| `D:\DSH-ZJ\_qw-verify-live2.txt` | 4 任务 DAG 真实运行原始输出 |
| `D:\DSH-ZJ\_qw-final-live.txt` | 同上（简版） |
| `D:\DSH-ZJ\_rest.mjs` / `_restout.txt` | REST 逐 key 探针与原始响应 |
| `D:\DSH-ZJ\_msg7.txt` | 提交说明：`price_factor: 0`、quota 原始字段、死锁理由 |
| `D:\DSH-ZJ\_w2.txt` | Write 落盘 + `billable:false` + `total_credits:0` 原始事件流 |
| `D:\DSH-ZJ\_loop.txt` | `num_turns≥2` 多轮工具循环原始事件流 |
| `D:\DSH-ZJ\t1-HARDENING-EVIDENCE.md` | 加固与离线测试证据 |
| `D:\DSH-ZJ\COST-REDUCTION-FINDINGS.md` | 成本归因实测 |
| `D:\DSH\tmp\p0-crypto\t10-cli-tools.md` | CLI 工具通道实测与 `tool_calls` 死锁结论 |
