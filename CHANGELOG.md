# Changelog

本文件记录本插件的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.5.0] — 2026-09-21

### 新增

- **本地 Qoder CLI 成为一等通道**，不再只是 `qfmodel` 的补丁。
  当 REST 网关以 `invalid_model_error` 拒绝某个模型时，
  自动改由本地 CLI 的 `-p` 打印模式服务该模型。
- **REST 与 CLI 两侧的模型清单互相同步校验**：
  `models.js` 的 `REJECTED_QODER_KEYS` 与 `cli-fallback.js` 的
  `CLI_FALLBACK_MODELS` 由测试断言保持一致。
- **流内错误检测**：网关可能返回 HTTP 200 却在流里报错。
  新检测同时识别四类字面量与 **OpenAI 标准错误信封**
  （`data: {"error":{"code":…}}`）。
- **无 WASM 分发**：凭据编解码改为纯 JS，安装体积从 218 KB 降至 101 KB。

### 修复

- **CLI 回退从不触发** —— 对 `"Unsupported model"` 的匹配区分了大小写，
  而网关实际返回的是 `"invalid_model_error"`。已改为按错误码判定。
- **CLI 回退未覆盖 `server_error`** —— 现在也触发。

### 变更

- `qfmodel`（Qwen3.8-Flash）成为默认启用模型。
  依据是三项实测：它**能用**（同账号同时刻其他 key 报额度墙）、
  **免费**（`price_factor: 0`）、且是**推理模型**。
  此前默认值是 `qmodel`，而它正是网关当前拒绝的那个 key。

---

## [0.4.0] — 2026-09-20

### 新增

- 模型目录三层链：内置清单 → 远端目录 → 本地缓存，
  每层都可标记 `degraded`。
- 账号卡片显示资源明细与用量统计。

---

## [0.3.2] — 2026-09-20

### 新增

- 为 `qfmodel` 增加 CLI 回退。
- 纯 JS 凭据编解码器（移除 WASM 依赖）。
- 远端目录层。

---

## [0.3.1] — 2026-09-19

### 修复

- 账号卡片在点击后消失。

---

## [0.3.0] — 2026-09-19

### 新增

- 多账号形态：账号卡片、资源明细、用量统计 tab。
- 凭据 failover。
- 主题适配（DSW 主题 token）。
- gate 探测与模型目录。

---

## [0.2.0] — 2026-09-18

### 新增

- 首次发布：把 Qoder 的模型接进 DSH 的模型选择器。

---

## 未发布

### 修复

- **设置卡片点击后消失** —— `ghostButton` 在其 `const` 初始化前被引用，
  触发 TDZ 错误导致渲染抛异常、slot 宿主卸载卡片。
  已将 `ghostButton` 提升到 `accountRow` 之上。
- **默认模型指向不可用的 key** —— 同时修正了掩盖此问题的误判。

### 变更

- 账号行两个按钮更名为 **「一键签到」** 与 **「登录账号」**，
  与它们实际触发的动作一致。

### 测试

- 新增对上述账号动作的断言（此前无任何测试覆盖）。
- 新增卡片布局回归测试，覆盖 TDZ 那个错误类别。

---

[0.5.0]: https://github.com/MYCF711/dsh-qoder-cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/MYCF711/dsh-qoder-cli/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/MYCF711/dsh-qoder-cli/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/MYCF711/dsh-qoder-cli/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/MYCF711/dsh-qoder-cli/compare/v0.2.0...v0.3.0
