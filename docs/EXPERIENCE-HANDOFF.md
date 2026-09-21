# DSH 插件开发：可迁移经验（压缩交接版）

> 来源：`D:\DSH\qoder-dsh-plugin`（Qoder 模型接入 DSH，2026-09-18 实测完工）。只写**踩过的坑 +
> 判据 + 可照抄骨架**。适合**并行开工、正在写别的 DSH 插件**的 agent 借鉴。装机位置
> `%APPDATA%\dsh-desktop\harness\profiles\web\node_modules\dsh-qoder-cli\`。
>
> **运行时状态（2026-09-20，t4 重装 + t5 独立审查 pass）**：坏包 dsh-qoder-plugin@0.1.0
> （占 node_modules 根、SessionLimiter 双声明加载即崩）已清除，源码 tgz 装为正常目录形态，
> 已登记 `dsh.profile.bundles`（18 项）；三命令全绿 EXIT=0，备份 `package.json.bak-t4` 在
> profile 目录。**DSH 重启验证属用户域，尚未做。** 恢复脚本/证据：`D:\DSH\tmp\t4-recovery\`。

## 0. 复跑命令（同口径）

```powershell
$node = 'D:\DSH Desktop\resources\app\node_modules\node\bin\node.exe'
& $node D:\DSH\qoder-dsh-plugin\test\run-all.mjs       # 实测 5 files green / 77 assertions / 0 failed / EXIT=0
& $node D:\DSH\qoder-dsh-plugin\test\verify-loads.mjs  # 实测 5 passed / 0 failed
```

## 1. 装配骨架（**可照抄**，含释放）

```js
export const name = 'llm-qoder-cli'
export const inject = ['llm']            // 模型注册表必须先存在

export function apply(ctx, config) {
  const shim = createQoderShim({ store, client, catalog, logger: ctx.logger })

  ctx.inject(['webServer'], (c) => registerQoderRoutes(c, { store, models, enabledModels }))
  ctx.inject(['settings'], (c) => {
    c.settings.installSection(ctx, NS, Config, config, { setSource(s) { current = s } })
  })

  let stopped = false
  ctx.effect(() => () => { stopped = true; shim.close().catch(() => {}) })

  shim.ready.then(() => {                  // 时序关键：注册必须在 shim 起来之后
    if (stopped) return
    const profile = { provider: PROVIDER, displayName: NAME, piProvider: provider }
    const adapter = new PiAiAdapter({ profiles: () => new Map([[PROVIDER, profile]]),
      auth: INERT_AUTH, resolveApiKey: async () => shim.token() })

    const releaseAdapter = ctx.llm.registerAdapter([PROVIDER], adapter)
    const releaseDir = ctx.llm.registerConfigurableProviders([
      { provider: PROVIDER, displayName: NAME, settingsNs: NS, settingsPath: [], declared: false }])

    ctx.effect(() => () => { releaseAdapter?.(); releaseDir?.() })   // 不接 = 热重载泄漏
  }).catch((e) => ctx.logger.error('shim failed to start; provider not registered', e))
}
```

三个要点：① **每个 `register*` 都要拿返回值并接 `ctx.effect` 释放**；② 两个 register 放同一 `try`，
任一为 `undefined` 就补偿释放另一个；③ **shim 起不来就不注册 provider** —— 宁可不出现，
也不要注册一个永远 401 的 provider。

## 2. 🔴 安装通道：**必须 tarball，不能 `link:`**

`dsh plugin --profile web add link:D:/path` 会装出 **junction**；Node 解析模块时**跟随 junction
回真实路径**（`D:\DSH`），那里**没有 DSH 内部依赖** → `@deepseek-ai/schemastery` 等全部解析失败
→ **插件加载不了，且拖垮整个 profile**。

**正解**：`pnpm pack` 出 `.tgz` → `dsh plugin --profile web add <tgz>`。pnpm 把包实体放进 profile
自己的 `.pnpm/`，向上查找能命中 profile 的 `node_modules`，依赖才解析得到。

**判据**：别只在自己源码目录里 `import` 成功就宣布能装 —— **两个解析锚点不是一回事**，
要写"**装在哪儿就从哪儿 import**"的检查（见 §0 `verify-loads.mjs`）。

## 3. 🔴 pi-ai 描述符**不能注入动态请求头** → 只能起回环 shim

`createProvider()` 的 model 描述符只有**静态 `headers` 合并**，没有"每请求算一个头"的钩子，
而 Qoder 网关要求每请求带 `Cosy-ClientType` / `Cosy-Version` / `Cosy-MachineId`：

```
DSH ──(OpenAI SSE, 无自定义头)──▶ 127.0.0.1 随机端口 shim ──(补 Cosy-* 头)──▶ 上游网关
```

shim 安全边界（缺一不可）：只绑 `127.0.0.1`、**随机端口**、**进程内随机 bearer + 常数时间比较**、
`Host` 与 `Origin` 都必须是回环（挡 DNS rebinding）。

**真凭据是回环共享密钥，不是上游 token** → pi-ai 的 auth 面喂 `INERT_AUTH`：
`credentials.read/list/delete` 全答"没有"，`modify` 直接抛（**不许 pi-ai 自己造凭据**），
配 `resolveApiKey: async () => shim.token()`。

客户端半边入口固定为 `window.__ModuleLoader__.load({ id, factory: (require) => {…} })`，
整个 `apply()` 包 try/catch —— slot API 变了要降级成 `console.error`，**不许炸加载器**。

## 4. 🔴 上游"HTTP 200 + 流里报错"是常态 → **必须解析 SSE 才判失败**

Qoder 的错误帧，**HTTP 状态码仍是 200**：

```
event: error
data: {"code":"invalid_model_error","message":"Unsupported model \"dfmodel\"", …}
```

**判据**：把"200"当成功 = 必然漏判，要读到 `event: error` 才算失败。
已固化为断言 `treats an in-band error frame on a 200 as a failure`。

## 5. 模型键 ≠ 界面展示名 —— **只能实测，读 bundle 读不出来**

16 个候选键逐个试探：**10 ACCEPTED / 5 REJECTED / 1 限流**。被拒的 `dfmodel` / `gfmodel` /
`kmodel_latest` / `qmodel_latest` / `qmodel_38max` / `qfmodel` **看着都合理**，官方文案表里也真有
它们的展示名 —— **但网关不认**。`mmodel` 展示为 MiniMax-M3，网关实际回 `MiniMax-M2.5`。

**判据**：模型目录**内置**，只放**逐个实测被接受**的键；列表端点实测 404 就不要假装能拉。
全表见 `docs/QODER-PROTOCOL-FINDINGS.md` §4。

## 6. 凭据复用：Electron `safeStorage`（Windows）解密链路

```
Local State → os_crypt.encrypted_key (base64, 前 5 字节 ASCII 是 "DPAPI")
  → 去前缀 → DPAPI CryptUnprotectData(CurrentUser) → 32B AES 密钥
