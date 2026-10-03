import { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme, ACCENT_PRESETS, getAccentKey, setAccentKey } from '../hooks/useTheme';
import CliInstallModal from '../app/CliInstallModal';
import { useLanguage } from '../hooks/useLanguage';
import { APP_VERSION } from '../brand'
import type { Settings, PermissionLevel } from '../types';
import UsageStats from '../panels/UsageStats';
import McpSection from './McpSection'
import RemoteAccess from './RemoteAccess'
import { summarizeUsage } from '../store/usage';
import { fmtTokens } from '../utils/tokens';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  embedded?: boolean;
}

type TabId = 'inference' | 'workspace' | 'security' | 'usage' | 'data' | 'appearance' | 'language' | 'about';

// 提供商预设：一键切换 API 地址/默认模型/上下文窗口/多模态能力
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', contextWindow: 128000, multimodal: true },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', contextWindow: 128000, multimodal: false },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-128k', contextWindow: 128000, multimodal: false },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-plus', contextWindow: 32000, multimodal: true },
  { id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-plus', contextWindow: 128000, multimodal: true },
  { id: 'custom', name: '自定义', baseUrl: '', model: '', contextWindow: 1000000, multimodal: false },
]

const PERMISSION_LEVELS: { id: PermissionLevel; label_zh: string; label_en: string; desc_zh: string; desc_en: string; icon: string; color: string }[] = [
  { id: 'restricted', label_zh: '受限模式', label_en: 'Restricted', desc_zh: '仅可读取已授权文件夹，禁止执行命令', desc_en: 'Only read authorized folders, no command execution', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', color: '#f59e0b' },
  { id: 'standard', label_zh: '标准模式', label_en: 'Standard', desc_zh: '可读取大部分文件，允许执行常规命令', desc_en: 'Read most files, execute routine commands', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', color: '#3b82f6' },
  { id: 'full', label_zh: '完全访问', label_en: 'Full Access', desc_zh: '无限制访问所有文件和执行任意命令', desc_en: 'Unrestricted access to all files and commands', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: '#ef4444' },
];

const CATEGORIES: { id: TabId; label: string; icon: string }[] = [
  { id: 'inference', label: '推理', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'workspace', label: '工作区', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  { id: 'security', label: '安全', icon: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z' },
  { id: 'usage', label: '用量', icon: 'M3 13h4v8H3v-8zm7-9h4v17h-4V4zm7 5h4v12h-4V9z' },
  { id: 'data', label: '数据', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { id: 'appearance', label: '外观', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'language', label: '语言', icon: 'M3 5h12M9 3v2m1.5 0l-3 14m4.5 0h-6m9-3l4-8 4 8m-.5-2h-7' },
  { id: 'about', label: '关于', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
]

// 设置搜索索引：label = 呈现名，keywords = 命中关键词（空格分隔）
const SEARCH_INDEX: { tab: TabId; label: string; desc: string; keywords: string }[] = [
  { tab: 'inference', label: 'API 地址与密钥', desc: '推理', keywords: 'api base url key 密钥 接口地址 apikey apikey' },
  { tab: 'inference', label: '模型选择', desc: '推理', keywords: 'model 模型 切换模型 step gpt glm qwen deepseek' },
  { tab: 'inference', label: '本地模型 (LM Studio)', desc: '推理', keywords: 'local 本地模型 lm studio llama 本地推理' },
  { tab: 'inference', label: '上下文窗口', desc: '推理', keywords: 'context window 上下文 窗口 tokens' },
  { tab: 'inference', label: '多模态', desc: '推理', keywords: 'multimodal 多模态 图片 视觉 vision' },
  { tab: 'workspace', label: '工作目录', desc: '工作区', keywords: 'workdir 工作目录 工作区 目录 文件夹' },
  { tab: 'security', label: 'AI 权限等级', desc: '安全', keywords: 'permission 权限 受限 标准 完全访问 restricted full' },
  { tab: 'security', label: 'Shell 命令执行', desc: '安全', keywords: 'shell 命令 执行 终端 命令执行' },
  { tab: 'security', label: '集群敏感操作拦截', desc: '安全', keywords: 'sensitive 敏感 拦截 删除 集群 高危' },
  { tab: 'security', label: '可访问文件夹', desc: '安全', keywords: 'folders 授权 文件夹 目录 白名单' },
  { tab: 'appearance', label: '主题模式', desc: '外观', keywords: 'theme 主题 深色 浅色 dark light 暗色 黑色' },
  { tab: 'appearance', label: '发送键行为', desc: '外观', keywords: 'enter 发送 回车 换行 enterToSend' },
  { tab: 'appearance', label: '聊天字号', desc: '外观', keywords: 'font 字号 字体大小 文字大小' },
  { tab: 'appearance', label: 'AI 自动生成对话标题', desc: '外观', keywords: 'title 标题 自动命名 auto title' },
  { tab: 'appearance', label: '回复完成系统通知', desc: '外观', keywords: 'notify 通知 提醒 完成 notification' },
  { tab: 'appearance', label: '上下文自动压缩阈值', desc: '外观', keywords: 'compact 压缩 阈值 上下文 auto compact' },
  { tab: 'appearance', label: '朗读音色与语速', desc: '外观', keywords: 'tts 朗读 语音 音色 声音 语速 晓晓 云希 试听 voice speed' },
  { tab: 'appearance', label: '液态玻璃模糊强度', desc: '外观', keywords: 'glass blur 毛玻璃 模糊' },
  { tab: 'appearance', label: '背景图片与透明度', desc: '外观', keywords: 'background 背景 壁纸 透明度 wallpaper' },
  { tab: 'language', label: '界面语言', desc: '语言', keywords: 'language 语言 中文 english 中英文' },
  { tab: 'data', label: '会话数据统计 / 导入导出', desc: '数据', keywords: 'data 数据 导出 导入 备份 统计 清空' },
  { tab: 'usage', label: 'Token 用量统计', desc: '用量', keywords: 'usage 用量 tokens 统计 消耗' },
];


// ── 设置页子组件：必须定义在组件外部（内联定义会让 React 每次渲染重挂载子树，输入框打一个字就失焦）──
const Toggle = ({ on, onClick, c }: { on: boolean; onClick: () => void; c: any }) => (
  <button type="button" role="switch" aria-checked={on} onClick={onClick}
    className="relative w-10 h-5 rounded-full transition-colors shrink-0" style={{ background: on ? c.accent : `${c.textMuted}44` }}>
    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: on ? 'calc(100% - 18px)' : '2px' }} />
  </button>
);

const AlwaysOnTopRow = ({ c, t }: { c: any; t: (a: string, b?: string) => string }) => {
  const [onTop, setOnTop] = useState<boolean>(false);
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getAlwaysOnTop) api.getAlwaysOnTop().then((v: boolean) => setOnTop(!!v)).catch(() => {});
  }, []);
  if (!(window as any).electronAPI?.setAlwaysOnTop) return null;
  return (
    <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
      <div>
        <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('窗口置顶', 'Always on top')}</div>
        <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('让主窗口始终浮动在其它应用之上', 'Keep the main window above others')}</div>
      </div>
      <Toggle c={c} on={onTop} onClick={() => {
        const next = !onTop; setOnTop(next);
        (window as any).electronAPI.setAlwaysOnTop(next).catch(() => {});
      }} />
    </div>
  );
};

const Sub = ({ title, children, c }: { title: string; children: React.ReactNode; c: any }) => (
  <div className="mb-5">
    <label className="text-[11px] font-semibold block mb-2" style={{ color: c.textTertiary }}>{title}</label>
    {children}
  </div>
);

const Field = ({ label, children, c }: { label: string; children: React.ReactNode; c: any }) => (
  <div className="mb-3">
    <label className="text-[11px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>{label}</label>
    {children}
  </div>
);

