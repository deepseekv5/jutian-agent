# 安装与启动

> [← 返回文档索引](../../README.md#docs)

## 系统要求

| 项 | 要求 |
|---|---|
| macOS | 12 Montera 及以上,Apple Silicon 原生支持 |
| Windows | 10 / 11,x64 |
| Node.js | 18+(源码方式运行需要;安装包方式不需要) |
| 网络 | 仅在你配置了云端模型服务时需要;本地模型断网可用 |

## 方式一:下载安装包(推荐)

前往 [Releases](https://github.com/deepseekv5/jutian-agent/releases) 下载:

| 文件 | 说明 |
|---|---|
| `巨天agent-x.x.x-arm64.dmg` | macOS Apple Silicon,拖入 Applications |
| `巨天agent-x.x.x-arm64-mac.zip` | macOS 免安装,解压即用 |

macOS 首次打开若提示「无法验证开发者」(应用未做付费签名):

```bash
xattr -cr /Applications/巨天agent.app
# 或右键 → 打开
```

## 方式二:源码运行

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh          # Windows:双击 run.bat
```

`run.sh` / `run.bat` 检测到缺依赖会自动执行 `npm install`,然后同时启动:

- 后端服务 `:3211`(工具 API + llm-proxy)
- 前端 Vite `:5173`(热更新),浏览器访问 http://localhost:5173

## 方式三:手动

```bash
npm install
npm start         # 等价于 run.sh 的内容
```

## 首次配置

1. 打开 **设置 → 推理**
2. 填入任意 **OpenAI 兼容服务**的地址、密钥与模型名(OpenAI / DeepSeek / 智谱 / Ollama / LM Studio 均可)
3. 点「拉取模型列表」可直接选择,不必手敲模型名
4. 完成——应用不内置任何模型服务,你的密钥只存在本机 SQLite

详见 [模型接入](models.md)。

## 常见安装问题

**端口 3211 被占用**
后端默认固定 3211。`lsof -i :3211` 找到占用进程结束它,或设置环境变量 `PORT` 换端口。

**Windows 下 better-sqlite3 报 ABI 错误**
原生模块需要与 Electron 匹配的预编译产物。执行 `npm run electron:build:win` 会自动走正确的重编流程;纯开发模式(`npm run dev`)用系统 Node 的 ABI,一般无需处理。

**语音功能不可用**
桌面语音依赖打包时注入的 edge-tts 运行时。从 Releases 下载的官方包自带;自己源码打包时需要设置 `EDGE_TTS_DIR` 环境变量指向 openai-edge-tts 源码目录,见 [构建与发布](../dev/build.md)。

## 升级与卸载

- **升级**:下载新安装包覆盖,或源码方式 `git pull && ./run.sh`
- **彻底卸载**:删除应用后,数据目录在 `~/.lyclaw/`,不想留任何痕迹就删掉它——所有会话、密钥、记忆都在这一个目录里
