import { useEffect, useState } from 'react'

/**
 * Android 判定（v15.2）
 *
 * 安卓 App 的 WebView UA 含 Android；桌面 Electron 没有。
 * 远程 WebUI（手机浏览器）也会命中，但这正好——那也是"不完善的移动端"。
 */
export function isAndroidDevice(): boolean {
  try {
    if ((globalThis as any)?.electronAPI?.platform === 'android') return true
    const s = `${navigator?.userAgent || ''}`
    return /android/i.test(s)
  } catch { return false }
}

export function useAndroid(): boolean {
  const [v] = useState(isAndroidDevice)
  return v
}
