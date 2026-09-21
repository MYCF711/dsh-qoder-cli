# WASM 密码学破译方法论 — Qoder 凭据加密 15 分钟复现全程复盘

> **目标读者**：需要在黑盒条件下复现某个加密实现的后来者。本文把 2026-09-20 这次 15 分钟破译（66 组合穷举 → 4 通道结构分析 → 已知明文攻击 → 逐字节等价证明）抽象成可迁移的方法论。全部数字、命令、输出均为当场实测，脚本在 `tmp/cred-crypto-*.mjs`（8 个，未进仓库），分析报告见 [`CREDENTIAL-CRYPTO-ANALYSIS.md`](CREDENTIAL-CRYPTO-ANALYSIS.md)。

---

## 一、问题定义

### 目标

Qoder CLI 把登录凭据存在 `~/.qoder/.auth/user`（AES 加密，base64）。此前插件通过调用 Qoder 官方 WASM（`qoder_auth_wasm_bg.wasm`）的 `credential_storage_decrypt` / `credential_storage_encrypt` 读写它。WASM 带来两个问题：

1. **ToS 风险**：分发官方二进制（298KB）随包走；
2. **体积与维护**：wasm-bindgen glue 需要手动维护 slab 协议。

### 约束（这是整个方法论成立的前提）

**必须逐字节证明纯 JS 与 wasm 等价**——不是"能解出 JSON 就行"，而是：

- 纯 JS 解密真实凭据 ≡ WASM 解密（逐字节）
- 纯 JS 加密 → WASM 能解
- WASM 加密 → 纯 JS 能解
- 同明文两次加密，密文**字节级相同**（确定性一致）

四条缺一不可。后两条卡死了"几乎对"的实现：padding 细节差一位、IV 差一字节都会在这里现形。

### 已知条件（黑盒 但不是全黑）

- `machine_id` 文件在手（明文），密钥材料 = `machine_id.slice(0, 16)`（从之前的 `wasm-credential-reader.js` 已验证过）；
- WASM 导出函数可从 Node 直接调用（`test/wasm-encrypt-helper.mjs` 已封装 init）；
- 即：**我们拥有一个加密 oracle**——任意明文进、密文出。这是全部方法论的物理基础。

---

## 二、方法论（核心）

### 1. 为什么盲试会失败

第一轮的组合空间：`{GCM, CBC, ECB} × {keyText, sha256, md5, sha1, pbkdf2×{迭代数}} × IV{head12/16, tail12/16, zeros} × tag{tail16}` = **66 组合，全部失败**。

**66 组合为什么必然失败**：真正的参数空间不是 66，而是——

```
算法族(≥4) × key 派生(∞ 种函数) × IV 来源(∞ 种函数) × 编码层(前置头? 分段? 压缩?)
```

key 派生和 IV 来源是**函数空间**，不是枚举空间——`sha256(key + "qoder")[:16]`、`pbkdf2(key, salt, 65536)`、`hkdf(...)` 任意组合都合法。穷举 66 个只覆盖了"人类最常写的 66 种"，对"这一个开发者写了什么"**没有覆盖保证**。

**但第一轮不是白跑的**：穷举脚本同时产出了长度/确定性/差分观测（见下），这些观测才是破译的真正杠杆。**穷举的价值不在命中，在其副产物——结构观测。**

### 2. 黑盒分析的四个信息通道

对一个加密 oracle（明文进、密文出），有四类观测，每类都**不依赖猜对算法**：

| 通道 | 操作 | 观测什么 |
|---|---|---|
| **长度** | 发不同长度的明文，量密文长度差 | 固定开销（nonce/tag/头）+ padding 行为 |
| **确定性** | 同明文加密两次，比对 | 有无随机源（nonce/时间戳/盐） |
| **差分** | 改明文 1 字节，比对密文 | 哪些块变了 → 分组结构、链接模式 |
| **结构** | base64 解码看字节边界 | 是否块对齐、有无明文头/魔数 |

### 3. 每个通道能排除什么（决策树）

实测走出来的决策树，**每个节点都是一次观测、都砍掉一大片假设空间**：

