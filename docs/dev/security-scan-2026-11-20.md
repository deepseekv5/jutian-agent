# 全项目安全扫描复核报告（2026-11-20）

## 扫描概况

- 工具：Mimosa security scan（depth=normal；deep 模式在 audit 阶段挂起，取消后改 normal 完成）
- 扫描 ID：`scan-2026-11-20T13-07-01.925Z-0c8582b63872`
- 封印：`sha256:4b143936548a28e528d23f60977b0eabd1ba1018aaec94262f8cc2554ca10b19`
- 原始 finding：**591**（HIGH 487 / MEDIUM 54 / LOW 50）
- 依赖扫描：1024 包，npm audit 复核 **0 漏洞**（离线 advisory 的 6 条匹配为模糊误报）

## 关键结论：591 条中 0 个可利用漏洞，1 处防御加固

静态扫描器把「用了危险 API」当成漏洞报，但**审计的核心是真实数据流是否可控**。逐类复核如下。

### 一、551 条来自 `python-runtime/lib/python3.11/` —— 全部误报

这是 vendored 的 **Python 标准库**，不是我们写的代码：
- `bdb.py` / `code.py` / `doctest.py` / `dataclasses.py` 里的 `exec`/`eval` 是 Python 调试器、交互式解释器、doctest、dataclass 生成器的**标准实现**（CPython 官方源码）
- `urllib/request.py` 的明文协议是 Python 标准库支持的 telnet/ftp 协议处理器
- `*_support.py` / `aifc.py` 的路径处理是标准库内部文件操作

这些文件随 python-runtime 一起打包（离线 STT/TTS 用），不可修改也不应修改——改了反而破坏 Python 运行时。**处置：不修，记录在案。**

### 二、40 条一方代码（src/）—— 逐项复核

| 类别 | 数量 | 判定 | 依据 |
|---|---|---|---|
| SSRF `serve.ts` 多处 | 13 | 误报 | `serve.ts:440-498` 已有完整 SSRF 防护：私网 IP / 169.254.169.254 云元数据 / 重定向后二次校验。所有 finding 都是「fetch(变量URL)」静态命中，URL 来自硬编码常量（技能市场 repo）或已过 safeFetch 的用户请求 |
| 硬编码凭据 `stream.ts:147` | 1 | 误报 | `apiKey: 'lm-studio'` 是 LM Studio 本地模型的**约定占位符**（社区标准，LM Studio 不校验 key），非真实凭据 |
| 硬编码凭据 `SettingsModal.tsx:1749` | 1 | 误报 | 该行是**生成随机密钥**的代码（`crypto.getRandomValues`），不是硬编码密钥 |
| 命令注入 `serve.ts:82/3752` | 2 | **部分属实→已加固** | `process.env.PYTHON_BIN || "python3"` 来自环境变量（启动者控制），注入风险低但可收紧白名单——见下方"修复" |
| 命令选项注入 `serve.ts:3061-3086` | 5 | 误报 | `open_path` 的 URL 分支先校验 `^https?://`，且 `spawn(prog, [arg])` 走 **argv 数组**不经 shell；文件路径分支走 `resolveWork`+`ok()` 白名单 |
| 不可信参数向量 `serve.ts:692` | 1 | 误报 | shell 工具 `spawn(bin, args, ...)` 用 argv 数组，无 shell 字符串拼接 |
| 跨文件污点（MEDIUM）`serve.ts` 多处 | 16 | 误报 | 全部是「环境变量 → personaChat.ts:286 的 SSRF」这一条链。环境变量是启动者控制的本地配置（apiBase 等），非远程输入；且 `personaChat.ts:286` 实际是相对路径 `/api/persona-memories/...`（走本地同源代理），sink 判定本身错误 |
| other-security HIGH `serve.ts` 其余 | 1 | 误报 | 同上静态命中 |

### 三、历史已修复的安全项（回归确认）

- v12.6：更新包 SHA-256 校验 / 协议注入 XSS（safeUrl 白名单）/ webview partition 隔离 / TTS 管道阻塞
- v14.12：危险命令拦截 / 注入扫描 / 密钥屏蔽 + `{{KEY}}` 占位符（在 executeToolCore 统一接线，serve.ts:2734-2761）
- SSRF 防护 `serve.ts:440-498`（私网/元数据/重定向二次校验）
- MarkdownPreview `safeUrl()`（stream.ts / MarkdownPreview.tsx）
- Mermaid `securityLevel: 'strict'`（mermaid 自消毒 SVG）
- v18.1.1：静默自动更新补传 SHA-256/size（此前漏传致校验跳过）

这些都是 mimosa 未报出但真实存在的防护——扫描器只看模式，看不到已有的缓解措施。

## 本次实际修复

1. **PYTHON_BIN 白名单加固**（v18.1.2）：抽 `safePythonBin()` 统一收口 serve.ts 四处使用，`process.env.PYTHON_BIN` 从"任意可执行程序"收紧为"已知解释器名（python/python3/py）或合法绝对路径且 basename 必须是 python 解释器"，带 shell 元字符的值一律回退 python3——防止启动环境变量被注入指向恶意程序，同时不破坏桌面启动器注入的绝对路径配置。
2. **审计报告归档**（本文件）：逐条 finding 判定与证据，供后续复核。

## 未修项的正当性

「全部修复」在安全工程里不等于「把所有静态命中改掉」——把 Python 标准库的 exec 改掉会破坏运行时，把 `fetch(variable)` 全禁掉会摧毁 Agent 的联网能力。真正的修复是：**确认每一条的真实数据流不可控，或已有缓解**，并对确实可收紧的点（PYTHON_BIN）加固。本报告即为逐条判定证据。

## 复扫建议

若要对一方代码做更精确的分析，建议：
- scope 限定 `src/` + `electron/`（排除 python-runtime / node_modules / dist），避免 551 条 vendored 误报淹没真正问题
- deep 模式在超大仓库会挂起，用 normal + 人工复核污点链更实际
