# 巨天agent · 产品官网与文档中心

本目录即产品官网，发布在 GitHub Pages：<https://deepseekv5.github.io/jutian-agent/>。
官网（产品展示）与文档中心（guide.html）一体：纯静态站点，无构建步骤、无运行时依赖、无框架。

## 目录结构

```
docs/
├── index.html              首页：Hero / 亮点 / 场景 / 下载（Apple 产品页深色风）
├── highlights.html         核心亮点
├── features.html           特性与参数
├── scenarios.html          使用场景
├── about.html              关于
├── legal.html              协议与隐私政策（由 src/shared/legal.ts 单一来源生成）
├── activity-1024.html      1024 程序员节活动页（唯一仍用旧版 CSS 体系的页面）
├── guide.html              文档中心（VitePress 风格三栏布局，39 页双层）
├── notice.md               发行说明单一来源（各版本要点段落，最新在前）
├── THIRD_PARTY_NOTICES.md  第三方组件与许可证
├── adr/                    架构决策记录（ADR-0001 至 0005 + 索引 README）
├── dev/                    开发文档（工程架构 / 内核五阶段 / 超级内核 / 新增工具 / 构建发布 / 安全审计报告）
├── en/                     英文镜像（guide/ dev/ + CONTRIBUTING/SECURITY）
├── guide/                  用户指南（安装 / 模型 / 免费模型 / 优化 / 终端版 / 手机远程 / Harness / 知识库 / 子代理集群 / 隐私 / 界面多语言）
├── notes/                  开发笔记（DEVELOPMENT / LEARNING / AGENT-CHAT / CODE-SPEC）
└── assets/
    ├── css/apple.css       Apple 产品页深色风共享样式（六个产品页引用，自包含）
    ├── css/tokens|base|layout|components|motion|pages.css   旧版分层样式（现仅 activity-1024.html 引用）
    ├── js/                 旧版动效脚本（scroll / interactions / app，仅 activity-1024.html 引用）
    └── img/                favicon.svg、scene-*.svg 线稿插画（gen-scenes.cjs 生成）、app/ 应用截图（home/code/flow/chat）
```

六个产品页（index/highlights/features/scenarios/about/legal）共享 `assets/css/apple.css`，样式内联各自页面；
guide.html 同样自带内联样式，不依赖全站 CSS。产品页截图取自 `assets/img/app/`。

## 文档中心（guide.html）

**39 页双层结构**，按「入门 / 内核 / 开发 / 参考 / 记录」五组组织：

- **10 页精选导览**：内容内联在 guide.html 里，随版本手工维护——快速开始、四套内核、超级内核架构、
  应用内更新、工具总览、安全架构、新增工具、终端版 jtcode、本地开放 API、隐私与合规
- **29 页仓库文档**：直接 fetch 仓库真实 md——`docs/guide/*`、`docs/dev/*`、`docs/adr/*`、
  `docs/notes/*`、`CHANGELOG.md`、`docs/THIRD_PARTY_NOTICES.md`

**fetch 单一来源机制**：这 29 页加载的就是仓库里的 md 文件（相对路径优先，失败回落
raw.githubusercontent.com）。仓库 md 更新后，官网文档自动同步，无需单独部署页面。

其它能力：Cmd/Ctrl+K 全文搜索（标题 + 正文，已加载内容缓存）；`#/slug` hash 内部路由
（可刷新、可直达，上一页/下一页串联，右侧标题大纲）；仓库文档页外链直达 GitHub blob。

## 本地预览

```bash
cd docs
python3 -m http.server 5173
```

浏览器打开 <http://localhost:5173>。文档中心的 fetch 需要 HTTP 环境（`file://` 下浏览器
fetch 受限，仓库 md 页会加载不出），建议始终用本地服务器预览。

## 部署

push main 即自动发布：GitHub Pages 从 main 分支的 `/docs` 目录构建（Deploy from branch），
无任何构建步骤，仓库更新后约一分钟生效。
