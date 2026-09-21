# SECURITY-AUDIT.md — dsh-websearch-direct 发布前安全审查

**审查对象**：`C:\Users\Administrator\WorkBuddy\2026-09-19-19-14-44\dsh-websearch-direct`
**方式**：只读扫描（本 agent 对源码目录**无写权限**，见 §4）
**执行时刻**：2026-09-20
**语料范围**：**全部 46 个文件**（递归，排除 `.git`；**目录内无 `.git`**）

---

## 结论：**无凭据泄露，可以公开**

**0 个 blocker、0 个 high。** 检出项全部为**本机路径/内部文档**类，
**不含任何真实 token / API Key / UID / machine_id / 邮箱 / 手机号**。

| 类别 | 结果 |
|---|---|
| 真实凭据（token / API Key / 私钥 / 密码） | **0** ✅ |
| 真实个人信息（邮箱 / 手机号 / UID / machine_id） | **0** ✅ |
| 本机绝对路径 | **6 处**（均为本地辅助脚本/交接文档，**建议排除发布**） |
| git 历史风险 | **不适用** —— 目录内**没有 `.git`**，无历史可泄漏 ✅ |

---

## §1 逐项扫描结果

### 1.1 凭据类 —— **0 命中**（重点确认）

| 模式 | 命中 | 说明 |
|---|---|---|
| `Bearer <长串>` | 0 | |
| `Authorization:` 头带值 | 0 | |
| `sk-` / `pk-` / `ghp_` / `gho_` / `github_pat_` | **2** | 见下，**均为测试占位符** |
| URL 查询串里的 `token=`/`api_key=` | 0 | |
| `Set-Cookie` / `Cookie` 带值 | 0 | |
| `-----BEGIN … PRIVATE KEY-----` | 0 | |
| `password="…"` 字面量 | 0 | |

**两处 `ghp_` 命中 —— 均为测试占位符，安全**（`ghp_` 前缀只是格式模仿，非真实凭据）：

| 文件:行 | 值 | 说明 |
|---|---|---|
| `test-v0.3.mjs:211` | `ghp_THIS_TOKEN_IS_INTENTIONALLY_INVALID` | 注释明写"**故意用无效 token**"，用于验证"GitHub Token 只发给权威直连入口、不发给第三方加速代理"（F1 用例） |
| `test-v0.4-ui.mjs:88` | `ghp_TEST_TOKEN` | U2 用例的请求体占位值（配套 `apiKeySet === true` 断言） |

> **已做全量清查**：扫描全部 44 个文本文件，**除上述两处外，无任何** `sk-`/`pk-`/`ghp_`/`gho_`/`ghs_`/`ghu_`/`github_pat_` 形态的串
> （判据：把含 `INTENTIONALLY_INVALID` 的排除后，剩余"看着像真 token"的命中数 = **0**）。

### 1.2 个人信息 —— **0 命中**

| 模式 | 命中 |
|---|---|
| 邮箱（任意） | **0** |
| QQ 邮箱 `<EMAIL>` | **0** |
| 手机号 `1[3-9]xxxxxxxxx` | **0** |
| UID `<UID>` | **0** |
| machine_id `<MACHINE_ID>` | **0** |
| 账号名 `<ACCOUNT_NAME>` | **0**（源码里**从未出现**；仅将作为 GitHub 仓库所有者公开） |

### 1.3 本机路径 —— **6 处**（建议排除，非凭据）

| 文件:行 | 内容 | 判定 |
|---|---|---|
| `install.mjs:17` | `const HOME = 'C:\\Users\\Administrator\\AppData\\Roaming\\dsh-desktop\\harness';` | ⚠️ **硬编码本机用户名**；且是**本地安装辅助脚本**，发版走 `dsh plugin add` |
| `HANDOFF.md:153` | 同上路径（文档引用） | ⚠️ 内部交接文档 |
| `_backup-deployed-0.3.1/install.mjs:17` | 同上 | 历史备份 |
| `_release/HANDOFF.md:153` | 同上 | 历史快照 |
| `HANDOFF.md:140` | `D:\dsh` 本机路径 | ⚠️ 内部文档 |
| `README.md:129,326` + 多份 `dist/index.js` | `workbuddy` 字样（来源站点名，非路径） | ✅ **安全**——是搜索源标识，不是本机路径 |

> **注**：`dist/index.js` 与 `client/client.js` 内的 `workbuddy` 是**搜索引擎源的名字**，
> 属于产品功能（用户可见的源列表），**必须保留**。

### 1.4 内部文档（非安全问题，但影响市场观感）

