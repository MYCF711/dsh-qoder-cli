# Qoder 凭据加密的纯 JS 复现分析（t19）

**任务**：判断能否用纯 JS（node:crypto）复现 `credential_storage_decrypt`，去掉 WASM 依赖。
**结论**：✅ **能，完全复现**。算法是教科书级 **AES-128-CBC + PKCS7**，密钥与 IV 是**同一字节串**。
**验证强度**：真实凭据文件解密与 WASM 输出**逐字节一致**；双向 round-trip（纯加密→WASM 解、WASM 加密→纯解）+ 密文字节级相同，共 5 项全过。

---

## 0. 算法规格（实测确定，非推测）

```
算法     = AES-128-CBC
key      = machine_id.slice(0, 16) 的 UTF-8 字节，原样 16 字节（无任何哈希/派生）
IV       = 与 key 完全相同的 16 字节（key === IV！）
padding  = PKCS#7（标准，node setAutoPadding(true) 即可）
payload  = base64( ciphertext )，密文长度 = (floor(n/16)+1)*16，无 nonce/tag 字段
```

可运行的纯 JS 实现（解密 + 加密，`decryptPureJs` 已对本机真实凭据验证）：

```js
import crypto from 'node:crypto'

function decryptPureJs(b64, key16) {
  const raw = Buffer.from(b64, 'base64')
  if (raw.length === 0 || raw.length % 16 !== 0) throw new Error('not block-aligned')
  const keyBuf = Buffer.from(key16, 'utf8')
  const d = crypto.createDecipheriv('aes-128-cbc', keyBuf, keyBuf) // key === IV
  d.setAutoPadding(true)
  return Buffer.concat([d.update(raw), d.final()]).toString('utf8')
}

function encryptPureJs(plain, key16) {
  const keyBuf = Buffer.from(key16, 'utf8')
  const c = crypto.createCipheriv('aes-128-cbc', keyBuf, keyBuf) // key === IV
  c.setAutoPadding(true)
  return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString('base64')
}
```

## 1. 实验矩阵（假设 × 结果）

### 第一轮：固定 IV 类假设（42 + 24 组合，全部失败）

| 假设 | 组合 | 结果 |
|---|---|---|
| GCM | aes-{256,128}-gcm × {keyText, sha256, md5, sha1, pbkdf2} × IV{head12/16, tail12/16, zeros} × tag{tail16} | ❌ 0 过（且**长度法先排除 GCM**：1B 明文 → 16B 密文，装不下 16B tag+12B nonce） |
| CBC/ECB | aes-{128,256}-{cbc,ecb} × keys × IV{zeros, key派生} | ❌ 0 过（zeros IV 解出乱码） |
| pbkdf2 | {qoder, cosy, key, ''} × {1000, 10000, 65536} 迭代 | ❌ 0 过 |
| ECB | aes-128-ecb(md5key) 手工 padding 块比对 | ❌ 不等 |

### 第二轮：结构性突破（已知明文对）

用 16B 已知明文直接**恢复 IV**（CBC 性质：`IV = D(C1) ⊕ P1`）：

```
 recovered IV = 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66
              = ASCII "0123456789abcdef"  ← 就是 keyText 本身！
```

### 第三轮：假设 × 结果（IV 搜索）

| 假设 | 结果 |
|---|---|
| IV = P[:16]（明文前缀） | ❌ |
| IV = md5(pt) / sha256(pt)[:16] | ❌ |
| IV = sha256(key+pt)[:16] / md5(key+pt) / sha256(pt+key)[:16] | ❌ |
| IV = E(key, pt[:16]) | ❌ |
| **IV = key 本身** | ✅ **全过**（7 种明文长度 1B–61B 全部逐字节匹配） |

### 最终验证（真实凭据，`tmp/cred-crypto-final2.mjs`）

| 验证 | 结果 |
|---|---|
| 纯 JS 解密真实 `~/.qoder/.auth/user` vs WASM 解密 | **逐字节一致**（uid 相同，全文 JSON 相等） |
| WASM 加密 → 纯 JS 解密 | ✅ |
| 纯 JS 加密 → WASM 解密 | ✅ |
| 同明文密文字节级相同 | ✅ |

## 2. 方法论要点（为什么能破）

1. **长度分析先排除了 GCM/tag 类**：1B 明文 → 16B 密文（恰好 1 块），32B → 48B（PKCS7 补块）——净开销为 0，无 nonce/tag 空间。
2. **确定性**（同输入同输出）排除了随机 IV/nonce。
3. **不同明文首块 → 不同首块密文**排除了固定 IV 的 CBC/ECB/流模式。
4. **CBC 已知明文攻击**（`IV = D(C1) ⊕ P1`）一步恢复 IV，发现就是 key——之后全部假设收敛。

## 3. 安全性评估（给 captain 的决策依据）

- **key===IV 是教科书级 CBC 误用**：IV 应随机不可预测；同 key 同 IV 使相同明文前缀产生相同密文前缀（确定性可被流量分析利用）。
- key 是 `machine_id` 前 16 字符（UUID 格式的 ASCII），**熵远低于 128 bit**（UUID 有固定连字符模式；若 machine_id 是十六进制 UUID，每字符实际熵 ≤4 bit，16 字符 ≈ 60 bit 上限，且结构高度可预测）。
- **结论**：Qoder 的凭据加密对有本机文件读权限的攻击者只是混淆，不是真正的机密性边界（攻击者同样能读 machine_id）。**本插件用 WASM 或纯 JS 在此强度上没有安全差异**。
- **去 WASM 依赖的可行性**：技术上完全可行（上面 15 行代码）。但注意 `wasm-credential-reader.js` 同时服务 `credential_storage_encrypt`（写插件自己的凭据副本）；纯 JS 替换需同时覆盖两个函数并跑全量测试。是否替换由 captain 决策——这是兼容性/维护性权衡，不是能力问题。

## 4. 复现脚本（全部在 tmp/，未进仓库）

| 脚本 | 作用 |
|---|---|
| `tmp/cred-crypto-brute.mjs` | 第一轮 66 组合穷举 + 长度/结构分析 |
| `tmp/cred-crypto-round4.mjs` | 已知明文恢复 IV（关键一步） |
| `tmp/cred-crypto-round7.mjs` | IV=key 假设 7 长度全验证 |
| `tmp/cred-crypto-final2.mjs` | **真实凭据四向验证（本报告的主证据）** |