```
观测①：1B 明文 → 16B 密文（恰好 1 块）；32B → 48B（PKCS7 补块）
   ├─ 净开销 = 0
   ├─ 排除 GCM（必有 12B nonce + 16B tag，最小 29B 开销）
   ├─ 排除任何"密文前缀头/nonce 前置"格式
   └─ 锁定：块密码 + PKCS#7 类 padding（CBC/ECB）

观测②：同明文加密两次 → 密文字节级相同
   ├─ 排除随机 IV / 随机 nonce / 时间戳盐
   └─ IV（若存在）是输入的确定函数

观测③：'AAAAAAAAAAAAAAAA' 与 'AAAAAAAAAAAAAAAB'（仅末字节不同）
        → 首块密文相同
   ├─ 首块密文只依赖 P1 和 IV（与后续块无关）→ 分组链接结构
   ├─ 若 ECB：第二例首块应不同 → 排除 ECB
   └─ 若固定 IV CBC：第三例（不同首块明文）首块密文必不同 → 与观测一致
      ⇒ 收敛：CBC，IV 是"输入的确定函数"（具体函数未知）

观测④（决定性）：CBC 数学性质 → P1 = D(C1) ⊕ IV
   → IV = D(C1) ⊕ P1，用任意已知明文对一步恢复 IV
   → 实测恢复值 = 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66
                 = ASCII "0123456789abcdef" = key 本身
```

**决策树的读法**：不需要"猜中算法"，只需要"观测与假设矛盾"。观测①一个就杀掉了 GCM 全族 + 一切带头的格式——这正是穷举 66 组合里 GCM 分支 20+ 组合全部失败的原因（它们不是试错了，是**从一开始就不可能对**）。

### 4. 已知明文攻击的适用条件

`IV = D(C1) ⊕ P1` 成立需要三个条件，缺一不可：

1. **模式是 CBC**（CFB 也行，公式不同；ECB 无 IV）——由观测③锁定；
2. **C1 可得且对应 P1**（首块密文 + 对应首块明文）——加密 oracle 直接给；
3. **解密方向可用**：用 key 对 C1 做一次**无 padding 的 ECB/零 IV CBC 解密**得到 D(C1)——不需要知道真 IV，零 IV 即可（IV 只影响首块输出，不影响 D 本身）。

满足后 IV 恢复是**一步、确定、可验证**的：用恢复的 IV 重加密已知明文，必须逐字节还原密文（round4 脚本的 `re-encrypt matches: true`）。

**适用边界**：此攻击只恢复 **IV**，不恢复 key。若 key 也未知，恢复出的 IV 只是又一个未知数——本次能破是因为 key 已从 machine_id 侧独立获得。**这就是"先啃 key 材料、后啃模式"的分工依据。**

### 5. 为什么排除法比穷举法高效（信息论视角）

- 穷举一次试一个完整假设，命中率 = p（单个假设为真的概率），66 连不中的概率 = (1-p)^66 ≈ 1——**期望收益趋零**；
- 一次结构观测直接把假设空间**除以一个因子**：长度观测排除 GCM+全部带格式变体（≈ 空间的 1/3）、确定性排除全部随机源变体（≈ 再 1/3）、差分排除 ECB/流模式（≈ 再 1/4）——三轮观测后剩余空间只剩"CBC + 确定性 IV"一个家族；
- **判据：一个观测值得做，当且仅当它能砍掉≥一半的剩余假设空间**。长度分析砍 1/3、确定性砍 1/3、差分砍 1/4——都过了线；而"再试一种 key 派生函数"砍掉的空间 ≈ 0，不值得做。

这就是 15 分钟的构成：66 组合穷举约 2 分钟（买到四类观测），四轮结构分析约 5 分钟，验证约 8 分钟。**时间花在观测上，不是花在组合上。**

---

## 三、实操步骤（可复现的操作序列）

> 环境准备：`test/wasm-encrypt-helper.mjs` 提供 `credentialStorageEncrypt/Decrypt`；`init(wasmPath)` 一次性加载。所有脚本 `node tmp/cred-crypto-*.mjs` 直接跑。

**Step 1｜建 oracle + 长度/确定性观测**（`cred-crypto-brute.mjs` 前半）

```
输入: 'x'（1B）          → raw=16B  delta=+15
输入: 32B 'y'*32        → raw=48B  delta=+16（PKCS7 整块补齐）
输入: '{"a":"b"}'（9B）  → raw=16B
同明文加密两次           → deterministic across calls: true
```

**结论**：无固定开销、无随机源、块对齐 → 排除 GCM/tag 类、排除随机 IV。

**Step 2｜66 组合穷举**（同脚本后半）——`aes-{256,128}-{gcm,cbc,ecb} × 4 key 派生 × IV{head/tail/zeros} × tag tail16`，全失败。**价值 = 确认"常见组合空间内无解"，把搜索推向结构分析。**

**Step 3｜差分观测**（`cred-crypto-round4.mjs` 前半）

