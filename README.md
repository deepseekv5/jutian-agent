# 巨天 Agent 官网

产品官网，纯静态，GitHub Pages 托管：<https://deepseekv5.github.io/jutian-agent/>

## 目录

```
index.html
assets/css/style.css
assets/js/main.js       # 主题切换、移动端菜单、导航高亮、思考程度切换
assets/img/
  preview-ui.png         # 主界面预览
  preview-thinking.png   # 思考程度面板预览
```

## 章节

是什么 / 能力清单 / 界面 / 思考程度 / 技术规格 / 使用场景 / 路线图 / 常见问题 / 如何获取

## 改内容

文案全部在 `index.html`。思考档位的说明文字在 `assets/js/main.js` 顶部的 `LEVELS` 数组。

| 想改什么 | 改哪儿 |
| --- | --- |
| 强调色 | `assets/css/style.css` 中 `--accent`（浅色 `#2f4a8c`，深色 `#8aa8e6`） |
| 能力与规格 | 「能力清单」「技术规格」章节的表格 |
| 下载状态 | 「如何获取」章节与 hero 的 Status 字段 |

## 风格切换

页眉右侧三档切换（正常 / 猫娘 / 搞笑），除文案外，思考档位的说明文字也会跟着变（见 `main.js` 的 `LEVELS_*`）。

## 相关

- 巨天工作室：<https://deepseekv5.github.io/jutian-studio/>
- 个人主页：<https://deepseekv5.github.io/>
