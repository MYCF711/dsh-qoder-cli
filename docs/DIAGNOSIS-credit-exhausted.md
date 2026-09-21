# 诊断：模型"变笨"的真相 — 配额耗尽（credit usage limit）

> 2026-09-21 实测。用户报告「没有思考过程，不会调用工具，完全的语言回复」。
> 结论：**不是插件缺陷，是账号配额耗尽**。本文存档现象、判据与排查路径，
> 避免下次重新诊断一遍。

---

## 一、现象（用户可见）

在 DSH 里用 `qoder-cli` 的模型发消息，表现为：

- ❌ 没有思考过程
- ❌ 不会调用任何工具
- ✅ 只有一段纯语言回复

看起来像「模型能力退化」或「插件把工具通道弄丢了」。

## 二、真相（原始证据）

CLI 原始 transcript（`-o stream-json`）：

```
[init] model=Qwen3.7-Plus
[assistant/text] You've reached your credit usage limit.
                 Please upgrade your subscription plan to get more resources.
                 Report Issue (input /feedback)
[result] is_error=True  turns=1  credits=0
```

**`credits=0` 且 `turns=1` 且 `is_error=True`** —— 模型**根本没有被调用**。
返回的那段文字是**服务端固定文案**，被 CLI 当作普通 assistant text 吐了出来。

### 一个原因解释全部三个现象

| 现象 | 原因 |
|---|---|
| 没有思考过程 | 没有发生推理（模型未运行） |
| 不调用工具 | 模型未运行，自然不会产生 `tool_use` |
| 只有纯语言回复 | 那是服务端文案，不是模型输出 |

**判据：若 `result.credits === 0` 且 `num_turns === 1` 且 `is_error === true`，
先怀疑配额，不要怀疑代码。**

## 三、排查路径（下次照做，别重走弯路）

1. **看 `credits`**。真实调用必然产生积分（哪怕 0.5）。
   `credits=0` + `is_error=true` ⇒ 请求被上游拒绝。
2. **看文本内容**。含 `credit usage limit` / `upgrade your subscription` ⇒ 配额耗尽。
3. **不要先怀疑 `--thinking disabled`**。曾误判此因，实测排除：
   ```
   default              blocks=[thinking, tool_use, text]  turns=2  credits=11.20
   --thinking disabled  blocks=[tool_use, text]            turns=2  credits=4.93
   ```
   两者**都正常调用工具**（`tool_use` 均在，`turns` 均为 2）。
   `--thinking disabled` 只是省掉 `thinking` 块，这是**预期行为**。

## 四、容易混淆的三种"没反应"

| 症状 | 根因 | 判据 |
|---|---|---|
| **配额耗尽** | 账号积分用完 | `credits=0` + `is_error=true` + 文案含 `credit usage limit` |
| **频率限制** | 请求过密（429 soft_rate） | HTTP 429 / `code 6004`；`credits` 正常但有额度 |
| **沙箱杀进程** | 宿主禁止起子进程 | 退出码 `3221225794` = `0xC0000142`，子进程 ~10ms 被杀 |

**三者机制完全不同，处置也不同**：配额要充值/等重置；限流要降并发；沙箱要换宿主。

## 五、本仓库的实测成本参考（供估算）

真机调用实测积分：

```
qmodel_38max  6.765 / 6.699 / 6.749 / 1.103 / 1.009       ← 昂贵且波动大
qmodel 工具任务  11.202（default） / 4.926（--thinking disabled）
qfmodel       0.577（billable: false）
```

**教训**：`qmodel` 默认思维链无上限，单次可烧 6~11 积分。
**做探针或调试时应优先用 `qfmodel`**（`billable:false`），
把 `qmodel` 留给真正需要能力的场景。这一条是本仓库用真金白银换来的。

`--thinking disabled` 可把 `qmodel` 从 1.103/6.765 的不稳定区间压到稳定的 ~0.55
（见 commit `3f71096`），**既省钱也消除方差**。

## 六、运维建议

- 额度将尽时，插件侧无法给出比上游文案更准确的信息 —— **保持原样透传**，
  不要包装成"模型不可用"，否则会掩盖真实的配额原因。
- 若要多账号轮换，`lib/qoder/credential-failover.js` 已有候选凭据发现与
  `probeCredential` 可用性探测；但**本仓库未验证过配额耗尽场景下的自动切换**。
