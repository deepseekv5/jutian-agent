# 安装与启动

**简体中文** | [English](../en/guide/install.md)

> [← 返回文档索引](../../README.md#docs)

## 系统要求

| 项 | 要求 |
|---|---|
| macOS | 12 Monterey 及以上,Apple Silicon 原生支持(Intel 包同样提供) |
| Windows | 10 / 11,x64(另提供 arm64 包) |
| Linux | AppImage 通用,或 deb(Debian/Ubuntu);老发行版可用 tar.gz 兜底 |
| Android | 本地版 APK 内置内核,独立运行,无需电脑 |
| Node.js | 18+(源码方式运行需要;安装包方式不需要) |
| 网络 | 仅在你配置了云端模型服务时需要;本地模型断网可用 |

## 方式一:下载安装包(推荐)

前往 [Releases](https://github.com/deepseekv5/jutian-agent/releases) 下载(国内网络可用 Gitee 镜像仓库同名资产);`<版本>` 即版本号,当前 v18.1.2:

| 文件 | 说明 |
|---|---|
| `jutian-agent-<版本>-arm64.dmg` / `-x64.dmg` | macOS(Apple Silicon / Intel),拖入 Applications |
| `jutian-agent-<版本>-arm64-mac.zip` / `-x64-mac.zip` | macOS 免安装,解压即用 |
| `jutian-agent-<版本>-setup.exe` | Windows 安装器 |
| `jutian-agent-<版本>-x86_64.AppImage` 等 | Linux:AppImage 免安装 / deb / tar.gz 兜底 |
| `jutian-local-<版本>.apk` / `jutian-remote-<版本>.apk` | Android 本地版(内置内核独立跑)/ 远控版(连电脑) |

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

## 应用内更新(v18.1.1 起)

**设置 → 关于 →「检查更新」**,三条链路按平台自动选择:

| 平台 | 链路 |
|---|---|
| macOS / Windows | 拉取 `jutian-agent-<版本>-app.asar`,SHA-256 校验 → 写 `.new` → 备份 `.bak` → **原子替换**;Windows 运行中 asar 被锁定,下次启动前换名 |
| Linux | 同样提供 asar 更新包;AppImage / deb 安装目录通常只读,应用会预检并提示,此时下载完整包覆盖更新(tar.gz 自解压场景可热更新) |
| Android | 本地版 APK 在「关于」页**热更新内核包**(`jutian-mobile-<版本>.zip`,SHA-256 校验 + 原子换名),无需重装、无需 root;`bundle-base-version` 版本戳保证不被 APK 内置旧包覆盖 |

后台静默自检(开机 12 秒与每 30 分钟)同样走哈希校验,发现新版自动下载,「重启即用」;更新失败自动回滚,不损坏现有版本。三条链路的完整说明见文档中心「应用内更新」页([docs/guide.html](../guide.html))。

注意:asar 更新包带不了 `app.asar.unpacked` 里的原生模块——升级 better-sqlite3 / Electron 的版本会发完整安装包并在说明标注。源码方式运行则 `git pull && ./run.sh` 升级。

## 卸载

- **彻底卸载**:删除应用后,数据目录在 `~/.lyclaw/`,不想留任何痕迹就删掉它——所有会话、密钥、记忆都在这一个目录里