| 文件 | 性质 | 建议 |
|---|---|---|
| `HANDOFF.md`（10 KB，**亦在 `_release/`**） | 开头明写 **"面向接手的 agent"** | **不发布**（面向 agent 的内部交接，非市场用户） |
| `_archive/`（3 份历史版本 + `.tgz`） | v0.3.1 / v0.4.3-rejected 存档 | **不发布** |
| `_backup-deployed-0.3.1/`（5 文件） | 已部署版备份 | **不发布** |
| `_release/*.tgz`（49,975 B） | 构建产物 | **不发布**（`.gitignore` 已排除 `*.tgz`） |
| `probe*.mjs`（**10 个**）+ `_all.log`（14,690 B）+ `t2.mjs` | 逆向侦察脚本与运行日志 | **不发布** |
| `test-v0.3.mjs` / `test-v0.4-ui.mjs` / `test.mjs` | 测试脚本 | 可发布（无敏感内容），但属开发资产 |

---

## §2 建议发布的内容（市场用户视角）

**应发布**（市场用户首次看到这个仓库时需要的东西）：

```
package.json          # 元数据
README.md             # 面向市场（已确认写法良好，含"安装"节）
cordis.patch.yml      # 插件挂载声明
dist/index.js         # 宿主半边（package.json main）
client/client.js      # 浏览器半边（设置卡片）
LICENSE               # ⚠️ 缺失，见 §3
test*.mjs             # 开发资产，可保留
preview/*.html        # 3 份卡片预览，有助于展示能力
```

**应排除**（本报告已据此给出 `.gitignore` 内容，见下）：
`_archive/`、`_backup-deployed-0.3.1/`、`_release/`、`*.tgz`、
`probe*.mjs`、`_all.log`、`t2.mjs`、`install.mjs`、`HANDOFF.md`

> **`HANDOFF.md` 需要 captain 决策**：它是**高质量的内部文档**，
> 但开头明确"面向接手的 agent"，且含本机路径。
> **我的建议：不发布**（发 `ARCHITECTURE.md` 类的中性文档更适合市场）。

---

## §3 仓库元数据检查

| 项 | 现状 | 判定 |
|---|---|---|
| `name` | `dsh-websearch-direct` | ✅ 与建议仓库名一致 |
| `version` | `0.4.6` | ✅ |
| `license` | `MIT` | ✅（但**缺 LICENSE 文件**，见下） |
| `description` | 中文长描述，信息完整 | ✅ |
| **`keywords`** | `["dsh-plugin","web-search","web-fetch","no-api-key"]` | ⚠️ **含 `dsh-plugin` ✅（市场硬性条件满足）**，但建议补齐见下 |
| **`repository`** | **缺失** | ❌ **建议补**（npm/market 显示源码入口） |
| `main` / `exports` | `dist/index.js` / `.` + `./client` | ✅ |
| `files` | `["dist","client","cordis.patch.yml"]` | ✅ 正确（npm 发布范围） |
| `dsh.bundle.patch` / `dsh.client.platform` | 均就位 | ✅ |

### 3.1 ❌ 必须补：`LICENSE` 文件

`package.json` 声明 `"license": "MIT"`，但**目录内没有任何 LICENSE 文件**（实测搜索 `LICENSE|COPYING` = 0 命中）。

**影响**：GitHub 仓库会显示"no license"，**法律上默认保留全部权利**——
**与 `package.json` 的 MIT 声明矛盾**，且市场用户无法合法使用。
**建议**：添加标准 MIT LICENSE 全文（著作权人填 `MYCF711`）。

### 3.2 建议补：`keywords` 与 `repository`

```jsonc
"keywords": [
  "dsh-plugin",          // ✅ 已有（市场硬性条件）
  "deepseek-harness",    // 建议加
  "dsh",                 // 建议加
  "cordis",              // 建议加
  "web-search",          // ✅ 已有
  "web-fetch",           // ✅ 已有
  "no-api-key"           // ✅ 已有
],
"repository": {
  "type": "git",
  "url": "git+https://github.com/MYCF711/dsh-websearch-direct.git"
},
"homepage": "https://github.com/MYCF711/dsh-websearch-direct#readme",
"bugs": { "url": "https://github.com/MYCF711/dsh-websearch-direct/issues" }
```

> ⚠️ **这些改动落在源码目录 `package.json`，而我对该目录无写权限**（§4）。
> **需 captain 或用户执行**，或授权我提权。

---

## §4 ⚠️ 执行阻塞：本 agent 既不能写源码目录，也不能跑 ssh

### 4.1 写权限（实测）

```
写 C:\Users\Administrator\WorkBuddy\...\dsh-websearch-direct\.write-probe
→ Access to the path ... is denied
```

**沙箱把我限制在 `D:\DSH` 工作区内**；源码目录在工作区外 ⇒ **只读**。
**且本会话的审批提示已禁用**（`approval prompts are disabled`），
故 `sandbox_permissions` 提权会**自动被拒** —— 不能靠重试解决。

### 4.2 ssh（实测，两种实现都失败）

| 尝试 | 结果 |
|---|---|
| `ssh -T git@github.com`（直接调用） | `ResourceUnavailable: 程序'ssh.exe'运行失败：拒绝访问` |
| 同上，改 `Start-Process` 落盘 | `failed to initialize w32posix wrapper`，**90s 超时** |
| `ssh -V`（**不需要网络**） | **60s 超时** ⇒ 说明**不是网络问题，是 ssh 进程本身起不来** |
| Git 自带 `C:\Program Files\Git\usr\bin\ssh.exe` | `couldn't create signal pipe, Win32 error 5`（**致命**） |

