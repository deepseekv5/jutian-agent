# LY HARNESS — 插件中心

> [← 返回文档索引](../../README.md#docs)

**一切皆插件。**LY HARNESS 是巨天agent 的能力中枢:每个内置工具都能单独开关,每个 MCP 服务即插即用,每条经验都能沉淀为 Skill。

## 入口

顶栏铃铛旁进入通知中心,**插件**标签页即 LY HARNESS 面板;也可以从任意会话的工具调用卡片点进去。

## 内置工具开关

38 个内置工具,每个都有独立开关与一行说明:

| 分类 | 代表工具 |
|---|---|
| 文件 | `read_file` `write_file` `edit_file` `search_files` `list_dir` `move_file` |
| 终端 | `shell` `process_list` `port_check` `system_info` |
| 网络 | `web_fetch` `web_search` `http_request` |
| 代码 | `git_operation` `npm_run` `code_analysis` |
| 实用 | `json_process` `base64_tools` `hash_tools` `uuid_generate` `timestamp_tools` |
| 记忆 | `remember` `recall` `forget` `save_knowledge` |
| 技能 | `list_skills` `load_skill` `install_skill` `create_skill` |

- 关掉的工具**不会出现在模型视野里**,不占上下文也不可用
- 开关状态立即生效,无需重启
- 想收敛模型能力面(比如只让它读写文件)时,把其余开关批量关掉即可

## MCP 服务

MCP(Model Context Protocol)服务在这里注册与管理:

- 填 command / args / env,以 stdio 子进程方式拉起
- 支持 enable / disable,启动失败会显示退出原因
- MCP 工具与内置工具在模型眼里完全同构,命名 `mcp__<服务>__<工具>`

## Skills

- `create_skill` 把一次成功的做法沉淀为带 SKILL.md 的技能目录
- `load_skill` 按消息挂载,给当轮对话注入方法论
- 技能库与本机共享:`~/.lyclaw/skills/`

## 工具 Schema 单一来源

所有工具的定义集中在 `src/shared/builtin-tools.json`,桌面端、手机远程端、服务端三方读同一份——加一个工具,三端同时可用。想自己加工具?看 [新增一个工具](../dev/add-tool.md)。
