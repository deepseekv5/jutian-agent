/**
 * electron-builder 配置（程序化生成）
 *
 * 为什么不用 package.json 里的静态 "build" 段：
 * extraResources 的 from 是静态字符串，目录不存在时 electron-builder
 * 不会跳过，而是按「相对项目根」处理——from="" 就等于项目根，
 * 而输出目录 release/ 就在项目根里，于是打包过程把自己的产物
 * 一层层复制进自己，直到 ENOSPC 磁盘写满（Windows CI 实测踩过，
 * 日志里能看到 edge-tts\release\win-unpacked\resources\edge-tts\... 无限嵌套）。
 *
 * 这里改成 JS：目录不存在的资源直接不放进 extraResources。
 * 这样 mac 本机（有 python-runtime / edge-tts）和 CI（两者都可能没有）
 * 都能用同一份配置，缺资源只是少个功能，不会炸掉整次打包。
 *
 * 资源清单也在本文件里（package.json 的 build 段不再写 extraResources），
 * 避免两份配置合并时把未展开的 ${env.XXX} 宏又带回来。
 *
 * 用法：electron-builder --win --x64 --config scripts/eb-config.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const base = pkg.build || {}

/**
 * 随包分发的「大块运行时资源」。每一项都可能不存在，缺了只跳过。
 * 路径写成相对项目根，不写绝对路径：electron-builder 对绝对路径的
 * 拼接在部分版本上会算成 projectDir + abs。
 */
const RESOURCE_SPECS = [
  {
    // mac 上预置的独立 Python 运行时（含 faster-whisper 等本地推理依赖）
    from: process.env.PYTHON_RUNTIME_DIR || 'python-runtime',
    to: 'python-runtime',
    filter: [
      'bin/**',
      'Scripts/**',
      'lib/python3.11/site-packages/**',
      '!**/onnxruntime/**',
      '!**/av/**',
      '!**/pip/**',
      '!**/pip-*.dist-info/**',
      '!**/setuptools/**',
      '!**/*.pyc',
      '!**/__pycache__/**',
      '!**/tests/**',
      '!**/test_*.py',
    ],
  },
  {
    // openai-edge-tts 源码；本机装在哪由 EDGE_TTS_DIR 指定或脚本探测
    from: process.env.EDGE_TTS_DIR || '',
    to: 'edge-tts',
    filter: ['**/*', '!__pycache__', '!*.pyc'],
  },
]

/** 展开 ${env.XXX} 宏；变量未定义时返回空串（由调用方判定跳过） */
function expandEnv(s) {
  return String(s).replace(/\$\{env\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] || '')
}

/** from 解析成绝对路径后判断是否真实存在；返回相对项目根的路径或 null */
function resolveFrom(from) {
  const expanded = expandEnv(from)
  if (!expanded.trim()) return null
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded)
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null
  } catch {
    return null
  }
  const rel = path.relative(root, abs)
  // rel 为空说明 from 指向项目根——这正是递归爆盘的成因，必须拒绝
  if (!rel || rel === '.' || rel === '') return null
  return rel
}

/** 未由环境变量指定的资源，回退到 scripts/edge-tts-dir.mjs 的探测结果 */
function detectEdgeTts() {
  if (process.env.EDGE_TTS_DIR) return process.env.EDGE_TTS_DIR
  try {
    const { execFileSync } = require('node:child_process')
    const out = execFileSync(process.execPath, [path.join(__dirname, 'edge-tts-dir.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out
  } catch {
    return ''
  }
}

const extraResources = []
for (const spec of RESOURCE_SPECS) {
  let from = spec.from
  if (spec.to === 'edge-tts' && !from) from = detectEdgeTts()
  const rel = resolveFrom(from)
  if (!rel) {
    // 明确的告警而不是静默：少资源是功能缺失，被误当成打包失败更难查
    console.warn(`[eb-config] 跳过 extraResources（目录不存在）: to=${spec.to} from=${JSON.stringify(from)}`)
    continue
  }
  extraResources.push({ ...spec, from: rel })
}

const config = { ...base, extraResources }

// Linux 段（v12.8）：此前从未构建过 Linux。deb 需要 author 字段
// （已补进 package.json），图标用 iconset 里现成的 512 PNG。
if (!config.linux) {
  config.linux = {
    icon: 'electron/icon.iconset/icon_512x512.png',
    category: 'Development',
    // AppImage 在部分老发行版缺 FUSE——附带 tar.gz 兜底
    target: ['AppImage', 'deb', 'tar.gz'],
  }
}

// package.json 的 build.win / build.mac 里还各留着一份带 ${env.EDGE_TTS_DIR}
// 宏的 extraResources。electron-builder 会把平台段与顶层段合并，那份宏配置
// 会原样回来——未定义时展开成空串，from="" 又变回「项目根」，递归爆盘复发。
// 平台段的自定义资源统一由本文件的 extraResources 提供，这里直接删掉。
for (const platform of ['win', 'mac', 'linux']) {
  if (config[platform] && config[platform].extraResources) {
    const { extraResources: _dropped, ...rest } = config[platform]
    config[platform] = rest
  }
}

console.log(
  `[eb-config] extraResources 生效 ${extraResources.length} 项: `
  + (extraResources.map((e) => `${e.from} -> ${e.to}`).join(', ') || '(无)')
)

module.exports = config