⇒ **与 skill `dsh-qoder-cli-repo` 记载一致**：
*"在 DSH agent 沙箱内，`git push` / `ssh` / `git ls-remote` 会报 … 这是管道的沙箱限制，不是网络问题。
需要 `sandbox_permissions: danger-full-access` 提权，或让用户在自己终端执行。"*
**本会话审批已禁用 ⇒ 只能由用户在自己的终端执行。**

**因此以下步骤我无法执行，需 captain / 用户在**自己的终端**完成**：
1. 写 `.gitignore`、`LICENSE`、改 `package.json`
2. `git init` / `add` / `commit`
3. `git push`

**我可以做的**（已完成）：**只读审计**（本报告）+ 准备**可直接粘贴的命令**（§6）。

---

## §5 网络状况（推送路径）

**实测**：

| 目标 | DNS | TCP:443 | 说明 |
|---|---|---|---|
| `github.com` | **127.0.0.1** ❌ | "成功"（是**本机回环**应答） | ⚠️ **被 hosts 阻断** |
| `ssh.github.com` | **20.205.243.160** ✅ | **成功** ✅ | ✅ **推送路径可用** |

**关键**：`C:\Windows\System32\drivers\etc\hosts` 中存在一个**`#S302` 阻断块**，
把 `github.com`(及 40+ 相关域名) 指向 `127.0.0.1`：

```
127.0.0.1 github.com #S302
127.0.0.1 api.github.com #S302
...
```

- **不是我加的**（hosts `mtime = 2026-09-20 12:12:37`，标签 `#S302` 我从未使用）。
- **对推送的影响有限**：SSH 配置走的是 **`ssh.github.com:443`**，
  该域名**不在阻断列表**且**实测 TCP 可达** ✅ ⇒ **推送路径应可用**。
- **对 API 的影响是致命的**：`api.github.com` → `127.0.0.1`
  ⇒ **无法用 API 创建仓库**（任务书 §④ 的 `POST /user/repos` **会失败**）。
  且**环境里没有任何 GitHub token**（`GITHUB_TOKEN`/`GH_TOKEN` 均未设置，`gh` CLI 未安装）。

**⇒ 创建仓库需 captain 手动**：在浏览器打开
`https://github.com/new`，填 `dsh-websearch-direct`，**public**，**不要勾选**
README/.gitignore/LICENSE（`auto_init: false`）。

---

## §6 待执行命令（供 captain / 用户在终端粘贴）

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-09-19-19-14-44\dsh-websearch-direct

# 1) 先放 .gitignore（内容见 D:\DSH\tmp\websearch-sec\gitignore-for-repo.txt）
#    再补 LICENSE / package.json 元数据（见 §3）

# 2) 初始化
git init -b master
git add -A
git -c user.name=MYCF711 -c user.email=MYCF711@users.noreply.github.com `
    commit -m "Initial commit: dsh-websearch-direct v0.4.6"

# 3) 远端（SSH over 443，配置已就位）
git remote add origin git@github.com:MYCF711/dsh-websearch-direct.git
git push -u origin master

# 4) 加 topics（推送后，在仓库页面 Settings → Topics）
#    dsh-plugin  deepseek-harness  dsh  cordis  web-search  search-plugin
```

**推送前自检**（确认排除生效）：
```powershell
git ls-files | Select-String -Pattern '_archive|_backup|_release|\.tgz$|probe|_all\.log|HANDOFF|^install\.mjs'
# 期望：无输出
```

---

## §7 本报告边界

- **只读审查**：未修改源码目录的**任何文件**（无写权限，见 §4）。
- **语料 = 全部 46 个文件**（递归），**非抽样**；`_archive/`、`_backup-*/`、`_release/` **已全部纳入扫描**。
  ⚠️ **口径说明**：46 个文件中 **44 个作为文本读取**，2 个为二进制/压缩包
  （`_archive/v0.3.1-qualified/dsh-websearch-direct-0.3.1.tgz` 等 `.tgz`），**按文本扫描会跳过**——
  它们**已被建议排除发布**，故其内部内容不进入公开面。
  > 引用"扫描了 46 个文件"时请注意：**46 = 文件总数，44 = 实际读为文本的数量**（本报告两者都写明，避免口径混淆）。
- **未扫描**：二进制/压缩包内容（`_release/*.tgz`、`*.tgz`）——
  但**已建议排除发布**，故其内部内容不影响公开面。
- **无 git 历史可查**：目录内**没有 `.git`**，不存在"删文件不删历史"风险。
  ⇒ **本仓库的历史风险为 0**（与本会话早些时候 `dsh-qoder-cli` 的情况**根本不同**）。
- **未执行推送**：受沙箱与网络双重限制（§4、§5）。