```
p1='AAAAAAAAAAAAAAAA' p2='AAAAAAAAAAAAAAAB'（仅末字节异）
same C1 (IV xor same): true   → 首块只依赖 P1 → 链接模式，非 ECB
```

**Step 4｜已知明文恢复 IV**（round4 后半——**全场最大杠杆**）

```js
const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16)) // 零IV，只取D(C1)
d.setAutoPadding(false)
const decC1 = d.update(c1)
const iv = Buffer.from(decC1.map((b, i) => b ^ p1.charCodeAt(i)))  // IV = D(C1) ⊕ P1
```

```
RECOVERED IV: 30313233343536373839616263646566
iv ascii-ish: "0123456789abcdef"   ← 就是 KEY
re-encrypt matches: true
```

**Step 5｜IV 假设收敛**（round5/6/7）：用恢复的 IV 反查"它是哪个函数的输出"——md5(key)? sha256(key)[:16]? E(key,pt[:16])? 全否；ASCII 直接可读 = keyText。IV 候选表从 ∞ 收敛到 1。

**Step 6｜全长度验证**（`cred-crypto-round7.mjs`）：7 种明文长度（1B–61B，含真实凭据形状的 JSON）× `IV=key` 全部 `match=true`。

**Step 7｜真实凭据四向验证**（`cred-crypto-final2.mjs`——**主证据**）：

```
wasm uid vs pure uid           → 相同（真实 ~/.qoder/.auth/user）
REAL CREDENTIAL EXACT MATCH    → true（逐字节）
wasm-encrypt → pure-decrypt    → true
pure-encrypt → wasm-decrypt    → true
byte-identical encryption      → true（同明文密文字节级相同）
```

**Step 8｜归档**：算法规格 + 15 行纯 JS 实现 + 安全性评估写入 `docs/CREDENTIAL-CRYPTO-ANALYSIS.md`；实验脚本留 `tmp/`（未进仓库——含真实凭据路径）。

> **过程中的一次真失败（照实记录）**：round3 曾用"零 IV CBC"解全密文得乱码，差点据此排除 CBC——根因是自建 glue 的 slab 指针与 helper 的不同步（两套 `sg`）。round4 改为"零 IV 只取首块 D(C1)、XOR 恢复 IV"绕开了问题。**教训：仪器输出异常时，先怀疑仪器，再怀疑假设。**

---

## 四、本次的关键洞察

1. **长度分析一击排除 GCM**：1B 明文 → 16B 密文。GCM 最小开销 = 12B nonce + 16B tag = 29B，1B 明文最少也要 30B——**16B 这个数字直接判死刑**，连试都不用试。第一轮 20+ 个 GCM 组合的失败在观测①面前是必然。
2. **确定性一击排除随机 IV**：同输入同输出 = 无随机源。这排除了所有"随机 nonce 前置/后置"的现代标准做法——Qoder 开发者用了确定性方案。
3. **CBC 的 IV 可被已知明文恢复——全场最大杠杆**：`IV = D(C1) ⊕ P1` 把"IV 是什么函数"这个 ∞ 搜索空间变成**一次解密 + 一次 XOR**。而且恢复即验证（重加密必须逐字节还原），没有误报空间。
4. **开发者常把 key 当 IV（教科书级误用的普遍性）**： recovered IV 直接是 key 的 ASCII——这大概率是开发者写了 `createCipheriv(alg, key, key)` 或 wasm 里复用了同一 buffer。**先验概率上这是最该第一个试的假设**（尤其 key 恰好 16 字节时）；本次虽是靠观测推出的，但复盘后它应该在候选表第一位。
5. **"逐字节等价"约束反而加速了破译**：如果只要求"能解出 JSON"，Step 4 恢复 IV 后可能就停了；正因为要求密文级相同，`IV=key` 必须过 7 长度 + 四向验证——而这套验证同时证明了**没有隐藏的额外处理**（无压缩、无二次签名、无编码变换）。

---

## 五、通用教训（跨项目可复用）

