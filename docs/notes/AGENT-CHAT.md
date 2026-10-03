# 员工对话 / 群组群聊（Agent Chat）

> 版本：v1.0 · 2026-09-28 · 隶属「集群指挥室」体系

## 能力总览

| 能力 | 入口 | 说明 |
|---|---|---|
| 员工单独对话 | 集群页员工卡片「聊天」/ 侧边栏 → 集群 | 每个员工一个独立标签页、独立记忆（localStorage 分桶） |
| 群组群聊 | 集群页群组卡片「进入群聊」 | 多名成员同一个标签页，回复带身份 |
| 指定老板 | 群组卡片 / 群聊头部下拉 | 用户没 @ 人时由老板先接话并分派 |
| @ 点名 | 输入框 `@` 或点成员头像条 | 用户 @ 谁就只有谁回答；老板可在回复里 @ 指派同事接力 |
| 多实例 | 标签栏 | 员工、群组标签均为多实例，可同时开多个（同一对象重复点击只聚焦） |

## 关键文件

```
src/shared/employees.ts                 Employee + Group 模型、loadGroups/saveGroups/createGroup/groupMembers/groupBoss
src/renderer/components/agent/AgentKit.tsx    头像/持久化/人设提示词/@菜单/Markdown/打字指示器/贴底滚动
src/renderer/components/agent/agentRun.ts     runAgent：复用 streamChat（自动带 37 个内置工具）
src/renderer/components/EmployeeChatTab.tsx   员工单独对话
src/renderer/components/GroupChatTab.tsx      群聊（点名/老板指派/串行接力）
src/renderer/components/EmployeesPanel.tsx    集群指挥室：群组管理 + 员工聊天入口
src/renderer/components/TabBar.tsx            PageType 增加 employee/group；WorkTab 增加 refId/iconPath
```

## 数据与持久化

- 员工/群组：`localStorage['jutian_employees']`、`['jutian_groups']`（首次使用自动写入「默认团队」，
  成员为内置 5 人，老板默认「总管」；改动派发 `employees-changed` / `groups-changed` 事件，各标签页实时刷新）
- 群聊记录：`jutian.agent.msgs.emp.<员工id>` / `jutian.agent.msgs.grp.<群组id>`，保留最近 120 条
- 标签页状态：`lyclaw_tabs` / `lyclaw_active_tab`（refId 指向员工/群组，重启后恢复）

## 协作流程（GroupChatTab.send）

1. 解析用户消息里的 `@成员名`（长名优先，避免「开发」抢先匹配「开发组长」）
2. 有点名 → 只让被点名者回答；无点名 → 老板先答（未指定老板则第一位成员）
3. 每轮串行执行：先显示该成员打字指示器 → 流式输出 → 落库
4. 老板回复里的 `@成员` 会继续派给被指派者（`first.push` 动态扩展队列，已答过的不重复），实现一层 delegation

## 人设提示词

`buildAgentSystemPrompt(emp, settings, extra)` = 员工 prompt（创建/编辑时填写）+ 身份/职责/风格 +
运行环境（系统、工作目录、工具能力）+ 场景说明（群聊成员清单、老板是谁、@ 用法）。
每个员工可用自己的 `model`，未设置则跟随全局设置。

## 注意事项

- 员工与主对话共用 `streamChat`，因此自动具备全部 37 个内置工具与相同的权限/思考机制
- 标签页本体只渲染激活标签，切走再切回会从 localStorage 恢复（与 App 其他标签一致）
- 新标签类型**不要**加进 `SINGLE_INSTANCE`（需要多实例）
