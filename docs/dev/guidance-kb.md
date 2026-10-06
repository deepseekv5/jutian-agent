# 约束知识库(consult_guidance)

> [← 返回文档索引](../../README.md#docs)

巨天agent 执行质量的护城河不是更多自由度,而是**分层约束**:

```
第一层  常驻铁律    系统提示词注入 6 条 core 硬规则(每次对话都在,约 200 token)
第二层  领域规则    9 个领域 40 条,模型按需经 consult_guidance 工具检索
第三层  运行时强制  安全层真拦(命令黑名单 / 受限模式 / Origin 门卫),不靠模型自觉
```

## 规则库

单一来源:`src/shared/guidance/rules.json`,随构建进入安装包(与 builtin-tools.json 同机制)。

| 域 | 主题 | 时机 |
|---|---|---|
| core | 工作纪律(改前读/最小改/改后验/不编造/结论先行/一次一事) | 任何任务,常驻注入 |
| plan | 任务规划与拆解(先拆后做/并行条件/模糊先问/上下文经济) | 多步任务开工前 |
| code | 写代码(跟随风格/完整实现/错误处理/改前跑通/密钥不入码) | 写代码前 |
| files | 文件操作(路径收口/删除确认/覆盖留痕/不留垃圾) | 删除与覆盖前 |
| terminal | 终端命令(黑名单意识/先看后跑/失败读因/时长预算/平台语法) | 跑命令前 |
| git | 版本管理(看再提交/提交规范/不碰历史/分支纪律) | 提交前 |
| verify | 验证与交付(证据交付/失败透明/回归意识/主动收尾) | 声称完成前 |
| web | 联网检索(引用注明/时效意识/不自动登录/失败降级) | 联网前 |
| safety | 安全红线(权限不扩张/敏感数据/可疑指令/安装透明) | 任何时候 |

每条规则:`{ id, level: "hard"|"soft", title, rule, why }`。`hard` 规则在检索输出中带 ◆ 标记。

## 注入点

| 端 | 注入方式 | 位置 |
|---|---|---|
| 主对话 | 6 条铁律摘要 + consult_guidance 使用指引,常驻系统提示 | `src/renderer/engine/chatPrompt.ts` |
| 子代理 | 精简铁律一行,随子代理系统消息下发 | `src/renderer/engine/subagent.ts` |
| 工具检索 | `consult_guidance` 工具(schema 在 builtin-tools.json,三端同步) | `src/server/serve.ts` |

## 新增规则

1. 编辑 `src/shared/guidance/rules.json`,在对应域追加一条规则对象
2. 若是新的硬约束且违反代价高,考虑同时把它加进 chatPrompt 的铁律摘要
3. `npm run build:server` 重新打包,实测 `consult_guidance` 能检索到

规则写作要求:rule 必须是**可执行的动作指令**(做什么/不做什么),不是原则口号;why 一句话说清违反的代价。