auth.v1.dat = "v10"(3B) + nonce(12B) + ciphertext + tag(16B)，AES-256-GCM
```

**🔴 DPAPI 必须用 `koffi` 在进程内调**，不要从进程外拉 PowerShell —— **DSH 运行时拒绝与子进程
之间走管道 stdio**，那种设计"终端里能跑、harness 里跑不了"。

**只读不改**：连上游自己的文件都不写；插件自己那份缓存用**自己的路径**。DPAPI `CurrentUser`
作用域 ⇒ **只有同一 Windows 用户能解**（设计使然）。**令牌形态陷阱**：`dt-…` 27 字符，
**不是 JWT**，别写 JWT 解析。

## 7. 🔴 测试仪器的四个坑（都真踩过）

| # | 坑 | 处置 |
|---|---|---|
| 1 | **ESM 按 URL 缓存** —— 同文件 import 两次，**第二次什么都不跑**，输出空 → 被读成"全挂" | 每次 import 附**进程内 nonce**（`?run=<ts>-<rand>`）。本坑由 `verify-runner-detects-red.mjs` 抓到 |
| 2 | `for` 循环跑 `node f1 && node f2`，**退出码取最后一条** → 首个文件挂掉也 exit 0 | 用**累计失败后 `exit`** 的 runner 形态 |
| 3 | 子进程 `node` 被 DSH 沙箱拒（`spawnSync EPERM`，因为 stdio 是 pipe） | **在进程内 import** 各测试文件，各自打印 sentinel |
| 4 | 在**源码目录**里验证模块解析 → 一堆"装好后根本不存在"的假失败 | 解析锚点**必须是安装后的路径** |

**仪器自检是硬要求**：任何"全绿"都要**配一次证明这把尺子能报红**的运行。**空输出按失败处理**，
除非能当场说明"这条命令本来就该静默"。

## 8. 纪律：不确定的协议**不许猜**

`refreshToken` 刷新流程**故意不实现**：侦察期令牌还有一个月到期，**刷新端点与请求体从未被真实
触发过**。猜刷新协议的风险是**用畸形 body 覆盖掉仍然有效的 token**；而 token 过期只表现为一次
正常的 401，用户重开上游客户端即可恢复。⇒ `refreshCredential()` 原样返回，**注释里写清"要补的话
先取证哪三件事"**。

**【未验证】项（不得写成能力声明）**：`refreshToken` 刷新流程、CN 区域（`.cn` 网关）、
`main.sqlite` 内容、图片输入（所有模型只声明 `text`）。

## 9. 一句话总结

> **能装/能测/能用的状态优先推进；每个"全绿"都要配一次"这把尺子能报红"；装完必须从安装路径
> 再验一次解析；上游 200 不等于成功；没实测过的协议宁可标未验证也不要猜。**
