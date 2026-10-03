import { useState, useEffect, useCallback } from 'react'
import type { Settings } from '../types'
import { getSettings, getSettingsSync, saveSettings as save, hasAnySettingsSync } from '../store/storage'

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({
    apiBaseUrl: '',
    apiKey: '',
    model: '',
    provider: 'api',
    localModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    voiceId: 'zh-CN-XiaoxiaoNeural',
    workDir: '',
    permissionLevel: 'standard',
    allowedFolders: [],
    shellAccess: false,
    sensitiveBlock: true,
    keepAwake: true,
    providerName: 'custom',
    contextWindow: 128000,
    multimodal: false,
    models: [],
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // 优先同步读 localStorage，后台异步同步 SQLite
    setSettings(getSettingsSync())
    setLoaded(true)
    getSettings().then(s => s && setSettings(s))
  }, [])

  const saveSettingsFn = useCallback((s: Settings) => {
    save(s)
    setSettings(s)
  }, [])

  return { settings, loaded, saveSettings: saveSettingsFn, hasSettings }
}

export function hasSettings(): boolean {
  const s = getSettingsSync()
  return !!(s.apiBaseUrl && s.apiKey && s.model)
}

export function hasAnySettings(): boolean {
  return hasAnySettingsSync()
}
