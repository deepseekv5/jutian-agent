# 宣传片动画源（Apple 发布会级 · 可复用）

**成片**：`~/Desktop/巨天agent-宣传片.mp4`（45.97s / 1920×1080 / 30fps / H.264+AAC / 4.4MB）

## 三要素

1. **画图**——全部 SVG 矢量 + HTML/CSS 仿真窗口（聊天窗、代码编辑器、员工卡、终端、架构图），无位图素材。
2. **动画**——深色舞台 + 品牌绿主色。`applyTime(ms)` 是唯一时间源；环境光斑漂移、粒子上升、虚线流动、
   呼吸点、光标闪烁全部由时间线**逐帧计算**（无 CSS 无限动画 → 每帧只重绘一次，负载恒定、完全确定）。
3. **语音**——16 句旁白由项目自身 `/api/edge-tts`（zh-CN-XiaoxiaoNeural）生成，**逐句字幕**跟随。

## 关键坑（务必遵守）

| 坑 | 后果 | 正确做法 |
|---|---|---|
| `page.screenshot({animations:'disabled'})` | CSS 过渡冻结在初始态，大片帧完全相同 | 不要用，默认 allow |
| CSS 无限动画 + `filter:blur()` 大面积光斑 | 合成器持续 60fps 重绘，截图越来越慢（实测劣化到 6-7s/帧） | 无限动画全部由 applyTime 驱动 |
| 恒定帧率编码 | 实际采集步长 88–200ms 波动 → 画面比旁白快最多 2s | 逐帧记录时间戳，concat `duration` 生成后统一 `fps=30` |
| TTS 原文件自带前后静音（每段 ~0.77s） | 字幕比语音早 ~0.4s、章节间出现长静音 | `silenceremove` 双向修剪后重新测量时长再注入 |
| `node -e '...'` 内出现单引号/反引号 | shell 引号错乱，生成垃圾 frames.txt | 脚本写成文件，用 `String.fromCharCode(39)` |

## 重制流程

```bash
# 1. 改文案 → texts.json；生成 16 句 TTS 并修剪前后静音 → 测时长 → 注入 narr.json → 生成 promo.html
# 2. 静态服务 + 采集（逐帧记录 stamps.json，步长=实测截图耗时+余量，保证 CSS 过渡按真实速度推进）
node shoot.cjs          # playwright-core + 系统 Chrome，视口 1920x1080，JPEG q96
# 3. 生成带精确 duration 的 concat 列表（时间戳量化到 1/30s，累计误差 <16ms）
node mkframes.js
# 4. 合成
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=44.9:d=0.9" -c:v libx264 -preset slow -crf 19 -profile:v high -pix_fmt yuv420p film_v.mp4
ffmpeg -i film_v.mp4 -i final_audio.mp3 -filter_complex "[1:a]apad,atrim=0:45.97,afade=t=in:st=0:d=0.2,afade=t=out:st=44.2:d=0.9,volume=1.4[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out.mp4
```

## 验收标准（本次实测）

- 冻结段 0、黑帧 0、逐帧跳变全部落在预期事件（章节转场/节点点亮/计数/进度条/字幕切换）
- 16 句字幕在句中点均检测到纯白文字（字幕带 YMAX=255）
- 章节切换时刻与旁白边界误差 <0.15s（受 0.7s 交叉淡化与 0.28s 字幕淡入限制）
- 旁白仅 1 处静音间隙（片尾淡出），mean -16dB / max -0.5dB 无削波
