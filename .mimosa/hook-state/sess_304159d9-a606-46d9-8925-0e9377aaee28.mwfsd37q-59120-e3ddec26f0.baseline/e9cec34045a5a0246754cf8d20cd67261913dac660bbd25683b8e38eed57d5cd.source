import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// PWA 资产完整性：手机浏览器「添加到主屏幕」依赖 manifest + 图标 +
// index.html 引用三件同时成立，缺一个特性就静默失效。

const ROOT = path.resolve(__dirname, '..')

describe('PWA 资产', () => {
  it('manifest.webmanifest 存在且字段完整', () => {
    const p = path.join(ROOT, 'public', 'manifest.webmanifest')
    expect(fs.existsSync(p)).toBe(true)
    const m = JSON.parse(fs.readFileSync(p, 'utf8'))
    expect(m.name).toContain('巨天')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(Array.isArray(m.icons) && m.icons.length >= 1).toBe(true)
    for (const ic of m.icons) {
      expect(ic.src.startsWith('/')).toBe(true)
      expect(ic.sizes).toBeTruthy()
    }
  })
  it('manifest 引用的图标文件真实存在', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'))
    for (const ic of m.icons) {
      const f = path.join(ROOT, 'public', ic.src)
      expect(fs.existsSync(f)).toBe(true)
      expect(fs.statSync(f).size).toBeGreaterThan(1000)
    }
  })
  it('index.html 引用 manifest 与 apple-touch-icon', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('rel="apple-touch-icon"')
  })
  it('图标为正方形（可作 maskable）', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'icon.png'))
    // PNG 宽高在 IHDR：字节 16-23
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    expect(w).toBe(h)
    expect(w).toBeGreaterThanOrEqual(512)
  })
})
