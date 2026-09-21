# 能否用纯 JS（node:crypto）复现 Qoder 凭据解密？

**结论：不能（本轮未定论，但已把假设空间压到"复现需要先逆向 wasm 内部派生逻辑"）。**
**实验时长：约 15 分钟（限时内）。** 执行者：ds-a。**未改 `lib/` 任何文件。**

---

## TL;DR

| 问题 | 结论 | 证据强度 |
|---|---|---|
| 算法家族 | **AES-128-GCM**（不是 AES-256） | 强（二进制字符串 + 密钥长度强制） |
| 是否可纯 JS 复现 | **否**，至少不是"直接调 crypto 同名算法"能做到 | 强（6 种候选构造全部不匹配） |
| 决定性阻塞点 | 密文**头 16 字节与明文无关**，是**独立的头部块**，其派生逻辑在 wasm 内部 | 强（跨明文对照实测） |
| 随机性 | **无随机 IV / nonce**：同输入三次输出完全相同 | 强（三连测） |

**给"移除 298KB wasm"的决策建议：目前不支持移除。** 但不排除后续（见 §6 下一步）。

---

## 1. 实验步骤与原始证据

### 1.1 二进制字符串表（步骤 1-2）

`lib/qoder/wasm/qoder_auth_wasm_bg.wasm`，**298,606 字节**，可打印字符串（≥5 字符）**810 条**，全量导出到 `D:\DSH\tmp\wasm-strings.txt`。

命中的算法特征（节选，含偏移）：

| 关键词 | 命中 | 关键内容 |
|---|---|---|
| `AES-256-GCM` | 4 | `AES-256-GCM chunk encrypt failed:` / `AES-GCM encrypt failed:` / `AES-GCM decrypt failed:` |
| `src/gcm_crypto.rs` | 1 | **自研模块名**（不是第三方 crate 路径） |
| `aes-gcm-0.10.3` | 2 | RustCrypto crate |
| `hmac-0.12.1` / `hkdf-0.12.4` | 各 1 | 有 HKDF + HMAC 依赖 |
| `sha2-0.10.9/src/sha256/soft.rs` | 1 | SHA-256 可用 |
| `rsa-0.9.10`（oaep/pkcs1v15/mgf） | 4+ | RSA 仅用于 `encrypt_user_info` / profile 公钥，与凭据存储无关 |
| `Key must be 16 bytes, got` | 1 | **决定性**：密钥强制 16 字节 |
| `StreamCipherError` | 1 | 存在流密码错误类型 |
| `getrandom` / `getRandomValues` | — | 有随机源（但见 §1.3，凭据路径未使用它） |

导出名（wasm 导出表，可直接读出）：
`credential_storage_encrypt` / `credential_storage_decrypt` / `decrypt_server_response` / `model_cache_encrypt` / `model_cache_decrypt` / `profile_encrypt` / `qodercontext_prepareRequest` …

> ⚠️ **注意**：字符串里的 `AES-256-GCM` 属于 `profileencryptor_*`（profile 分块加密）那条链路；**凭据路径强制 16 字节密钥 ⇒ 是 AES-128**。两条链路共用错误文案模板，不能混为一谈。

### 1.2 密钥长度约束（实测）

```
key="machineid-16char"                     ok  (88 b64)
key="machineid-16char-longer-32bytes!!!"   THREW Key must be 16 bytes, got 34
key="short"                                THREW Key must be 16 bytes, got 5
key=""                                     THREW Key must be 16 bytes, got 0
```

**⇒ AES-128 家族，密钥 = `machine_id.slice(0,16)` 的 UTF-8 字节（16 字节，无 KDF 拉伸）。**

### 1.3 随机性判定（步骤 3 — 任务书要求的关键判别）

同一明文 + 同一密钥，**连续加密三次**：

```
run1: u2/QM7knGE1uQkntEEN81jlQ/C7N8ZvJ7QokTp0ekW3CZz0u40HuA8sprza3vGsy5QxrZlQN4PPDkq+hHd23GGA==
run2: u2/QM7knGE1uQkntEEN81jlQ/C7N8ZvJ7QokTp0ekW3CZz0u40HuA8sprza3vGsy5QxrZlQN4PPDkq+hHd23GGA==
run3: u2/QM7knGE1uQkntEEN81jlQ/C7N8ZvJ7QokTp0ekW3CZz0u40HuA8sprza3vGsy5QxrZlQN4PPDkq+hHd23GGA==
```

**⇒ 完全确定性，无随机 IV/nonce。** （getrandom 依赖存在但不用于此路径。）

### 1.4 长度框架

| 明文长度 | 原始字节 | 开销 |
|---|---|---|
| 0 | 16 | 16 |
| 1 | 16 | 15 |
| 15 | 16 | 1 |
| 16 | 32 | 16 |
| 17 | 32 | 15 |
| 32 | 48 | 16 |
| 100 | 112 | 12 |
| 1000 | 1008 | 8 |

⇒ **16 字节块粒度**，开销随长度趋近 8~16 字节。**不是** GCM 的 12B nonce + 16B tag（那是 28 固定开销且长度与块无关）。

### 1.5 🔴 决定性发现：前 16 字节是"头部块"，与明文无关

同一密钥下，**不同明文**加密后对照：

```
plaintext 16B "abcdefghijklmnop"          -> dde8c38a7678455585cfa96b44cf515d cb328b43b9212382937b5aebc00721cf
plaintext 32B "abcdefghijklmnopqrst..."   -> dde8c38a7678455585cfa96b44cf515d 5c18016872bd05bc19d44c6f4a43d15d ffc220bda4137cf1af045948bd572abe
                ^^^^^^^^^^^^^^^^^^^^^^^^ 前 16 字节完全相同
```

