import { describe, it, expect } from 'vitest'
import {
  EXT_API_VERSION, normalizeExtId, isSafeExtPath, validateExtManifest,
  isExtCompatible, defaultExtManifest,
} from '../src/shared/extensions'

describe('extensions 契约', () => {
  it('id 清洗', () => {
    expect(normalizeExtId(' 番茄钟 v1 ')).toBe('v1')
    expect(normalizeExtId('Pomodoro Timer')).toBe('Pomodoro-Timer')
    expect(normalizeExtId('../../etc')).toBe('etc')
    expect(normalizeExtId('')).toBe('')
  })

  it('路径穿越一律拒绝', () => {
    for (const p of [
      '../secret.json', 'a/../../b.html', '/etc/passwd', 'C:\\windows',
      'panel.exe', 'a\\b.html', './panel.html', '', 'a/../panel.html',
      'x'.repeat(200) + '.html',
    ]) expect(isSafeExtPath(p), p).toBe(false)
    for (const p of ['panel.html', 'assets/app.css', 'src/main.js', 'a/b.svg']) {
      expect(isSafeExtPath(p), p).toBe(true)
    }
  })

  it('manifest 校验', () => {
    const m = defaultExtManifest({ id: 'pomodoro', name: '番茄钟' })
    expect(validateExtManifest(m).ok).toBe(true)
    expect(m.approved).toBe(false) // AI 创建默认未批准

    const bad = validateExtManifest({ ...m, apiVersion: 99 })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('不兼容')

    expect(validateExtManifest({ ...m, capabilities: ['shell'] }).ok).toBe(false)
    expect(validateExtManifest({ ...m, entry: '../evil.html' }).ok).toBe(false)
    expect(validateExtManifest(null).ok).toBe(false)
  })

  it('严格模式要求用户批准', () => {
    const m = defaultExtManifest({ id: 'x' })
    expect(validateExtManifest(m, { strict: true }).ok).toBe(false)
    expect(validateExtManifest({ ...m, approved: true }, { strict: true }).ok).toBe(true)
    expect(validateExtManifest({ ...m, approved: true, enabled: false }, { strict: true }).ok).toBe(false)
  })

  it('版本契约', () => {
    expect(isExtCompatible(EXT_API_VERSION, { apiVersion: 1 })).toBe(true)
    expect(isExtCompatible(2, { apiVersion: 1 })).toBe(false)
  })
})
