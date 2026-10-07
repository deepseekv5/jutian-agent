const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // ─── 应用内自更新(v8.1)───
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateApply: (asarUrl) => ipcRenderer.invoke('update-apply', asarUrl),
  updateCancel: () => ipcRenderer.invoke('update-cancel'),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (_event, p) => callback(p))
  },

  // Loading page status listeners
  onStatus: (callback) => {
    ipcRenderer.on('status-update', (_event, msg) => callback(msg))
  },
  onReady: (callback) => {
    ipcRenderer.on('ready', () => callback())
  },
  onError: (callback) => {
    ipcRenderer.on('error', (_event, msg) => callback(msg))
  },
  retry: () => {
    ipcRenderer.send('retry')
  },

  // File access API
  getFileAccess: () => ipcRenderer.invoke('get-file-access'),
  setFileAccess: (lock, dirs) => ipcRenderer.invoke('set-file-access', lock, dirs),
  setShellAccess: (enabled) => ipcRenderer.invoke('set-shell-access', enabled),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Auto launch at login
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),

  onStartCall: (cb) => { const h = () => cb(); ipcRenderer.on('open-call-tab', h); return () => ipcRenderer.removeListener('open-call-tab', h) },
  // 托盘「新建对话」
  onTrayNewChat: (cb) => { const h = () => cb(); ipcRenderer.on('tray-new-chat', h); return () => ipcRenderer.removeListener('tray-new-chat', h) },
  // 窗口置顶
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('set-always-on-top', enabled),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  onScreenshot: (cb) => { const h = (_e, dataUrl) => cb(dataUrl); ipcRenderer.on('screenshot-captured', h); return () => ipcRenderer.removeListener('screenshot-captured', h) },

  // Browser overlay API
  onOpenBrowserOverlay: (callback) => {
    ipcRenderer.on('open-browser-overlay', (_event, url) => callback(url))
  },
  removeBrowserOverlayListener: () => {
    ipcRenderer.removeAllListeners('open-browser-overlay')
  },
})