export default function SettingsModal({ settings, onSave, onClose, embedded = false }: Props) {
  const { c, theme, setTheme } = useTheme();
  // 强调色面板重渲染标记
  const [, setAccentTick] = useState(0);
  // 环境诊断状态
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);
  // 数据库维护
  const [vacuumMsg, setVacuumMsg] = useState('');
  const [diagCopied, setDiagCopied] = useState(false);
  const { lang, setLang, t } = useLanguage();
  const [tab, setTab] = useState<TabId>('inference');
  // 设置搜索：索引全部设置项，命中后点击跳到对应分区
  const [searchQuery, setSearchQuery] = useState('');
  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX.filter(it => it.keywords.toLowerCase().includes(q) || it.label.toLowerCase().includes(q)).slice(0, 12);
  }, [searchQuery]);
  const [form, setForm] = useState<Settings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [lmModels, setLmModels] = useState<{ id: string }[]>([]);
  const [lmScanning, setLmScanning] = useState(false);
  const [lmError, setLmError] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [testingConn, setTestingConn] = useState<null | 'ok' | 'fail'>(null);
  const [connDetail, setConnDetail] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [quickCmds, setQuickCmds] = useState<{ label: string; text: string }[]>(() => {
    try { const raw = localStorage.getItem('lyclaw_quick_commands'); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : [] } catch { return [] }
  });
  // 启动时从 DB 恢复快捷指令（DB 值优先，防强杀丢数据）
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => {
      const fromDb = (d as any).lyclaw_quick_commands
      if (fromDb) {
        try {
          const arr = JSON.parse(fromDb)
          if (Array.isArray(arr) && arr.length > 0) {
            try { localStorage.setItem('lyclaw_quick_commands', JSON.stringify(arr)) } catch {}
            setQuickCmds(arr)
          }
        } catch { /* ignore */ }
      }
    }).catch(() => {})
  }, []);
  const [newQcLabel, setNewQcLabel] = useState('');
  const [newQcText, setNewQcText] = useState('');
  // 自定义提供商（localStorage 持久化）
  const [customProviders, setCustomProviders] = useState<{ id: string; name: string; baseUrl: string; model: string; contextWindow: number; multimodal: boolean }[]>(() => {
    try { const raw = localStorage.getItem('lyclaw_custom_providers'); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : [] } catch { return [] }
  });
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [np, setNp] = useState({ name: '', baseUrl: '', model: '', contextWindow: 128000, multimodal: false });
  const [newModelName, setNewModelName] = useState('');
  const [storageStats, setStorageStats] = useState<{ sessions: number; messages: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const workDirSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [visual, setVisual] = useState(() => {
    try { const raw = localStorage.getItem('visual-settings'); return raw ? JSON.parse(raw) : { glassBlur: 12, bgImage: '/bg_upload.mp4', bgOpacityLight: 0.5, bgOpacityDark: 0.6 };
    } catch { return { glassBlur: 12, bgImage: '/bg_upload.mp4', bgOpacityLight: 0.5, bgOpacityDark: 0.6 }; }
  });

  function saveVisual(v: typeof visual) { setVisual(v); localStorage.setItem('visual-settings', JSON.stringify(v)); document.documentElement.style.setProperty('--glass-blur', `${v.glassBlur}px`); window.dispatchEvent(new Event('visual-changed')); }

  useEffect(() => {
    (window as any).electronAPI?.getAutoLaunch?.().then(setAutoLaunch).catch(() => {})
  }, [])

  async function toggleAutoLaunch() {
    const next = !autoLaunch
    const r = await (window as any).electronAPI?.setAutoLaunch?.(next)
    setAutoLaunch(r?.ok ? next : autoLaunch)
  }

  function saveQuickCmds(list: { label: string; text: string }[]) {
    setQuickCmds(list)
    try { localStorage.setItem('lyclaw_quick_commands', JSON.stringify(list)) } catch {}
    // 同步到 DB：localStorage 会在强杀时丢失，DB 不会
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'lyclaw_quick_commands', value: JSON.stringify(list) }) }).catch(() => {})
    window.dispatchEvent(new Event('quick-commands-changed'))
  }

  function addQuickCmd() {
    const label = newQcLabel.trim(), text = newQcText.trim()
    if (!label || !text) return
    saveQuickCmds([...quickCmds, { label, text }])
    setNewQcLabel(''); setNewQcText('')
  }

  function saveCustomProviders(list: typeof customProviders) {
    setCustomProviders(list)
    try { localStorage.setItem('lyclaw_custom_providers', JSON.stringify(list)) } catch {}
  }
  function addCustomProvider() {
    if (!np.name.trim() || !np.baseUrl.trim()) return
    const id = 'custom_' + Date.now().toString(36)
    const item = { id, name: np.name.trim(), baseUrl: np.baseUrl.trim(), model: np.model.trim(), contextWindow: np.contextWindow || 1000000, multimodal: np.multimodal }
    saveCustomProviders([...customProviders, item])
    setForm(f => ({ ...f, providerName: id, apiBaseUrl: item.baseUrl, model: item.model, contextWindow: item.contextWindow, multimodal: item.multimodal, models: item.model ? [item.model] : [] }))
    setNp({ name: '', baseUrl: '', model: '', contextWindow: 128000, multimodal: false })
    setShowNewProvider(false)
  }
  function addModelToList() {
    const m = newModelName.trim()
    if (!m) return
    const next = { ...form, models: [...new Set([...(form.models || []), m])] }
    setForm(next)
    setNewModelName('')
    onSave(next) // 立即持久化，聊天内马上可切换
  }

  async function handleBgUpload() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/gif,image/bmp';
    input.onchange = async () => { const file = input.files?.[0]; if (!file) return; const formData = new FormData(); formData.append('bg', file); try { const res = await fetch('/api/code/upload-bg', { method: 'POST', body: formData }); const data = await res.json(); if (data.success) saveVisual({ ...visual, bgImage: data.path }); } catch (e) { console.error('Upload failed', e); } };
    input.click();
  }

  async function scanLmModels() { setLmScanning(true); setLmError(''); try { const res = await fetch('/api/lm-models'); const data = await res.json(); if (!data.data?.length) setLmError(t('LM Studio 已连接，但没有加载模型', 'LM Studio connected but no models loaded')); setLmModels(data.data || []); } catch (err: any) { setLmError(err.message || t('无法连接 LM Studio', 'Cannot connect to LM Studio')); setLmModels([]); } finally { setLmScanning(false); } }

  useEffect(() => { if (form.provider === 'local') scanLmModels(); }, [form.provider]);



  function updateWorkDir(dir: string) {
    persistNow({ workDir: dir });
    if (workDirSaveTimer.current) clearTimeout(workDirSaveTimer.current);
    workDirSaveTimer.current = setTimeout(() => { onSave({ ...form, workDir: dir }); }, 600);
  }
  async function browseWorkDir() {
    if (!(window as any).electronAPI?.openFolderDialog) return;
    const dirs = await (window as any).electronAPI.openFolderDialog();
    if (dirs?.length) updateWorkDir(dirs[0]);
  }

  async function handleAddFolder() { if (!(window as any).electronAPI?.openFolderDialog) return; setAddingFolder(true); try { const dirs = await (window as any).electronAPI.openFolderDialog(); if (dirs?.length) setForm(f => ({ ...f, allowedFolders: [...new Set([...f.allowedFolders, ...dirs])] })); } finally { setAddingFolder(false); } }
  function removeFolder(dir: string) { setForm(f => ({ ...f, allowedFolders: f.allowedFolders.filter(d => d !== dir) })); }

  async function testConnection() {
    setTestingConn(null)
    setConnDetail('')
    try {
      const res = await fetch('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': form.apiBaseUrl, 'X-Api-Key': form.apiKey || '' },
        body: JSON.stringify({ model: form.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5, stream: false }),
      })
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        // 服务端会返回上游状态与原因，直接展示，避免"只显示失败"无从排查
        let detail = `HTTP ${res.status}`
        try {
          const j = JSON.parse(text)
          detail = [j.error, j.hint, j.upstream && `上游：${j.upstream}`, j.detail].filter(Boolean).join(' · ')
        } catch { if (text) detail += ` · ${text.slice(0, 200)}` }
        setConnDetail(detail || '连接失败')
        setTestingConn('fail')
        return
      }
      let data: any = null
      try { data = JSON.parse(text) } catch { /* SSE 响应 */ }
      if (data?.choices?.[0]?.message || /data:\s*\{/.test(text)) {
        setTestingConn('ok')
        setConnDetail('连接成功，模型可正常返回')
      } else {
        setTestingConn('fail')
        setConnDetail('已连通但未返回有效内容，请确认模型名是否正确')
      }
    } catch (e: any) {
      setTestingConn('fail')
      setConnDetail(e?.message || '请求失败')
    }
  }

  /** 拉取模型列表（无需先保存），拉取结果自动持久化；silent 静默模式不打扰界面 */
  async function fetchModels(silent = false, baseOverride?: string, keyOverride?: string) {
    const base = baseOverride ?? form.apiBaseUrl
    const key = keyOverride ?? form.apiKey
    if (!base.trim()) { if (!silent) { setConnDetail('请先填写 API URL'); setTestingConn('fail') } return }
    setFetchingModels(true)
    if (!silent) setConnDetail('')
    try {
      const res = await fetch('/api/models-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': base, 'X-Api-Key': key || '' },
        body: '{}',
      })
      const data = await res.json()
      const list: string[] = Array.isArray(data?.models) ? data.models : []
      if (data?.error) { if (!silent) { setConnDetail(`拉取失败：${data.error}`); setTestingConn('fail') } return }
      if (list.length === 0) { if (!silent) setConnDetail('该服务未返回模型列表，请手动填写模型名'); return }
      // v7.0：拉取结果「替换」而非合并——旧提供商的模型不再残留
      const merged = [...new Set([...list, form.model].filter(Boolean))]
      const next = { ...form, models: merged }
      setForm(next)
      persistAll(next)
      if (!silent) setConnDetail(`已拉取 ${list.length} 个模型，可在上方列表中点选`)
      setTestingConn('ok')
    } catch (e: any) {
      if (!silent) { setConnDetail(`拉取失败：${e?.message || '请求失败'}`); setTestingConn('fail') }
    } finally { setFetchingModels(false) }
  }

  // 打开设置时模型列表为空 → 静默自动从提供商拉取
  useEffect(() => {
    if ((form.models || []).length === 0 && form.apiBaseUrl && form.apiKey) {
      fetchModels(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBackup = async () => {
    try {
      const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
      const settingsRow = await fetch('/api/settings').then(r => r.json()).catch(() => ({}))
      const memories = await fetch('/api/memories').then(r => r.json()).catch(() => ({}))
      const sessionsWithMsgs = await Promise.all((Array.isArray(sessions) ? sessions : []).map(async (s: any) => ({
        ...s,
        messages: await fetch(`/api/sessions/${s.id}/messages`).then(r => r.json()).catch(() => []),
      })))
      const payload = { app: 'lyclaw', version: APP_VERSION, exported_at: new Date().toISOString(), settings: settingsRow, memories, sessions: sessionsWithMsgs }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `lyclaw-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(a.href)
    } catch (e: any) { alert(`备份失败: ${e.message}`) }
  }

  const handleClearChats = async () => {
    if (!confirm('确定清空所有对话？此操作不可恢复，建议先导出备份。')) return
    const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
    for (const s of (Array.isArray(sessions) ? sessions : [])) {
      await fetch(`/api/sessions/${s.id}`, { method: 'DELETE' }).catch(() => {})
    }
    location.reload()
  }

  const handleResetSettings = () => {
    if (!confirm('确定恢复全部默认设置？')) return
    Object.keys(localStorage).filter(k => k.startsWith('lyclaw_') || k.startsWith('claw:')).forEach(k => localStorage.removeItem(k))
    location.reload()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    try {
      const data = JSON.parse(await file.text())
      if (!data.sessions || !Array.isArray(data.sessions)) throw new Error('备份文件格式不正确')
      let imported = 0
      for (const s of data.sessions) {
        const sid = s.id || `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sid, title: s.title || '导入会话' }) }).catch(() => {})
        for (const m of (s.messages || [])) {
          await fetch(`/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, role: m.role, content: m.content || '', thinking: m.thinking || '', tool_calls: m.tool_calls ? JSON.stringify(m.tool_calls) : '[]' }) }).catch(() => {})
        }
        imported++
      }
      alert(`导入完成：${imported} 个会话`)
    } catch (e: any) { alert(`导入失败: ${e.message}`) }
  }

  useEffect(() => {
    (async () => {
      const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
      let messages = 0
      for (const s of (Array.isArray(sessions) ? sessions : []).slice(0, 50)) {
        const msgs = await fetch(`/api/sessions/${s.id}/messages`).then(r => r.json()).catch(() => [])
        messages += Array.isArray(msgs) ? msgs.length : 0
      }
      setStorageStats({ sessions: (Array.isArray(sessions) ? sessions : []).length, messages })
    })()
  }, [])

  // 安全设置即时生效
  function applySecurityNow(patch: Partial<Settings>) {
    persistNow(patch);
  }

  // 对话行为偏好即时生效
  function applyPrefNow(patch: Partial<Settings>) {
    persistNow(patch);
  }


  // 窗口置顶行（electron 环境才可用）

  // 全量持久化：写库 + 同步主进程 + 刷新全局（设置全自动保存，无保存按钮）
  function persistAll(next: Settings) {
    const api = (window as any).electronAPI;
    api?.setFileAccess?.(next.permissionLevel, next.allowedFolders);
    api?.setShellAccess?.(next.shellAccess);
    onSave(next);
    try {
      localStorage.setItem('lyclaw_settings', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: next }));
    } catch { /* ignore */ }
  }

  const saveTimer = useRef<number | null>(null);
  // 文本输入用 800ms 防抖自动保存
  function persistDebounced(next: Settings) {
    setForm(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persistAll(next), 800);
  }
  // 控件（按钮/开关/下拉）改动立即保存
  // ★ 必须同步 setForm：否则界面状态不更新（开关看起来"点了没反应"）
  function persistNow(patch: Partial<Settings>) {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    const next = { ...form, ...patch };
    setForm(next);
    persistAll(next);
  }

  const canSave = form.provider === 'local' || (form.apiBaseUrl.trim() && form.model.trim() && form.apiKey.trim());

  const inputCls = "w-full px-3 py-2 rounded-lg text-[13px] outline-none transition-colors"
  const inputStyle = { background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }

  return (
    <div className={embedded ? 'h-full w-full overflow-hidden p-4' : 'fixed inset-0 z-50 flex items-center justify-center p-4'} style={embedded ? {} : { background: c.modalOverlay }}>
      {/* 定高弹窗:左侧分区栏固定不动,仅右侧内容滚动 */}
      <div className="flex flex-col rounded-2xl border glass overflow-hidden" style={{ border: `1px solid ${c.border}`, height: embedded ? '100%' : 'min(760px, calc(100vh - 88px))', boxShadow: '0 12px 48px rgba(0,0,0,0.14)' }}>
        {/* 头部 */}
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 shrink-0 border-b" style={{ borderColor: c.borderLight }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold" style={{ color: c.textHead }}>{t('设置', 'Settings')}</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>{APP_VERSION}</span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('推理 · 工作区 · 安全 · 数据 · 外观', 'Inference · Workspace · Security · Data · Appearance')}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: c.textTertiary }} title="关闭"
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>


        <div className="flex flex-1 min-h-0">
          {/* 左侧分区栏（含搜索） */}
          <div className="w-52 shrink-0 border-r py-2 px-1.5 flex flex-col" style={{ borderColor: c.borderLight, background: c.bgAlt }}>
            <div className="relative px-1.5 pb-2 shrink-0">
              <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('搜索设置', 'Search')}
                className="w-full h-8 pl-7 pr-2 rounded-lg text-[12px] outline-none"
                style={{ background: c.bgInput, color: c.text, border: `1px solid ${searchQuery ? c.border : 'transparent'}` }} />
            </div>
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {searchQuery.trim() ? (
                <>
                  {searchHits.map(hit => (
                    <button key={hit.tab + hit.label} onClick={() => { setTab(hit.tab); setSearchQuery('') }}
                      className="w-full px-2.5 py-2 rounded-lg text-left transition-colors"
                      onMouseEnter={e => e.currentTarget.style.background = c.surfaceHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div className="text-[12px] font-medium truncate" style={{ color: c.text }}>{hit.label}</div>
                      <div className="text-[10.5px] truncate" style={{ color: c.textMuted }}>{hit.desc}</div>
                    </button>
                  ))}
                  {searchHits.length === 0 && (
                    <div className="px-2.5 py-6 text-center text-[11px]" style={{ color: c.textMuted }}>{t('未找到匹配设置', 'No matches')}</div>
                  )}
                </>
              ) : (
                CATEGORIES.map(cat => (
                  <button key={cat.id} onClick={() => setTab(cat.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left"
                    style={{ background: tab === cat.id ? c.bgActive || c.bgHover : 'transparent', color: tab === cat.id ? c.textHead : c.textTertiary }}>
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon} />
                    </svg>
                    {cat.label}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右侧编辑区 */}
          <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin" style={{ minWidth: 0 }}>
            {/* 置顶宣传横幅:jtcode 命令行(可关闭,记忆选择) */}
            <CliBanner />

            {tab === 'inference' && (<>

              <Sub c={c} title={t('推理方式', 'Provider')}>
                <div className="flex rounded-lg p-0.5 w-fit" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
                  {([['api', t('API', 'API')], ['local', t('本地', 'Local')]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setForm(f => ({ ...f, provider: v }))}
                      className="px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all"
                      style={form.provider === v ? { background: c.bgCard, color: c.textHead, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: c.textTertiary }}>{l}</button>
                  ))}
                </div>
              </Sub>

              {form.provider === 'api' && (<>
                <Sub c={c} title={t('提供商', 'Provider')}>
                  <div className="flex flex-wrap gap-1.5">
                    {[...PROVIDERS, ...customProviders].map(p => {
                      const active = form.providerName === p.id || (!form.providerName && form.apiBaseUrl === p.baseUrl && p.id !== 'custom')
                      const isCustom = p.id.startsWith('custom_')
                      return (
                        <span key={p.id} className="inline-flex items-center gap-0.5">
                          <button type="button" onClick={() => setForm(f => {
                            const nf = {
                              ...f,
                              providerName: p.id,
                              apiBaseUrl: p.baseUrl || f.apiBaseUrl,
                              model: p.model || f.model,
                              contextWindow: p.contextWindow,
                              multimodal: p.multimodal,
                              models: p.model ? [p.model] : [],
                            };
                            persistNow(nf);
                            // 切换提供商后自动拉取该家的模型列表（用新 baseUrl）
                            setTimeout(() => fetchModels(true, nf.apiBaseUrl, nf.apiKey), 80);
                            return nf;
                          })}
                            className="px-3 py-1.5 rounded-full text-[11.5px] font-medium border transition-all"
                            style={active ? { background: `${c.accent}15`, color: c.accent, borderColor: `${c.accent}40` } : { background: 'transparent', color: c.textTertiary, borderColor: c.border }}>
                            {p.name}
                          </button>
                          {isCustom && (
                            <button type="button" title={t('删除', 'Delete')} onClick={() => {
                              saveCustomProviders(customProviders.filter(x => x.id !== p.id))
                              if (form.providerName === p.id) setForm(f => ({ ...f, providerName: 'custom', apiBaseUrl: '', model: '', contextWindow: 128000, multimodal: false }))
                            }}
                              className="w-4 h-4 -ml-2.5 z-10 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
                              style={{ background: c.toolErr, color: '#fff' }}>
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </span>
                      )
                    })}
                    <button type="button" onClick={() => setShowNewProvider(v => !v)}
                      className="px-3 py-1.5 rounded-full text-[11.5px] font-medium border border-dashed transition-all"
                      style={{ color: c.accent, borderColor: `${c.accent}40`, background: 'transparent' }}>
                      + 新建
                    </button>
                  </div>
                  {showNewProvider && (
                    <div className="mt-2 p-3 rounded-xl space-y-2 animate-fade-up" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} placeholder={t('名称（如 我的网关）', 'Name')} className={inputCls} style={inputStyle} />
                        <input value={np.baseUrl} onChange={e => setNp({ ...np, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className={inputCls} style={inputStyle} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input value={np.model} onChange={e => setNp({ ...np, model: e.target.value })} placeholder={t('默认模型', 'Model')} className={inputCls} style={inputStyle} />
                        <input type="number" min={1000} step={1000} value={np.contextWindow} onChange={e => setNp({ ...np, contextWindow: parseInt(e.target.value, 10) || 1000000 })} placeholder={t('上下文 tokens', 'Context')} className={inputCls} style={inputStyle} />
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer text-[11px]" style={{ color: c.textSecondary }}>
                          <input type="checkbox" checked={np.multimodal} onChange={e => setNp({ ...np, multimodal: e.target.checked })} className="rounded w-3.5 h-3.5" style={{ accentColor: c.accent }} />
                          {t('多模态', 'Multimodal')}
                        </label>
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setShowNewProvider(false)} className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background: c.bgCard, color: c.textTertiary, border: `1px solid ${c.border}` }}>{t('取消', 'Cancel')}</button>
                        <button type="button" onClick={addCustomProvider} disabled={!np.name.trim() || !np.baseUrl.trim()}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white disabled:opacity-40" style={{ background: c.accent }}>{t('保存并应用', 'Save & Apply')}</button>
                      </div>
                    </div>
                  )}
                  <p className="text-[10.5px] mt-1.5" style={{ color: c.textMuted }}>{t('切换提供商会自动填充 API 地址、默认模型与能力参数；"新建"可添加任意自定义提供商', 'Switching provider auto-fills API URL, model and capabilities; "New" adds any custom provider')}</p>
                </Sub>
                <Field c={c} label="API URL"><input type="url" value={form.apiBaseUrl} onChange={e => persistDebounced({ ...form, apiBaseUrl: e.target.value, models: [] })} placeholder="https://api.openai.com/v1" className={inputCls} style={inputStyle} /></Field>
                <Field c={c} label="API Key"><input type="password" value={form.apiKey} onChange={e => persistDebounced({ ...form, apiKey: e.target.value })} placeholder="sk-..." autoComplete="off" className={inputCls} style={inputStyle} /></Field>
                <Field c={c} label={t('模型', 'Model')}><input type="text" value={form.model} onChange={e => persistDebounced({ ...form, model: e.target.value })} placeholder="gpt-4o / claude-3.5-sonnet" className={inputCls} style={inputStyle} /></Field>
                <div className="space-y-1.5 mb-4">
                  <label className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{t('模型列表（快捷切换）', 'Model list (quick switch)')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set([...(form.models || []), form.model].filter(Boolean))].map(m => (
                      <span key={m} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
                        style={m === form.model ? { background: `${c.accent}15`, color: c.accent, border: `1px solid ${c.accent}40` } : { background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                        <button type="button" onClick={() => { const nf = { ...form, model: m }; setForm(nf); persistAll(nf); }}
                          title={t('设为当前模型', 'Set as current model')} style={{ color: 'inherit', cursor: 'pointer' }}>
                          {m === form.model ? `● ${m}` : m}
                        </button>
                        {m !== form.model && (
                          <button type="button" onClick={() => { const nf = { ...form, models: (form.models || []).filter(x => x !== m) }; setForm(nf); persistAll(nf); }}
                            className="hover:opacity-70" title={t('移除', 'Remove')}>
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </span>
                    ))}
                    <span className="inline-flex items-center gap-1">
                      <input value={newModelName} onChange={e => setNewModelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addModelToList() }}
                        placeholder={t('添加模型名…', 'Add model…')}
                        className="w-28 px-2 py-1 rounded-full text-[11px] outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
                      <button type="button" onClick={addModelToList} disabled={!newModelName.trim()}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white disabled:opacity-40 shrink-0" style={{ background: c.accent }} title={t('添加', 'Add')}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </span>
                  </div>
                  <p className="text-[10.5px]" style={{ color: c.textMuted }}>{t('当前模型带 ● 标记；添加多个模型后可在对话输入框一键切换', 'Current model marked ●; with multiple models you can switch instantly in chat')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{t('上下文窗口 (tokens)', 'Context window (tokens)')}</label>
                    <input type="number" min={1000} step={1000} value={form.contextWindow || 1000000}
                      onChange={e => persistDebounced({ ...form, contextWindow: parseInt(e.target.value, 10) || 1000000 })}
                      className={inputCls} style={inputStyle} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{t('多模态（图片输入）', 'Multimodal (image input)')}</label>
                    <button type="button" role="switch" aria-checked={!!form.multimodal} onClick={() => persistNow({ multimodal: !form.multimodal })}
                      className="relative w-10 h-5 rounded-full transition-colors" style={{ background: form.multimodal ? c.accent : `${c.textMuted}44` }}>
                      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: form.multimodal ? 'calc(100% - 18px)' : '2px' }} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button type="button" onClick={testConnection} disabled={testingConn === null && false}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                    {testingConn === 'ok' ? '已连接' : '测试连接'}
                  </button>
                  <button type="button" onClick={fetchModels} disabled={fetchingModels}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-50"
                    style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                    {fetchingModels ? '拉取中…' : '拉取模型列表'}
                  </button>
                  {testingConn === 'ok' && !connDetail && <span className="text-[11px]" style={{ color: c.toolOk }}>连接成功</span>}
                </div>
                {connDetail && (
                  <div className="mb-4 px-3 py-2 rounded-lg text-[11px] leading-relaxed break-words"
                    style={{
                      background: testingConn === 'ok' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
                      border: `1px solid ${testingConn === 'ok' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}`,
                      color: testingConn === 'ok' ? c.toolOk : c.toolErr,
                    }}>
                    {connDetail}
                  </div>
                )}
              </>)}
              {form.provider === 'local' && (<>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium" style={{ color: c.textSecondary }}>LM Studio</label>
                  <button type="button" onClick={scanLmModels} disabled={lmScanning} className="text-[11px]" style={{ color: lmScanning ? c.textMuted : c.accent }}>{lmScanning ? t('扫描中...', 'Scanning...') : t('刷新', 'Refresh')}</button>
                </div>
                {lmError && !lmModels.length && <div className="mb-2 p-3 rounded-lg text-[11px]" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', color: c.toolWarn }}>{lmError}</div>}
                {lmModels.length > 0
                  ? <select value={form.localModel} onChange={e => persistNow({ localModel: e.target.value })} className={inputCls} style={inputStyle}>{lmModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}</select>
                  : <div className="w-full px-3 py-3 text-[12px] text-center rounded-lg" style={{ border: `1px dashed ${c.border}`, color: c.textMuted, background: c.bgInput }}>{lmScanning ? t('正在扫描...', 'Scanning...') : t('点击刷新加载模型', 'Click Refresh to load models')}</div>}
              </>)}
              <Sub c={c} title={t('语音朗读音色', 'Voice')}>
                <select value={form.voiceId} onChange={e => persistNow({ voiceId: e.target.value })} className={inputCls} style={inputStyle}>
                  <option value="zh-CN-XiaoxiaoNeural">晓晓 (女)</option><option value="zh-CN-XiaoyiNeural">晓伊 (女)</option>
                  <option value="zh-CN-YunjianNeural">云健 (男)</option><option value="zh-CN-YunxiNeural">云希 (男)</option>
                  <option value="zh-CN-YunxiaNeural">云夏 (男)</option><option value="zh-CN-YunyangNeural">云扬 (男)</option>
                </select>
              </Sub>
            </>)}

            {tab === 'workspace' && (<>
              <Sub c={c} title={t('AI 工作目录', 'AI Working Directory')}>
                <div className="flex gap-2">
                  <input type="text" value={form.workDir} onChange={e => updateWorkDir(e.target.value)} placeholder={t('留空则使用系统默认目录', 'Leave empty for system default')} className={inputCls + ' font-mono'} style={inputStyle} />
                  <button type="button" onClick={browseWorkDir} className="shrink-0 px-4 py-2 rounded-lg text-xs font-medium" style={{ background: c.accent, color: c.accentText }}>{t('浏览', 'Browse')}</button>
                </div>
                <p className="text-[11px] mt-2" style={{ color: c.textMuted }}>{t('AI 执行命令、读写文件的默认目录，修改后立即生效。', 'Default directory for AI commands and file operations. Takes effect immediately.')}</p>
              </Sub>
              <Sub c={c} title="本机环境">
                <div className="p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}`, color: c.textTertiary }}>
                  当前系统：{/Win/i.test(navigator.platform || '') ? 'Windows（PowerShell）' : 'macOS（zsh）'} · 数据存储：本地 SQLite · 工作目录影响所有对话的 AI 工具调用
                </div>
              </Sub>
              <Sub c={c} title={t('运行行为', 'Runtime')}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('合盖保持运行', 'Keep awake on lid close')}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('笔记本合盖或空闲时防止系统休眠，后台任务持续执行（默认开启）', 'Prevent system sleep when the lid is closed or idle, so background tasks keep running (on by default)')}</div>
                    </div>
                    <button type="button" role="switch" aria-checked={form.keepAwake !== false} onClick={() => persistNow({ keepAwake: form.keepAwake === false })}
                      className="relative w-10 h-5 rounded-full transition-colors shrink-0" style={{ background: form.keepAwake !== false ? c.accent : `${c.textMuted}44` }}>
                      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: form.keepAwake !== false ? 'calc(100% - 18px)' : '2px' }} />
                    </button>
                  </div>
                  {(window as any).electronAPI && (
                    <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                      <div>
                        <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('开机自启', 'Launch at login')}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('登录系统后自动启动应用', 'Start the app automatically after you log in')}</div>
                      </div>
                      <button type="button" role="switch" aria-checked={!!autoLaunch} onClick={toggleAutoLaunch} disabled={autoLaunch === null}
                        className="relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40" style={{ background: autoLaunch ? c.accent : `${c.textMuted}44` }}>
                        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: autoLaunch ? 'calc(100% - 18px)' : '2px' }} />
                      </button>
                    </div>
                  )}
                </div>
              </Sub>
              <Sub c={c} title={t('手机远程', 'Remote Access')}>
                <RemoteAccess />
              </Sub>

              <Sub c={c} title={t('快捷指令', 'Quick Commands')}>
                <div className="space-y-2">
                  {quickCmds.length === 0 && (
                    <p className="text-[11px]" style={{ color: c.textMuted }}>{t('还没有自定义指令，添加后会在侧边栏"快捷指令"面板置顶显示', 'No custom commands yet. Add one and it will show at the top of the Quick Commands panel')}</p>
                  )}
                  {quickCmds.map((qc, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium truncate" style={{ color: c.textHead }}>{qc.label}</div>
                        <div className="text-[10.5px] truncate mt-0.5" style={{ color: c.textMuted }}>{qc.text}</div>
                      </div>
                      <button type="button" onClick={() => saveQuickCmds(quickCmds.filter((_, j) => j !== i))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors" style={{ color: c.toolErr }}
                        title={t('删除', 'Delete')}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <input value={newQcLabel} onChange={e => setNewQcLabel(e.target.value)} placeholder={t('名称', 'Label')}
                      className="flex-1 px-2.5 py-2 rounded-lg text-[11px] outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
                    <input value={newQcText} onChange={e => setNewQcText(e.target.value)} placeholder={t('发送给 AI 的指令内容', 'Prompt text')}
                      onKeyDown={e => { if (e.key === 'Enter') addQuickCmd() }}
                      className="flex-[2] px-2.5 py-2 rounded-lg text-[11px] outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
                    <button type="button" onClick={addQuickCmd} disabled={!newQcLabel.trim() || !newQcText.trim()}
                      className="px-3 py-2 rounded-lg text-[11px] font-medium text-white disabled:opacity-40 shrink-0 transition-all hover:scale-105" style={{ background: c.accent }}>
                      {t('添加', 'Add')}
                    </button>
                  </div>
                </div>
              </Sub>
            </>)}

            {tab === 'security' && (<>
              <Sub c={c} title={t('MCP 外部工具', 'MCP Tools')}>
                <McpSection c={c} t={t} />
              </Sub>
              <Sub c={c} title={t('AI 权限等级', 'Permission Level')}>
                <p className="text-[10.5px] mb-2" style={{ color: c.textTertiary }}>{t('安全设置修改后立即生效，无需点击保存。', 'Security changes apply immediately — no need to save.')}</p>
                <div className="space-y-2">
                  {PERMISSION_LEVELS.map(level => {
                    const isActive = form.permissionLevel === level.id
                    return (
                      <button key={level.id} type="button" onClick={() => applySecurityNow({ permissionLevel: level.id })}
                        className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all"
                        style={{ background: isActive ? `${level.color}10` : c.bgInput, border: `1px solid ${isActive ? level.color : 'transparent'}` }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: isActive ? level.color : `${c.textMuted}22` }}>
                          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: isActive ? '#fff' : c.textMuted }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={level.icon} />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium" style={{ color: isActive ? level.color : c.textSecondary }}>{lang === 'zh' ? level.label_zh : level.label_en}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{lang === 'zh' ? level.desc_zh : level.desc_en}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Sub>
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('Shell 命令执行', 'Shell Access')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('允许 AI 执行系统命令', 'Allow AI to execute commands')}</div></div>
                <button type="button" role="switch" aria-checked={form.shellAccess} onClick={() => applySecurityNow({ shellAccess: !form.shellAccess })} className="relative w-10 h-5 rounded-full transition-colors shrink-0" style={{ background: form.shellAccess ? c.accent : `${c.textMuted}44` }}>
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: form.shellAccess ? 'calc(100% - 18px)' : '2px' }} />
                </button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg mt-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('集群敏感操作拦截', 'Swarm Sensitive Block')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('Agent 集群中拦截删除文件与高危命令', 'Block delete_file & dangerous commands in swarm')}</div></div>
                <button type="button" role="switch" aria-checked={form.sensitiveBlock !== false} onClick={() => applySecurityNow({ sensitiveBlock: form.sensitiveBlock === false })} className="relative w-10 h-5 rounded-full transition-colors shrink-0" style={{ background: form.sensitiveBlock !== false ? c.accent : `${c.textMuted}44` }}>
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ left: form.sensitiveBlock !== false ? 'calc(100% - 18px)' : '2px' }} />
                </button>
              </div>
              <Sub c={c} title={t('可访问文件夹', 'Allowed Folders')}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px]" style={{ color: c.textTertiary }}>{form.allowedFolders.length} 个授权目录</span>
                  <button type="button" onClick={handleAddFolder} disabled={addingFolder} className="text-[11px] px-2.5 py-1 rounded-lg font-medium" style={{ background: c.accent, color: c.accentText }}>{addingFolder ? t('打开中...', 'Opening...') : '+ ' + t('添加', 'Add')}</button>
                </div>
                {form.allowedFolders.length === 0
                  ? <div className="rounded-lg p-5 text-center text-[11px]" style={{ border: `1px dashed ${c.border}`, color: c.textMuted, background: c.bgInput }}>{t('暂未添加任何文件夹', 'No folders added')}</div>
                  : <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                      {form.allowedFolders.map(dir => (
                        <div key={dir} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: `1px solid ${c.borderLight}`, background: c.bgInput }}>
                          <span className="truncate flex-1 text-[11px] font-mono" style={{ color: c.textSecondary }}>{dir}</span>
                          <button type="button" onClick={() => removeFolder(dir)} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: c.textMuted }}>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>}
              </Sub>
            </>)}

            {tab === 'usage' && (<>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {(() => { const s = summarizeUsage(7); return [
                  { label: '今日对话', value: `${s.today.msgs} 轮` },
                  { label: '今日 tokens', value: fmtTokens(s.today.prompt + s.today.completion) },
                  { label: '累计对话', value: `${s.total.msgs} 轮` },
                ] })().map(card => (
                  <div key={card.label} className="px-3 py-3 rounded-lg text-center" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                    <div className="text-[10px]" style={{ color: c.textMuted }}>{card.label}</div>
                    <div className="text-[15px] font-semibold mt-1" style={{ color: c.textHead }}>{card.value}</div>
                  </div>
                ))}
              </div>
              <Sub c={c} title={t('近 7 天明细', 'Last 7 days')}><UsageStats /></Sub>
              <p className="text-[10.5px]" style={{ color: c.textMuted }}>{t('统计基于 token 估算值，按本地存储保留 90 天。', 'Based on token estimates, stored locally for 90 days.')}</p>
            </>)}

            {tab === 'data' && (<>
              <Sub c={c} title={t('备份与恢复', 'Backup & Restore')}>
                <div className="flex gap-2 mb-1">
                  <button type="button" onClick={async () => {
                    try {
                      const r = await fetch('/api/backup/export')
                      const d = await r.json()
                      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
                      const a2 = document.createElement('a')
                      a2.href = URL.createObjectURL(blob)
                      a2.download = `巨天备份-${new Date().toISOString().slice(0, 10)}.json`
                      a2.click()
                      URL.revokeObjectURL(a2.href)
                    } catch (e: any) { alert('导出失败: ' + e.message) }
                  }} className="flex-1 py-2.5 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>
                    {t('导出全部数据', 'Export all data')}
                  </button>
                  <button type="button" onClick={() => (document.getElementById('jutian-backup-import') as HTMLInputElement)?.click()}
                    className="flex-1 py-2.5 rounded-lg text-[12px] font-medium" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                    {t('导入备份', 'Import backup')}
                  </button>
                  <input id="jutian-backup-import" type="file" accept=".json" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (!confirm('导入将合并会话与设置，继续？')) return
                    try {
                      const text = await f.text()
                      const r = await fetch('/api/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
                      const d = await r.json()
                      if (d.error) alert('导入失败: ' + d.error)
                      else alert(`导入完成：${d.sessions} 个会话 / ${d.messages} 条消息`)
                    } catch (e: any) { alert('导入失败: ' + e.message) }
                    e.target.value = ''
                  }} />
                </div>
                <p className="text-[10.5px]" style={{ color: c.textMuted }}>{t('导出包含全部会话、消息、设置与记忆；导入按合并方式恢复。', 'Exports sessions, messages, settings and memories; import merges.')}</p>
              </Sub>
              {storageStats && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="px-3 py-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                    <div className="text-[10px]" style={{ color: c.textMuted }}>会话数</div>
                    <div className="text-[15px] font-semibold mt-1" style={{ color: c.textHead }}>{storageStats.sessions}</div>
                  </div>
                  <div className="px-3 py-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                    <div className="text-[10px]" style={{ color: c.textMuted }}>消息数</div>
                    <div className="text-[15px] font-semibold mt-1" style={{ color: c.textHead }}>{storageStats.messages}</div>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('导出备份', 'Export Backup')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('所有会话、消息、设置与记忆导出为 JSON', 'All sessions, messages, settings and memories as JSON')}</div></div>
                  <button type="button" onClick={handleBackup} className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0" style={{ background: c.accent, color: c.accentText }}>导出</button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('导入备份', 'Import Backup')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('从导出的 JSON 文件恢复会话', 'Restore sessions from exported JSON')}</div></div>
                  <button type="button" onClick={() => importRef.current?.click()} className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textSecondary }}>导入</button>
                  <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('清空所有对话', 'Clear All Chats')}</div><div className="text-[11px] mt-0.5" style={{ color: c.toolErr }}>{t('删除全部会话与消息，不可恢复', 'Deletes all sessions and messages, irreversible')}</div></div>
                  <button type="button" onClick={handleClearChats} className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0" style={{ background: c.toolErr, color: '#fff' }}>清空</button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('恢复默认设置', 'Reset Settings')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('清除本地设置并重新载入', 'Clears local settings and reloads')}</div></div>
                  <button type="button" onClick={handleResetSettings} className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textSecondary }}>重置</button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div><div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('优化数据库', 'Vacuum Database')}</div><div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{vacuumMsg || t('压缩 SQLite 文件，回收已删除数据的空间', 'Compact SQLite and reclaim space')}</div></div>
                  <button type="button" onClick={async () => {
                    setVacuumMsg('执行中…')
                    try {
                      const r = await fetch('/api/db/vacuum', { method: 'POST' })
                      const d = await r.json()
                      setVacuumMsg(d.success ? d.output : `失败: ${d.error}`)
                    } catch { setVacuumMsg('请求失败') }
                  }} className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textSecondary }}>执行</button>
                </div>
              </div>
              <p className="text-[10.5px] mt-3" style={{ color: c.textMuted }}>{t('数据存储于本地 SQLite 与 localStorage，建议定期导出备份。', 'Data is stored locally; export backups regularly.')}</p>
            </>)}

            {tab === 'appearance' && (<>
              {/* 宣传标签置顶 */}
              <Sub c={c} title={t('主题模式', 'Theme')}>
                <div className="flex gap-2">
                  {([['light', '纯白（Codex）'], ['dark', '深色'], ['auto', '跟随系统']] as const).map(([t2, label]) => {
                    const active = (settings as any).theme === t2 || (!(settings as any).theme && t2 === 'light')
                    return (
                      <button key={t2} type="button" onClick={() => setTheme(t2)}
                        className="flex-1 py-2.5 rounded-lg text-[12.5px] font-medium transition-all"
                        style={{ background: active ? c.bgCard : c.bgInput, color: active ? c.textHead : c.textTertiary, border: `1px solid ${active ? c.border : 'transparent'}` }}>
                        {t(label, label)}
                      </button>
                    )
                  })}
                </div>
              </Sub>

              {/* jtcode 命令行工具（随时可装/可看安装位置） */}
              <CliEntry />

              {/* 强调色（22）：新建按钮/链接/active 态的强调色，实时生效 */}
              <Sub c={c} title={t('强调色', 'Accent Color')}>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(ACCENT_PRESETS).map(([key, preset]) => {
                    const active = getAccentKey() === key
                    const swatch = theme === 'dark' ? preset.dark : preset.light
                    return (
                      <button key={key} type="button"
                        onClick={() => { setAccentKey(key); setAccentTick(x => x + 1) }}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-all"
                        style={{
                          background: active ? c.bgCard : c.bgInput,
                          color: active ? c.textHead : c.textTertiary,
                          border: `1px solid ${active ? c.border : 'transparent'}`,
                        }}>
                        <span className="w-3 h-3 rounded-full" style={{ background: swatch }} />
                        {t(preset.label, key)}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10.5px] mt-1.5" style={{ color: c.textTertiary }}>{t('影响新建对话、链接与选中态等强调元素。', 'Affects primary buttons, links and active states.')}</p>
              </Sub>

              {/* 窗口置顶（27） */}
              <Sub c={c} title={t('窗口行为', 'Window')}>
                <AlwaysOnTopRow c={c} t={t} />
              </Sub>

              {/* 快捷键一览（23） */}
              <Sub c={c} title={t('快捷键', 'Shortcuts')}>
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${c.borderLight}` }}>
                  {([
                    ['⌘/Ctrl + K', '搜索对话'],
                    ['⌘/Ctrl + F', '消息内搜索'],
                    ['⌘/Ctrl + P', 'Code 快速打开文件'],
                    ['⌘/Ctrl + Shift + F', 'Code 全局搜索'],
                    ['⌘/Ctrl + S', '保存当前文件'],
                    ['⌘/Ctrl + /', '切换代码注释'],
                    ['⌘/Ctrl + Shift + S', '截图提问'],
                    ['⌘/Ctrl + Shift + A', '全局唤起 / 隐藏主窗口'],
                    ['Esc', '关闭弹层 / 取消框选'],
                  ] as const).map(([keys, desc], i) => (
                    <div key={keys} className="flex items-center justify-between px-3 py-2"
                      style={{ background: i % 2 === 0 ? c.bgInput : 'transparent' }}>
                      <span className="text-[11.5px]" style={{ color: c.textSecondary }}>{desc}</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: c.bgCard, color: c.textTertiary, border: `1px solid ${c.borderLight}` }}>{keys}</span>
                    </div>
                  ))}
                </div>
              </Sub>

              <Sub c={c} title={t('对话行为', 'Chat Behavior')}>
                <p className="text-[10.5px] -mt-1 mb-2.5" style={{ color: c.textTertiary }}>{t('以下设置修改后立即生效。', 'These apply immediately.')}</p>
                {/* 发送键行为 */}
                <div className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('Enter 键直接发送', 'Enter to send')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>
                      {form.enterToSend !== false ? t('Enter 发送，Shift+Enter 换行', 'Enter sends, Shift+Enter newline') : t('Cmd/Ctrl+Enter 发送，Enter 换行', 'Cmd/Ctrl+Enter sends')}
                    </div>
                  </div>
                  <Toggle c={c} on={form.enterToSend !== false} onClick={() => applyPrefNow({ enterToSend: form.enterToSend === false })} />
                </div>
                {/* 聊天字号 */}
                <div className="p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div className="text-[13px] font-medium mb-2" style={{ color: c.textHead }}>{t('聊天字号', 'Chat Font Size')}</div>
                  <div className="flex gap-2">
                    {([['small', t('小', 'Small'), '14px'], ['standard', t('标准', 'Standard'), '15px'], ['large', t('大', 'Large'), '16px']] as const).map(([id, label, demo]) => (
                      <button key={id} type="button" onClick={() => applyPrefNow({ chatFontSize: id })}
                        className="flex-1 py-2 rounded-lg transition-all"
                        style={{
                          fontSize: demo,
                          background: (form.chatFontSize || 'standard') === id ? c.bgCard : 'transparent',
                          color: (form.chatFontSize || 'standard') === id ? c.textHead : c.textTertiary,
                          border: `1px solid ${(form.chatFontSize || 'standard') === id ? c.border : 'transparent'}`,
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* AI 自动标题 */}
                <div className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('AI 自动生成对话标题', 'AI auto title')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('首次回复后用模型生成简洁标题', 'Generate a concise title after first reply')}</div>
                  </div>
                  <Toggle c={c} on={form.autoTitle !== false} onClick={() => applyPrefNow({ autoTitle: form.autoTitle === false })} />
                </div>
                {/* 自动朗读 */}
                <div className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('AI 回复自动朗读', 'Auto read replies')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('每次回复完成后自动朗读（音色见下方）', 'Read every reply aloud')}</div>
                  </div>
                  <Toggle c={c} on={!!form.autoSpeak} onClick={() => applyPrefNow({ autoSpeak: !form.autoSpeak })} />
                </div>
                {/* 完成通知 */}
                <div className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('回复完成系统通知', 'Notify on completion')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('窗口在后台时弹系统通知', 'System notification when window is hidden')}</div>
                  </div>
                  <Toggle c={c} on={!!form.notifyDone} onClick={() => { if (!form.notifyDone && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); applyPrefNow({ notifyDone: !form.notifyDone }) }} />
                </div>
                {/* 朗读音色与语速 */}
                <div className="p-3 rounded-lg mb-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div className="text-[13px] font-medium mb-2" style={{ color: c.textHead }}>{t('朗读音色', 'Read-aloud Voice')}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={form.voiceId || 'zh-CN-XiaoxiaoNeural'}
                      onChange={e => { applyPrefNow({ voiceId: e.target.value }); }}
                      className="h-8 px-2 rounded-lg text-[12px] outline-none cursor-pointer flex-1 min-w-[160px]"
                      style={{ background: c.bgCard, color: c.text, border: `1px solid ${c.border}` }}>
                      <option value="zh-CN-XiaoxiaoNeural">晓晓 · 温暖女声</option>
                      <option value="zh-CN-XiaoyiNeural">小依 · 活泼女声</option>
                      <option value="zh-CN-YunxiNeural">云希 · 青年男声</option>
                      <option value="zh-CN-YunyangNeural">云扬 · 新闻男声</option>
                      <option value="zh-CN-liaoning-XiaobeiNeural">小北 · 东北女声</option>
                    </select>
                    <select value={form.ttsSpeed || '1.0'}
                      onChange={e => applyPrefNow({ ttsSpeed: e.target.value })}
                      className="h-8 px-2 rounded-lg text-[12px] outline-none cursor-pointer"
                      style={{ background: c.bgCard, color: c.text, border: `1px solid ${c.border}` }}>
                      <option value="0.8">0.8x 慢速</option>
                      <option value="1.0">1.0x 标准</option>
                      <option value="1.2">1.2x 快速</option>
                    </select>
                    <button type="button"
                      onClick={() => {
                        try { window.__ttsPreview?.pause?.() } catch {}
                        fetch('/api/edge-tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好，我是巨天，这是朗读音色试听效果。', voice: form.voiceId || 'zh-CN-XiaoxiaoNeural', speed: Number(form.ttsSpeed) || 1.0 }) })
                          .then(r => { if (!r.ok) throw new Error(); return r.blob() })
                          .then(b => { const a = new Audio(URL.createObjectURL(b)); (window as any).__ttsPreview = a; a.play() })
                          .catch(() => alert('试听失败：语音服务未就绪'))
                      }}
                      className="h-8 px-3 rounded-lg text-[12px] font-medium shrink-0" style={{ background: c.accent, color: c.accentText }}>
                      {t('试听', 'Preview')}
                    </button>
                  </div>
                  <p className="text-[10.5px] mt-1.5" style={{ color: c.textMuted }}>{t('朗读前会自动清理 Markdown 符号、代码块与链接。', 'Markdown symbols, code blocks and links are stripped before reading.')}</p>
                </div>
                {/* 自动压缩阈值 */}
                <div className="p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('上下文自动压缩阈值', 'Auto-compact threshold')}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>{t('Code 模式历史达到窗口该比例时自动压缩', 'Compact Code chat history at this ratio of context window')}</div>
                    </div>
                    <span className="text-[13px] font-mono" style={{ color: c.accent }}>{form.autoCompactPct ?? 70}%</span>
                  </div>
                  <input type="range" min={30} max={95} step={5} value={form.autoCompactPct ?? 70}
                    onChange={e => applyPrefNow({ autoCompactPct: Number(e.target.value) })}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ accentColor: c.accent }} />
                </div>
              </Sub>
              <Sub c={c} title={t('液态玻璃模糊强度', 'Glass Blur')}>
                <input type="range" min={0} max={30} value={visual.glassBlur} onChange={e => saveVisual({ ...visual, glassBlur: Number(e.target.value) })} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ accentColor: c.accent }} />
                <div className="text-right text-[11px] font-mono mt-1" style={{ color: c.accent }}>{visual.glassBlur}px</div>
              </Sub>
              <Sub c={c} title={t('动态壁纸', 'Dynamic Wallpaper')}>
                <p className="text-[11px] mb-3" style={{ color: c.textTertiary }}>{t('默认使用内置动态视频壁纸，可切换为静态图、自定义上传或关闭。', 'Defaults to the built-in dynamic video wallpaper. Switch to a still image, upload your own, or turn it off.')}</p>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-20 h-14 rounded-lg overflow-hidden shrink-0" style={{ backgroundImage: `url('${visual.bgImage || '/bg_upload.mp4'}')`, backgroundSize: 'cover', backgroundPosition: 'center', background: c.bgInput }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono truncate" style={{ color: c.textSecondary }}>{visual.bgImage || '/bg_upload.mp4'}</div>
                    <div className="text-[10.5px]" style={{ color: c.textMuted }}>{/\.(mp4|mov|webm)$/i.test(visual.bgImage||'') ? '动态视频' : (visual.bgImage ? '静态图片' : '跟随内置视频')}</div>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap mb-3">
                  <button type="button" onClick={() => saveVisual({ ...visual, bgImage: '/bg_upload.mp4' })} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium" style={{ background: visual.bgImage==='/bg_upload.mp4' ? c.bgActive : c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }}>{t('内置动态视频', 'Built-in video')}</button>
                  <button type="button" onClick={handleBgUpload} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium" style={{ background: c.accent, color: c.accentText }}>{t('上传图片/视频', 'Upload')}</button>
                  <button type="button" onClick={() => saveVisual({ ...visual, bgImage: '' })} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium" style={{ background: (visual.bgImage || '') === '' ? 'rgba(16,163,127,.15)' : c.bgInput, color: (visual.bgImage || '') === '' ? c.accent : c.textSecondary, border: `1px solid ${(visual.bgImage || '') === '' ? 'rgba(16,163,127,.4)' : c.border}` }}>{t('关闭壁纸（渐变）', 'Off → gradient')}</button>
                </div>
                {(visual.bgImage || '') === '' && (
                  <p className="text-[10.5px] mb-2" style={{ color: c.accent }}>{t('已关闭壁纸：使用随主题自适应的深色渐变背景，更省 GPU。', 'Wallpaper off: theme-aware gradient background, saves GPU.')}</p>
                )}
                {([['light', t('浅色主题透明度', 'Light opacity'), visual.bgOpacityLight, (v: number) => saveVisual({ ...visual, bgOpacityLight: v })], ['dark', t('深色主题透明度', 'Dark opacity'), visual.bgOpacityDark, (v: number) => saveVisual({ ...visual, bgOpacityDark: v })]] as const).map(([id, label, value, setter]) => (
                  <div key={id} className="mb-2">
                    <div className="flex items-center justify-between mb-1"><span className="text-[11px]" style={{ color: c.textTertiary }}>{label}</span><span className="text-[11px] font-mono" style={{ color: c.accent }}>{Number(value).toFixed(2)}</span></div>
                    <input type="range" min={0} max={1} step={0.05} value={value} onChange={e => setter(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ accentColor: c.accent }} />
                  </div>
                ))}
              </Sub>

            </>)}

            {tab === 'language' && (<>
              <Sub c={c} title={t('界面语言', 'Interface Language')}>
                <div className="flex gap-2">
                  {([['zh', '中文'], ['en', 'English']] as const).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setLang(id)} className="flex-1 py-2.5 rounded-lg text-[12.5px] font-medium transition-all"
                      style={{ background: lang === id ? c.bgCard : c.bgInput, color: lang === id ? c.textHead : c.textTertiary, border: `1px solid ${lang === id ? c.border : 'transparent'}` }}>{label}</button>
                  ))}
                </div>
                <p className="text-[11px] mt-2" style={{ color: c.textMuted }}>{t('选择界面显示语言，更改后立即生效', 'Select interface language, changes take effect immediately')}</p>
              </Sub>
            </>)}

            {tab === 'about' && (<>
              <div className="text-center pt-2 pb-4">
                <div className="w-14 h-14 mx-auto rounded-xl flex items-center justify-center" style={{ background: c.brand }}>
                  <svg className="w-7 h-7" style={{ color: c.onBrand }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <h3 className="text-[15px] font-semibold mt-3" style={{ color: c.textHead }}>{'巨天agent v' + APP_VERSION}</h3>
                <p className="text-[11px] mt-1" style={{ color: c.textTertiary }}>ly-next 架构 · AI 桌面工作台</p>
              </div>
              <div className="space-y-2 text-[12px]" style={{ color: c.textSecondary }}>
                {[
                  ['架构', 'ly-next：单一后端 + SQLite 单一数据源'],
                  ['核心能力', '对话 · Agent 集群 · 代码 · PPT · 终端 · 语音'],
                  ['数据', '全部存储于本机，支持一键导出备份'],
                  ['环境', navigator.platform.includes('Mac') ? 'macOS（Apple Silicon）' : navigator.platform],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-3 py-2 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
                    <span className="w-16 shrink-0 font-medium" style={{ color: c.textMuted }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>

              {/* 环境诊断：一键体检各子系统 */}
              <div className="mt-4">
                <button onClick={async () => {
                  setDiagLoading(true); setDiagResult(null)
                  try {
                    const r = await fetch('/api/diagnostics')
                    setDiagResult(await r.json())
                  } catch { setDiagResult({ success: false, checks: [], allOk: false }) }
                  setDiagLoading(false)
                }} disabled={diagLoading}
                  className="w-full h-9 rounded-lg text-[12.5px] font-medium transition-all active:scale-[0.98] disabled:opacity-40"
                  style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }}>
                  {diagLoading ? '诊断中…' : '环境诊断'}
                </button>
                {diagResult && (
                  <div className="mt-2 rounded-lg overflow-hidden" style={{ border: `1px solid ${c.borderLight}` }}>
                    {diagResult.checks.map((c2: any, i: number) => (
                      <div key={c2.name} className="flex items-center gap-2 px-3 py-2 text-[11.5px]"
                        style={{ background: i % 2 === 0 ? c.bgInput : 'transparent' }}>
                        <span style={{ color: c2.ok ? c.toolOk : c.toolErr }}>{c2.ok ? '✓' : '✗'}</span>
                        <span style={{ color: c.text }}>{c2.name}</span>
                        <span className="ml-auto truncate max-w-[55%] text-[10.5px]" style={{ color: c.textMuted }}>{c2.detail}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: c.bgCard }}>
                      <span className="text-[11px] font-medium flex-1" style={{ color: diagResult.allOk ? c.toolOk : c.toolWarn }}>
                        {diagResult.allOk ? '所有子系统正常' : '部分子系统不可用（语音相关在部分环境为预期行为）'}
                      </span>
                      <button onClick={() => {
                        const text = diagResult.checks.map((c2: any) => `${c2.ok ? '[OK]' : '[FAIL]'} ${c2.name}: ${c2.detail}`).join('\n')
                        navigator.clipboard.writeText(`巨天agent 环境诊断 ${new Date().toLocaleString()}\n${text}`).catch(() => {})
                        setDiagCopied(true); setTimeout(() => setDiagCopied(false), 1800)
                      }} className="text-[10.5px] px-2 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>
                        {diagCopied ? '已复制' : '复制报告'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>)}

            {tab !== 'language' && tab !== 'about' && (
              <p className="text-center text-[11px] mt-2" style={{ color: c.textMuted }}>{t('所有设置自动保存，改动即时生效', 'All settings save automatically and apply instantly')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


/** jtcode CLI 安装入口（外观页） */

/** 置顶宣传横幅:包装 CliEntry,可关闭并记忆(单一实例,所有页签顶部) */
function CliBanner() {
  const { c, t } = { ...useTheme(), t: (a: string, b?: string) => a }
  const [hidden, setHidden] = useState<boolean>(() => { try { return localStorage.getItem('settings-cli-banner') === '0' } catch { return false } })
  if (hidden) return null
  return (
    <div className="relative mb-4 shrink-0">
      <CliEntry />
      <button
        onClick={() => { try { localStorage.setItem('settings-cli-banner', '0') } catch {} ; setHidden(true) }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full grid place-items-center border"
        style={{ background: c.bgElevated || c.surfaceCard, borderColor: c.border, color: c.textTertiary }}
        title={t('收起这条提示', 'Dismiss')}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

function CliEntry() {
  const { c, t } = { ...useTheme(), t: (a: string, b?: string) => a }
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [show, setShow] = useState(false)
  const [cliPath, setCliPath] = useState('')
  useEffect(() => {
    fetch('/api/cli/status').then((r) => r.json()).then((r) => { setInstalled(!!r.installed); setCliPath(r.path || '') }).catch(() => {})
  }, [])
  return (
    <div>
      <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium flex items-center gap-1.5" style={{ color: c.text }}>
            <span className="font-mono">jtcode</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono" style={{ background: installed ? 'rgba(52,211,153,0.15)' : c.bgCard, color: installed ? '#10b981' : c.textTertiary }}>
              {installed === null ? '…' : installed ? '已安装' : '未安装'}
            </span>
          </div>
          <div className="text-[10.5px] mt-0.5 truncate" style={{ color: c.textTertiary }} title={cliPath}>
            {installed ? cliPath : '在终端输入 jtcode 直接与 AI 对话'}
          </div>
        </div>
        <button onClick={() => setShow(true)}
          className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-medium"
          style={{ background: c.accent, color: c.accentText }}>
          {installed ? '管理' : '安装'}
        </button>
      </div>
      {show && <CliInstallModal onClose={() => { setShow(false); fetch('/api/cli/status').then((r) => r.json()).then((r) => setInstalled(!!r.installed)).catch(() => {}) }} />}
    </div>
  )
}
