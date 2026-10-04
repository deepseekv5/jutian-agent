# 巨天agent · 产品官网

> 桌面 AI 工作台的官方网站。极简、克制、本地优先。
> 纯静态站点：无构建步骤、无运行时依赖、无框架。

## 快速开始

```bash
# 方式一：Python（macOS 自带）
cd jutian-site
python3 -m http.server 5173

# 方式二：Node
npx serve jutian-site          # 或 npx http-server jutian-site -p 5173
```

浏览器打开 <http://localhost:5173>。

> 直接双击 `index.html` 也能看，但建议用本地服务器：`defer` 脚本与懒加载在 `file://` 下部分浏览器会受限。

## 目录结构

```
jutian-site/
├── index.html            首页：Hero（产品窗口）/ 理念 / 亮点预览 / 数据 / 场景速览 / 下载
├── highlights.html       核心亮点：六大能力 bento
├── features.html         特性与参数：规格表 + 12 项特性 + 架构图
├── scenarios.html        使用场景：sticky 标题 + 滚动场景卡（5 组）
├── about.html            关于：品牌故事 + 三条原则 + 数据
├── contact.html          联系：表单（前端校验）+ 渠道
├── README.md
└── assets/
    ├── css/
    │   ├── tokens.css       设计令牌：间距/字体/色板/阴影/动效曲线（唯一设计决策来源）
    │   ├── base.css         重置 + 排版基线 + 工具类
    │   ├── layout.css       容器/12 列栅格/导航/页脚
    │   ├── components.css   按钮/卡片/bento/规格表/表单/徽标
    │   ├── motion.css       滚动渐入/视差/3D 倾斜/页面转场/reduced-motion 降级
    │   └── pages.css        各页版式：Hero/App 窗口 mockup/场景卡/关于/联系
    ├── js/
    │   ├── scroll.js        IntersectionObserver 渐入 + rAF 视差 + 数字滚动
    │   ├── interactions.js  磁性按钮 / 3D 倾斜 / Hero 跟随 / 表单校验 / 懒加载淡入
    │   └── app.js           入口：导航显隐 / 主题切换 / 页面转场 / 抽屉 / 模块装配
    └── img/
        ├── favicon.svg
        ├── gen-scenes.cjs   场景插画生成脚本（改动后重跑即可）
        └── scene-*.svg      7 张线稿插画（代码/终端/集群/写作/审查/数据/对话）
```

## 设计与工程约定

**视觉（v2 编辑式）**：设计语言是「纸 / 墨 / 发丝线」三个色阶 + mono 标注体系。
首屏标题 48–108px（font-weight 900、字距 -0.028em）逐行揭示；正文 17px / 行高 1.85。
去掉了径向光晕、图标卡片墙、胶囊标签堆——用编辑式行（hairline + mono 索引）、真实终端卡
（进入视口后逐字敲命令、逐行出结果）和纯黑宣言段制造节奏。品牌绿只做标点。
深色主题通过 `[data-theme="dark"]` 翻色板实现，布局零改动。

**动效铁律**：只动 `transform` 与 `opacity`；绝不在动画里触发重排。
入场用 `cubic-bezier(0.16,1,0.3,1)`（expo-out），微交互用 `cubic-bezier(0.4,0,0.6,1)` + 320ms；
滚动监听统一走单个 rAF 循环，绝不在回调里读写布局。
`prefers-reduced-motion: reduce` 与移动端（≤760px）会自动关闭视差、倾斜与转场。

**性能**：CSS 分 6 层按职责加载；图片全部 `loading="lazy" decoding="async"` 并带尺寸属性（无 CLS）；
长区块用 `content-visibility: auto` 跳过视口外绘制；DOM 无冗余包裹层；JS 三个模块合计约 12KB（未压缩）。

**响应式**：断点 900 / 760 / 620 / 560。移动端导航收起为抽屉，bento 从 6 列 → 2 列 → 1 列，
sticky 场景卡退化为顺序阅读，视差与 3D 效果关闭。

