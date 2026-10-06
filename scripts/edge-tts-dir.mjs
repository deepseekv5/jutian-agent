#!/usr/bin/env node
/**
 * 探测 openai-edge-tts 源码目录（electron-builder 的 extraResources 需要绝对路径）。
 * 优先环境变量 EDGE_TTS_DIR，其次常见位置；找不到则打印警告并 exit 0（跳过该资源，不阻断打包）。
 * 用法：EDGE_TTS_DIR="$(node scripts/edge-tts-dir.mjs)" electron-builder ...
 */
import { existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'

const candidates = [
  process.env.EDGE_TTS_DIR,
  join(homedir(), 'Desktop', '项目文件夹', 'openai-edge-tts'),
  join(homedir(), 'openai-edge-tts'),
  join(homedir(), '.cache', 'openai-edge-tts'),
  '/usr/local/share/openai-edge-tts',
]
const found = candidates.find((p) => p && existsSync(p) && statSync(p).isDirectory())
if (found) {
  // electron-builder 的 extraResources.from 把宏值当「相对项目根」处理,
  // 绝对路径会被错误拼成 projectDir+abs。一律输出相对路径(可含 ..)。
  process.stdout.write(relative(process.cwd(), found) || found)
} else {
  console.error('[edge-tts-dir] 未找到 openai-edge-tts 源码目录；TTS 资源将被跳过（打包不阻断）。\n'
    + '如需 TTS，请 clone https://github.com/roudy/openai-edge-tts 并设置 EDGE_TTS_DIR 指向该目录。')
  process.exit(0)
}
