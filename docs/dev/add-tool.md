# 新增一个工具

> [← 返回文档索引](../../README.md#docs)

给巨天agent 加一个模型可调用的工具,总共两步:**serve.ts 里写实现 + builtin-tools.json 里写 schema**。不需要动任何前端代码。

## 第 1 步:实现(src/server/serve.ts)

在 `TOOLS` 对象里注册一个 async 函数:

```ts
async function my_tool(a: any) {
  const name = String(a.name || "world");
  try {
    const out = `hello, ${name}`;
    return { success: true, output: out };        // ← 唯一合法的返回形状
  } catch (e: any) {
    return { success: false, error: String(e.message || e) };
  }
}

// 注册进 TOOLS 表
TOOLS.my_tool = my_tool;
```

**铁律:返回必须是 `{ success, output }` 形状。**渲染层、手机远程、子代理都按这个形状解析;返回裸字符串会导致所有端不显示结果。

约定:

- 参数从 `a` 取,全部做 `String()` / 兜底默认值——模型给的参数不可信
- 失败走 `success: false` + `error` 字段,别抛异常到顶层
- 破坏性操作(删除 / 覆盖)先做存在性检查;`shell` 工具已有命令黑名单,新工具也别放行 `rm -rf /` 这类命令

## 第 2 步:Schema(src/shared/builtin-tools.json)

按 OpenAI function calling 格式追加:

```json
{
  "type": "function",
  "function": {
    "name": "my_tool",
    "description": "一句话说清楚它做什么、什么时候该用",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "对谁问好" }
      },
      "required": ["name"]
    }
  }
}
```

这个文件是**单一来源**:桌面端、手机远程、子代理三端读同一份,schema 描述直接决定模型何时调用它——写清楚「做什么、什么时候用、参数含义」,比多写代码更重要。

## 第 3 步:验证

```bash
npm run build:server && npm run lint
```

然后实测三条链路:

1. **桌面**:重启后端,对话里让它调用该工具,看工具调用卡片与结果渲染
2. **LY HARNESS**:插件中心面板里能看到新工具并能开关
3. **手机远程**:远程页发一条触发消息,确认结果同步

## 检查清单

- [ ] 返回 `{ success, output }` 形状
- [ ] 参数有兜底,不信任模型输入
- [ ] schema 的 description 写清使用时机
- [ ] `npm run lint` 零 error
- [ ] 三条链路(桌面 / 面板 / 手机)实测通过
