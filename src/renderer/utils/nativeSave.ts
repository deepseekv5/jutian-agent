/**
 * 统一文件保存入口（v16.7 安卓原生保存）
 *
 * 安卓：window.JutianNative.saveBlob → 系统原生保存对话框（SAF ACTION_CREATE_DOCUMENT），
 *       文件落到用户在系统对话框里选的位置；桥存在时所有「导出/下载」都走这里。
 * 桌面 / 其他：保持浏览器下载（a[download]）。
 *
 * 设计要点：
 *  - 桥不可用或用户取消（回调 false）时静默降级为浏览器下载，交互不中断；
 *  - 内容统一转 Blob → base64，二进制（图片/PPTX/Word）与文本同一条路。
 */

interface JutianNativeBridge {
  saveBlob(name: string, mime: string, base64: string): string
  fetchBundle(url: string, sha256: string): string
  restartApp(): void
}

function bridge(): JutianNativeBridge | null {
  const b = (window as any).JutianNative
  return b && typeof b.saveBlob === 'function' ? b : null
}

/** 应用内 bundle 更新桥（Java 里 fetchBundle / restartApp 与 saveBlob 注册在同一个 JutianNative 对象上） */
function updateBridge(): JutianNativeBridge | null {
  const b = (window as any).JutianNative
  return b && typeof b.fetchBundle === 'function' && typeof b.restartApp === 'function' ? b : null
}

export function isNativeSaveAvailable(): boolean {
  return !!bridge()
}

/** 当前环境是否支持安卓应用内 bundle 更新 */
export function isNativeUpdateAvailable(): boolean {
  return !!updateBridge()
}

/**
 * 调用安卓桥下载并应用 bundle 更新。
 * Java 在后台线程完成「下载 → SHA-256 校验 → 解压到临时目录 → 原子替换」，
 * 结束后回调 window.__jutianUpdateDone(ok, msg)。
 */
export function fetchNativeBundle(
  url: string,
  sha256: string,
  onDone: (ok: boolean, msg: string) => void,
  timeoutMs = 180000,
): void {
  const br = updateBridge()
  if (!br) {
    onDone(false, '当前环境不支持应用内更新')
    return
  }
  const w = window as any
  const cleanup = () => { try { delete w.__jutianUpdateDone } catch { /* noop */ } }
  const timer = setTimeout(() => {
    cleanup()
    onDone(false, '更新超时，请检查网络后重试')
  }, timeoutMs)
  w.__jutianUpdateDone = (ok: boolean, msg: string) => {
    clearTimeout(timer)
    cleanup()
    onDone(!!ok, String(msg || ''))
  }
  try {
    br.fetchBundle(url, sha256 || '')
  } catch (e) {
    clearTimeout(timer)
    cleanup()
    onDone(false, String((e as any)?.message || e))
  }
}

/** 重启应用使新 bundle（serve.cjs / 前端资源）生效：Java 杀进程并重新拉起 Activity */
export function restartNativeApp(): void {
  const br = updateBridge()
  if (!br) return
  try { br.restartApp() } catch { /* 忽略：Activity 状态异常时由用户手动重开 */ }
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : '')
    }
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(b)
  })
}

/** 等待原生保存完成（Java 写完文件后回调 window.__jutianSaveDone(id, ok)） */
function waitNativeDone(id: string, timeoutMs = 120000): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as any
    const done = (ok: boolean) => {
      delete w.__jutianSaveDone
      resolve(ok)
    }
    w.__jutianSaveDone = (id2: string, ok: boolean) => { if (String(id2) === String(id)) done(!!ok) }
    setTimeout(() => done(false), timeoutMs)
  })
}

/** 下载/保存文件：安卓走系统原生保存对话框，其余走浏览器下载 */
export async function downloadFile(name: string, data: Blob | string, mime = 'application/octet-stream'): Promise<boolean> {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const br = bridge()
  if (br) {
    try {
      const b64 = await blobToBase64(blob)
      const id = br.saveBlob(name, blob.type || mime, b64)
      return await waitNativeDone(String(id))
    } catch {
      // 桥调用失败（如 Activity 状态异常）→ 降级浏览器下载
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return true
}