且 `XOR(blob, plain)[0..16) = bc8aa0ee131e223deca5c20729a13e2d` —— **两种不同明文得到完全相同的 XOR 值**。

⇒ 前 16 字节**不是**流密码输出（否则 keystream 相同、XOR 会随明文变化），而是**一个与明文无关的固定头部块**（16 字节）。
密文体 = `[16 字节头部块（key 派生，与明文无关）] + [明文加密体]`。

### 1.6 六种候选构造全部不匹配（步骤 4）

用 `node:crypto` 逐一尝试（明文 16B/32B/9B 三组，比对 exact / prefix / tailMatch）：

```
AES-128-ECB                exact=no  prefix=no  tailMatch=no
AES-128-CBC/zeroIV         exact=no  prefix=no  tailMatch=no
AES-128-CTR/zeroIV         exact=no  prefix=no  tailMatch=no
AES-128-CTR/iv=key         exact=no  prefix=no  tailMatch=no
AES-128-ECB/pkcs7          exact=no  prefix=no  tailMatch=no
AES-128-CBC/zeroIV/pkcs7   exact=no  prefix=no  tailMatch=no
```

**0/6 命中。** 且 §1.5 已证明"整块 = 某种标准分组模式输出"这个假设本身就不成立（有独立头部块）。

---

## 2. 为什么"纯 JS 复现"在本轮判为不可行

1. **强制 AES-128**（`Key must be 16 bytes, got`）已排除"直接套用字符串里那个 AES-256-GCM"的捷径；
2. **确定性**排除了随机 nonce，但**没有**告诉我们头部块怎么派生（可能是 key 派生 key、HKDF 展开、或固定常量表）；
3. **头部块与明文无关却在头部**，说明它是**先算好再拼接**的 → 派生逻辑在 wasm 代码段里，**字符串表里没有留下参数**（无 salt/iteration/iv 常量字符串）；
4. `src/gcm_crypto.rs` 是**自研模块**，不是标准 crate 用法，参数不能靠 crate 默认值推断。

**⇒ 要复现，必须逆向 wasm 代码段（反编译）取头部派生算法，不是"试几个 crypto 调用"能解决的。** 本轮限时内未做反编译。

---

## 3. 对"移除 298KB wasm"的直接建议

**当前不支持移除。** 理由：
- 凭据解密路径**尚无可用的纯 JS 替代**（本轮 0/6 命中 + 头部派生未知）；
- 该 wasm 同时承载 `model_cache_decrypt`（本地目录解密）与 `qodercontext_prepareRequest`（COSY 签名，见 t9），**移除它不止影响凭据一条链路**；
- 移除后失败是**静默降级**（`readLocalCatalog` catch → null → 回退内置目录；`resolveProbeToken` catch → null），属高危静默类缺陷。

**但有一条立即有价值的中间结论**：WASM 里同时存在 **AES-256-GCM（profile 链路）** 与 **AES-128（凭据链路）**，两者错误文案同模板。若后续要复现，**必须分别对待**，否则会拿 profile 链路的 AES-256 结论去套凭据链路，必然失败。

---

## 4. 复现步骤（可重跑）

```powershell
# 1. 二进制字符串表（810 条，导出到 tmp/wasm-strings.txt）
node D:\DSH\tmp\wasm-strings.mjs

# 2. 确定性 + 长度框架 + 密钥长度约束
node D:\DSH\tmp\wasm-crypto-shape.mjs

# 3. 六种 node:crypto 候选构造比对
node D:\DSH\tmp\wasm-crypto-repro.mjs
```

脚本均在 `D:\DSH\tmp\`（未进仓库）。**执行通道注意**：本轮 pwsh 直连 `node ... | Select-Object` / `> file` 均被沙箱拒绝（`ResourceUnavailable`）；须走 agent terminal。另 Windows 下 ESM 动态 import 必须用 `file:///` URL（`import('D:/...')` 会 `ERR_UNSUPPORTED_ESM_URL_SCHEME`）。

---

## 5. 本轮**未**证明的事（防止过度解读）

- ❌ 未反编译 wasm 代码段，**头部 16 字节的派生算法未知**；
- ❌ 未验证 `credential_storage_decrypt` 与 `model_cache_decrypt` 是否共用同一构造（后者另有 uid 参与）；
- ❌ 未穷举 KDF 组合（HKDF-SHA256 变体、SHA-256 前缀等）—— 有 HKDF/HMAC 依赖存在，但**没有参数证据**支撑盲目穷举；
- ❌ "未定论" ≠ "不可复现"：本结论是"**限时内用字符串线索 + 黑盒差分未能命中**"，不是数学上的不可能。

## 6. 若要继续（建议下一步，非本轮范围）

1. **反编译 wasm 代码段**：定位 `credential_storage_encrypt` 导出函数的函数体，看前 16 字节如何构造（是常量表还是 key 派生）。工具：`wasm2wat` / `wasm-decompile`。
2. 若有 **Rust 源码路径线索**：字符串里含 `/Users/zhangxun/.cargo/registry/...` 与 `src/gcm_crypto.rs` —— 说明构建者是 `zhangxun`，自研模块名为 `gcm_crypto`。这**不能**直接拿到源码，但可用于比对公开实现的形态。
3. 用 §1.5 的"固定头部块"做**已知明文攻击**：若能拿到多组 (明文,密文) 且头部恒定，可先确认头部是否 = `E_k(常量)`。
