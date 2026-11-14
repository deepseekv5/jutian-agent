import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '..')

/**
 * 这组测试锁的是 Windows CI 连挂 4 次的根因：
 *
 * package.json 的 build.win/mac.extraResources 里写着
 * from: "${env.EDGE_TTS_DIR}"。CI 上没有 openai-edge-tts 目录，
 * 变量展开成空串 → electron-builder 把空 from 当「相对项目根」→
 * 而输出目录 release/ 就在项目根里 → 打包过程把自己的产物一层层
 * 复制进自己，直到 ENOSPC 撑爆磁盘（日志里是
 * edge-tts\release\win-unpacked\resources\edge-tts\... 无限嵌套）。
 *
 * scripts/eb-config.cjs 负责把不存在的资源剔掉，并拒绝任何指向
 * 项目根的 from。下面逐条锁死。
 */
describe('eb-config 打包配置', () => {
  const load = () => {
    // require 缓存会掩盖环境变量改动，每次都清掉
    delete require.cache[require.resolve('../scripts/eb-config.cjs')]
    return require('../scripts/eb-config.cjs')
  }

  it('产物目录必须被子进程配置排除在 extraResources 之外', () => {
    const cfg = load()
    const output = (cfg.directories && cfg.directories.output) || 'release'
    for (const res of cfg.extraResources || []) {
      const from = String(res.from)
      // from 指向项目根（'' 或 '.'）就是把 release/ 也一起复制进去
      expect(from).not.toBe('')
      expect(from).not.toBe('.')
      // 更直接的一条：不能指到产物目录
      expect(path.resolve(ROOT, from)).not.toBe(path.resolve(ROOT, output))
    }
  })

  it('包内不得残留 ${env.*} 未展开宏', () => {
    // 只要还有宏，electron-builder 就会再去展开一次；未定义时报
    // "cannot expand pattern"，或展开成空串触发递归复制。
    const seen = JSON.stringify(load())
    expect(seen).not.toContain('${env.')
  })

  it('平台段不再各自带 extraResources（否则与顶层合并后宏会回来）', () => {
    const cfg = load()
    for (const p of ['win', 'mac', 'linux']) {
      if (cfg[p]) expect(cfg[p].extraResources).toBeUndefined()
    }
  })

  it('保留 nsis 与 dmg 的打包目标', () => {
    const cfg = load()
    expect(JSON.stringify(cfg.win.target)).toContain('nsis')
    expect(JSON.stringify(cfg.mac.target)).toContain('dmg')
  })

  it('EDGE_TTS_DIR 指向不存在的目录时该项被跳过，不抛错', () => {
    const prev = process.env.EDGE_TTS_DIR
    process.env.EDGE_TTS_DIR = path.join(os.tmpdir(), 'definitely-not-here-' + process.pid)
    try {
      const cfg = load()
      const tos = (cfg.extraResources || []).map((r) => r.to)
      expect(tos).not.toContain('edge-tts')
    } finally {
      if (prev === undefined) delete process.env.EDGE_TTS_DIR
      else process.env.EDGE_TTS_DIR = prev
    }
  })

  it('EDGE_TTS_DIR 指向项目根时被拒绝（递归爆盘的关键防线）', () => {
    const prev = process.env.EDGE_TTS_DIR
    process.env.EDGE_TTS_DIR = ROOT
    try {
      const cfg = load()
      const tos = (cfg.extraResources || []).map((r) => r.to)
      expect(tos).not.toContain('edge-tts')
    } finally {
      if (prev === undefined) delete process.env.EDGE_TTS_DIR
      else process.env.EDGE_TTS_DIR = prev
    }
  })

  it('EDGE_TTS_DIR 指向真实子目录时正常收进 extraResources', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-probe-'))
    const prev = process.env.EDGE_TTS_DIR
    process.env.EDGE_TTS_DIR = tmp
    try {
      const cfg = load()
      const entry = (cfg.extraResources || []).find((r) => r.to === 'edge-tts')
      expect(entry).toBeTruthy()
      // 必须是目录名，不能是空串或 '.'
      expect(String(entry.from)).not.toBe('')
      expect(String(entry.from)).not.toBe('.')
    } finally {
      if (prev === undefined) delete process.env.EDGE_TTS_DIR
      else process.env.EDGE_TTS_DIR = prev
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('PYTHON_RUNTIME_DIR 支持环境变量覆盖，指向项目根时同样被拒', () => {
    const prev = process.env.PYTHON_RUNTIME_DIR
    // 正常覆盖：真实子目录
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-py-'))
    process.env.PYTHON_RUNTIME_DIR = tmp
    try {
      const cfg = load()
      const entry = (cfg.extraResources || []).find((r) => r.to === 'python-runtime')
      expect(entry).toBeTruthy()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    // 危险覆盖：指到项目根 → 必须拒绝，而不是把 release/ 吞进包里
    process.env.PYTHON_RUNTIME_DIR = ROOT
    try {
      const cfg = load()
      const entry = (cfg.extraResources || []).find((r) => r.to === 'python-runtime')
      expect(entry).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.PYTHON_RUNTIME_DIR
      else process.env.PYTHON_RUNTIME_DIR = prev
    }
  })
})

describe('release-win workflow', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/release-win.yml'), 'utf-8')

  it('打包步骤用 eb-config 而不是裸 electron-builder', () => {
    // 裸调用会读 package.json 里的静态 extraResources → 递归爆盘
    expect(wf).toMatch(/electron-builder[^\n]*--config\s+scripts\/eb-config\.cjs/)
  })

  it('上传 exe 安装包 + asar 更新包（v12.8 起恢复全平台发行版）', () => {
    // v12.8 起矩阵构建 x64 + arm64：NSIS 恢复，exe 与 asar 都上传
    expect(wf).toMatch(/electron-builder --win \$\{\{ matrix\.ebflag \}\} --config/)
    expect(wf).toContain('release/*.exe')
    expect(wf).toContain('asar-out/*.asar')
  })

  it('不再出现 EDGE_TTS_DIR 的命令行兜底 hack', () => {
    expect(wf).not.toContain('echo .')
  })

  it('打包前先构建前端（asar 需要 dist/）', () => {
    expect(wf).toMatch(/vite build/)
  })
})