1. **先做结构分析，再做算法猜测。** 顺序错了全程逆风：长度/确定性/差分三个观测各花一行代码，却决定了后面每一步的方向。
2. **"排除"比"确认"更可靠。** 确认一个假设需要正向匹配所有字节；排除只需要一个矛盾。观测①排除 GCM 只用了"16 < 29"一个不等式。
3. **每个观测都要能砍掉≥一半假设空间才值得做。** 砍得少的观测（"再试一种 hash"）是穷举换皮，不是分析。
4. **拥有 oracle 比拥有密文值钱。** 能加密任意明文 = 能做已知明文攻击、差分攻击、长度分析；只有密文样本时这些全部不可用。**接入点选择时优先找可调用函数，而非找可抓包流量。**
5. **真实数据验证 > 合成数据验证。** 7 种合成明文全过之后，真实 `~/.qoder/.auth/user` 逐字节比对仍可能有意外（编码前处理、字段裁剪……）——最终以真实数据为准。
6. **双向 round-trip 是等价性的最强证据。** 解密对 ≠ 加密对（可能 padding/编码补偿了差异）；加密对同理。**双向 + 密文字节级相同**才排除"恰好互补的错"。
7. **仪器输出异常先怀疑仪器。** round3 的乱码是自建 glue 的 slab 指针错位，不是算法假设错误——若当时据"乱码"排除 CBC，破译会晚几个小时。观测异常时：换一条不共享失效模式的通道复测（本工作区 AGENTS.md §8③ 的通用判据）。
8. **穷举不是无用，但要清醒它买到什么。** 66 连败买到的是"常见空间无解"的确认 + 四类结构观测的副产品——把它当**观测采集器**跑，不要当**解题器**等它命中。

---

## 六、工具与命令清单

全部脚本位于 `D:\DSH\tmp\`（**未进仓库**——内含本机凭据路径），按时间序：

| # | 脚本 | 作用 | 关键代码 |
|---|---|---|---|
| 1 | `cred-crypto-brute.mjs` | 建 oracle + 长度/确定性观测 + 66 组合穷举 | `for pt of ['{"a":"b"}','x',32B]` 量 `raw.length - byteLength`；`ct1 === ct1b` 判确定性；`algos × keys × ivs` 三层循环 |
| 2 | `cred-crypto-round2.mjs` | 第一轮结果整理与 CBC/ECB 分支细分 | padding 手工比对（ECB 分支） |
| 3 | `cred-crypto-round4.mjs` | **已知明文恢复 IV（关键一步）** | 零 IV `setAutoPadding(false)` 取 `D(C1)`，`iv = decC1.map((b,i) => b ^ p1.charCodeAt(i))`，重加密验证 + IV 候选表反查 |
| 4 | `cred-crypto-round5.mjs` | IV 来源假设矩阵（md5/sha256/E(key,pt) 等） | 候选表逐个 `equals(iv)` |
| 5 | `cred-crypto-round6.mjs` | IV 与 plaintext 关系排查 | 排除 IV=f(pt) 类 |
| 6 | `cred-crypto-round7.mjs` | **IV=key 假设 7 长度全验证** | `createCipheriv('aes-128-cbc', key, key)`，7 种明文 `out.equals(ct)` |
| 7 | `cred-crypto-final.mjs` | 真实凭据首轮验证（发现需补双向） | 真实文件读入 + 两实现对比 |
| 8 | `cred-crypto-final2.mjs` | **主证据：真实凭据四向验证** | 手写最小 wasm-bindgen glue 直调 `credential_storage_decrypt`；`pureOut === wasmOut` 逐字节 + 双向 round-trip + 密文字节级比对 |

**核心结论代码**（15 行，`CREDENTIAL-CRYPTO-ANALYSIS.md` §0 有完整版）：

```js
// AES-128-CBC + PKCS7，key === IV（均为 machine_id 前 16 字符的 UTF-8 字节）
function decryptPureJs(b64, key16) {
  const raw = Buffer.from(b64, 'base64')
  if (raw.length === 0 || raw.length % 16 !== 0) throw new Error('not block-aligned')
  const keyBuf = Buffer.from(key16, 'utf8')
  const d = crypto.createDecipheriv('aes-128-cbc', keyBuf, keyBuf) // key === IV
  d.setAutoPadding(true)
  return Buffer.concat([d.update(raw), d.final()]).toString('utf8')
}
```

**实测算法规格**：`AES-128-CBC`，key = `machine_id.slice(0,16)` UTF-8 原样 16 字节（无哈希无派生），IV = 同一字节串，PKCS#7，payload = base64(ciphertext)，密文长 = `(floor(n/16)+1)*16`，无 nonce/tag 字段。

**安全性备注**（决策背景，详见分析报告 §3）：key===IV 属教科书级 CBC 误用；key 为 UUID 格式 ASCII，实际熵 ≤ ~60bit 且结构可预测——该加密对本机文件读权限的攻击者只是混淆。**去 WASM 在安全上无差异**，是否替换（覆盖 encrypt+decrypt 双函数 + 全量测试回归）由维护者权衡。
