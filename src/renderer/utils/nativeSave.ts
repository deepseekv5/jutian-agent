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
}

function bridge(): JutianNativeBridge | null {
  const b = (window as any).JutianNative
  return b && typeof b.saveBlob === 'function' ? b : null
}

export function isNativeSaveAvailable(): boolean {
  return !!bridge()
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
