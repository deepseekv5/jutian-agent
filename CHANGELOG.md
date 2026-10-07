# 更新日志

所有显著变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [10.0.0] - 2026-10-08

### 技能系统重做(核心)
- **安装不再是空壳**:以前 install_skill / 市场安装只写一个不含任何内容的 skill.json,技能装上也不会干活。现在安装落地三件套——`skill.json`(完整元数据:名称/版本/作者/描述/标签/工具)、`SKILL.md`(带**真实可执行指令**的说明书)、`tools.json`(工具定义)
- **内置技能 5 → 10,全部带真指令**:文件整理/发票识别/图片搜索/文档撰写/PPT 制作(重写)+ 新增联网调研/代码评审/数据分析/Git 流程/版本发布;每个技能指令是分步流程,含确认点、铁律和产出格式,模型 load_skill 后按指令执行
- **老用户无感升级**:已存在的 `skill_market.json` 若是旧格式(缺指令),启动时自动与新版内置市场合并补齐——旧条目升级、用户自己添加的技能原样保留
- **AI 知道有什么技能了**:系统提示词新增「已安装技能」清单(名称+能力+load_skill 调用方式),意图匹配时模型第一步就加载技能,不再忽略技能自己摸索;技能安装/卸载/窗口聚焦时自动刷新清单
- **市场可预览指令**:卡片展开即可查看该技能的完整工作指令,装不装心里有数

## [9.0.0] - 2026-10-08

### 新增(Windows 专项)
- **shell 工具全面 Windows 化**:PowerShell 执行 + `[Console]::OutputEncoding=UTF8` 前缀(修掉 PS5.1 ANSI 码页中文乱码);黑名单补 PowerShell 破坏性命令形态(Remove-Item -Recurse / Cipher /W 等)
- **system_info / process_list / port_check 原生重写**:不再调用 macOS 专属 zsh/lsof/ps aux;Windows 走 PowerShell Get-Command / Get-Process / netstat,统统可用
- **工具乱用兜底**:模型调用不存在的工具时,返回「相近工具名 + 当前可用工具全清单(39 个)」,模型下一轮自动纠正,不再空转烧额度
- **jtcode CLI 工具调用循环**:从服务端拉取工具 schema,和桌面端同构的「模型→工具→结果→再问」循环,单轮最多 10 次;/tools 查看可用工具
- shell 工具描述平台化(不再写死「用户 Mac」,明确 Windows 用 PowerShell 语法)

## [8.1.0] - 2026-10-07

### 新增
- **应用内自更新**:设置 → 关于 检查更新,一键从 GitHub Releases 拉取 app.asar 原子替换并重启;全屏更新覆盖层(实时进度环/下载字节/可取消/倒计时重启);更新说明 Markdown 渲染;开机静默自检 + 通知中心提醒;导出诊断信息
- **免费模型第二源**:Pollinations(GPT-OSS 20B,推理+工具调用,免 key),与 Kilo 并列;面板改通用多源渲染,加新源只改 serve 一处
- **免费额度提供商** 8 家内置(智谱 GLM/硅基流动/Google AI Studio/Groq/Mistral/腾讯混元/ModelScope/火山方舟):端点实测存活,一键填入地址+模型

### 修复
- llm-proxy 空响应自动重试:免费模型 reasoning 吃满 max_tokens 返回空时,自动加大预算重发(最多 3 次);流式押后 [DONE],零正文换发
- free 哨兵被库内 key 覆盖导致 Kilo 401 的 bug(free/keyless 是免鉴权哨兵)
- Kilo 免费档过滤补 `/free` 结尾(openrouter/free 曾被错分到付费档)
- 设置 → 关于 tab 嵌着旧版内容,换成与独立关于页同一份 AboutContent

### 工程
- 类型门禁落地:修复全部 37 个存量 tsc 错误,CI 新增 npm run check + npm run verify(工具 schema/约束知识库/免 key 常量契约校验)
- tsconfig 职责分工:noUnused* 归 eslint,tsc 只管类型正确
- code 界面推倒重写:活动栏+唯一面板槽+底部抽屉,结构性杜绝浮层重叠(748→635 行)
- win 打包流程修正:better-sqlite3 必须换 electron-v130 win32 预编译产物,已在发布流程内置(PE32 校验)

## [8.0.0] - 2026-10-06

### 新增
- **免费模型面板**:Kilo Gateway 免 key 全量目录(399 个模型、21 个免费档),免注册一键切换、逐模型测速;配置 Kilo 账户密钥解锁 378 个付费档,密钥仅存本机
- 主张:「科技不是高高而上,而是服务于人民」— 免费档每 IP 200 次/小时,AI 没有门槛
- llm-proxy / models-list 支持免 key 网关(key 为 free 时不发 Authorization 头);付费档模型自动换用 Kilo 账户密钥

### 移除
- Computer Use(截屏操作循环):专注「对话/代码/集群」主链路,移除 UI、主进程注册、预加载 API 与全部引用(代码在 git 历史中可溯)

## [7.0.0] - 2026-10-04

### 新增(10-06 增补)
- 约束知识库 `consult_guidance`:9 领域 40 条工作规则(纪律/规划/代码/文件/终端/git/验证/联网/安全),主提示词常驻 6 条铁律摘要,完整规则由模型按需检索;子代理同享精简铁律

### 新增
- 子代理集群:`dispatch_subagents` 并行工作池(并发 3),侧栏实时进度追踪,@援军接力
- Computer Use:截屏 → 决策 → 执行 → 验证循环,支持逐步确认模式
- MCP 客户端:stdio JSON-RPC 2.0,initialize 握手 / tools/list 缓存 / schema 预校验
- 手机远程:局域网扫码配对,消息/工具/截图/子代理进度全量同步到手机
- LY HARNESS 插件中心:38 个内置工具逐个开关,MCP 服务管理
- 通知中心:集群完成 / 子代理批次 / 定时任务 / 手机接入统一聚合
- 可编辑 diff:主对话与代码模式共享,支持逐块编辑应用与撤销
- 一键启动脚本 `run.sh` / `run.bat`(缺依赖自动安装)

### 变更
- 数据目录统一到 `~/.lyclaw`,旧 `~/.laoyou-agent` 启动时自动迁移
- 后端源码化:`src/server/serve.ts` 为唯一源码,`serve.cjs` 改为构建产物
- MIT 开源:LICENSE / COPYRIGHT / 更新日志与社区文件齐全

### 安全
- 移除 `Access-Control-Allow-Origin: *`,跨站请求一律 403
- DNS-rebinding 防护(回环来源 + Host 校验,不符 421)
- 所有 GET 回包密钥自动掩码;掩码值禁止写回存储;复合键(qq_secret 等)包含匹配
- 备份导出携带真实密钥以支持还原(端点受同宿主门卫保护),导入跳过掩码值
- 修复 esbuild 变量遮蔽导致 `GET /` 恒 404 的静默缺陷

## [5.0.0] - 2026-09(概要)

- 渲染层架构化重组:app / chat / code / agents / computer / panels / settings / engine 分域
- Computer Use 与 MCP 客户端首发;手机远程雏形;窗口状态持久化

## [4.0.0] - 2026-09(概要)

- 双对话模式(主对话 / 代码模式)、模型列表自动拉取
- 导出 / 粘贴图 / 自动朗读 / 主题跟随 / 内容搜索 / 本地备份
- 30+ 体验增强:消息分支、命令面板、截图标注、托盘等

## [1.0.0 - 3.x] - 2026-08~09(概要)

- 桌面 AI 工作台成型:对话 / 代码 / 终端三视图,工具调用链路,知识库
