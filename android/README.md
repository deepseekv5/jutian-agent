# 巨天agent 手机端（Android）

## 这是什么

一个 **54KB 的 WebView 壳**，用来在手机上使用你电脑上的巨天agent。

它不把界面打进 APK——手机端界面由电脑上的 `serve.cjs` 提供（`/remote.html`），
APK 只负责连过去。这样做的原因：

- **本地优先**：数据始终在你自己电脑上，手机只是个遥控器
- **一处维护**：手机与桌面共用同一套 API 与界面，不必维护两份前端
- **界面更新不用重发 APK**

## 安装

```
release/android/jutian-agent-android-11.6.5.apk
```

- 包名 `com.jutian.agent`
- minSdk 24（Android 7.0+），targetSdk 35
- 已用 v2 方案签名（`apksigner verify` 通过）
- 安装时系统可能提示「未知来源」，需在系统设置里允许

## 首次使用

1. 电脑上打开巨天agent，**设置 → 复制手机远程地址**
2. 得到形如 `http://192.168.1.5:3211/remote.html?t=abc123` 的地址
3. 手机上打开本应用，填入：
   - 电脑地址：`192.168.1.5:3211`
   - 配对码：`abc123`（地址里 `t=` 后面那串）
4. 点「连接」

手机与电脑必须在**同一个局域网**（同一 WiFi）。

## 手机端能做什么

界面与电脑端「手机远程」页一致：对话、发消息、看工具调用与思考过程、
会话列表、截图查看。

## 安全说明

- 连接走局域网 http，**没有 TLS**——只适合可信网络（家里/办公室 WiFi）
- 配对码是访问凭证，泄露等于别人能操作你的 agent
- 电脑端可随时重新生成配对码（旧码立即失效）
- 远程访问默认关闭，需在电脑端手动开启

## 自己构建

```bash
cd android
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
gradle assembleRelease
# 产物：app/build/outputs/apk/release/app-release.apk
```

签名配置在 `keystore.properties`（**不入库**）：
```
storeFile=jutian-release.keystore
storePassword=<你的密码>
keyAlias=jutian
keyPassword=<你的密码>
```
没有该文件时构建仍可进行，产出未签名包。

### 已知环境坑

- **JDK 25 下 lint 会崩**（`Unsupported class file major version`）：
  `build.gradle` 里已设 `checkReleaseBuilds false` 绕开
- **模拟器需要系统镜像**：`sdkmanager "system-images;android-33;google_apis;arm64-v8a"`
  本机当前缺这个镜像，所以未做模拟器实机验证
