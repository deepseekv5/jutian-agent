import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useSessions } from '../hooks/useSessions';
import { ThemeProvider, useTheme } from '../hooks/useTheme';
import Sidebar from './Sidebar';
import ChatTab from '../chat/ChatTab';
import TabBar, { PAGE_META, SINGLE_INSTANCE, type WorkTab, type PageType } from './TabBar';
import { refreshExts, subscribeExts, extType } from './extensions';
import { registerExtMeta, unregisterExtMeta, getAllExtMetaKeys } from './TabBar';
import ExtPanel from './ExtPanel';
import ExtensionsPanel from '../panels/ExtensionsPanel';
import DshPanel from '../panels/HarnessPanel';
import StatusBar from './StatusBar';
import MobileTabBar from './MobileTabBar';
import RuntimeHints from './RuntimeHints';
import { useViewport, useKeyboardInset } from '../hooks/useViewport';
import { useAndroid } from '../hooks/useAndroid';
import BackgroundLayer from './BackgroundLayer';
import CommandPalette from './CommandPalette';
import PermissionPrompt from './PermissionPrompt';
import CliInstallModal, { shouldShowCliPrompt } from './CliInstallModal';
import ErrorBoundary from './ErrorBoundary';
import ErrorToastHost, { useGlobalErrorListener } from './ErrorToast';
import { sendResearchSeed } from '../engine/researchBridge';
import { loadVisualSettings, resolveWallpaper, DEFAULT_VISUAL, type VisualSettings } from '../store/visual';
import { uid } from '../utils/uid';
import TerminalPanel from '../code/TerminalPanel';
import NewTabPage from './NewTabPage';
import { refreshSkillManifest } from '../engine/skillManifest';

/* ─── 重功能按需加载：首屏只保留对话核心，PPT / 代码 / 通话 / 集群等首次打开时才拉取 ─── */
const FilesTab = lazy(() => import('../panels/FilesTab'));
const SettingsModal = lazy(() => import('../settings/SettingsModal'));
const SkillMarket = lazy(() => import('../panels/SkillMarket'));
const MemoryPanel = lazy(() => import('../panels/MemoryPanel'));
const OutputsPanel = lazy(() => import('../panels/OutputsPanel'));
const ScheduledTasksPanel = lazy(() => import('../panels/ScheduledTasksPanel'));
const WorkflowPanel = lazy(() => import('../panels/WorkflowPanel'));
const BrowserOverlay = lazy(() => import('./BrowserOverlay'));
const CodeView = lazy(() => import('../code/CodeView'));
const VoiceCall = lazy(() => import('../media/VoiceCall'));
const KnowledgeBase = lazy(() => import('../panels/KnowledgeBase'));
const ScreenshotCrop = lazy(() => import('../media/ScreenshotCrop'));
const AboutPage = lazy(() => import('../settings/AboutPage'));
const PPTView = lazy(() => import('../media/PPTView'));
const QQBotTab = lazy(() => import('../panels/QQBotTab'));
const DiaryPanel = lazy(() => import('../panels/DiaryPanel'));
const ResearchPanel = lazy(() => import('../panels/ResearchPanel'));
const TemplatesPanel = lazy(() => import('../panels/TemplatesPanel'));
const SnippetsPanel = lazy(() => import('../panels/SnippetsPanel'));
const UsagePanel = lazy(() => import('../panels/UsagePanel'));
const DiagnosticsPanel = lazy(() => import('../panels/DiagnosticsPanel'));
const ShortcutsPanel = lazy(() => import('../panels/ShortcutsPanel'));
const ExportPanel = lazy(() => import('../panels/ExportPanel'));
const BackupPanel = lazy(() => import('../panels/BackupPanel'));
const TodosPanel = lazy(() => import('../panels/TodosPanel'));
const ComparePanel = lazy(() => import('../panels/ComparePanel'));
const EmployeesPanel = lazy(() => import('../agents/EmployeesPanel'));
const EmployeeChatTab = lazy(() => import('../agents/EmployeeChatTab'));
const GroupChatTab = lazy(() => import('../agents/GroupChatTab'));
const HarnessPanel = lazy(() => import('./HarnessPanel'));
const FreeModelsPanel = lazy(() => import('../panels/FreeModelsPanel'));
const PersonaChatTab = lazy(() => import('../panels/persona/PersonaChatTab'));
const DocsPanel = lazy(() => import('../panels/DocsPanel'));
const LegalPage = lazy(() => import('../legal/LegalPage'));
import LegalGate, { hasLegalConsent } from '../legal/LegalGate';
import StarGate, { shouldShowStarGate } from './StarGate';
const OnboardingTour = lazy(() => import('./OnboardingTour'));
import { shouldShowTour } from './OnboardingTour';
import { effectiveBindings, matchesCombo, parseCombo, detectMac } from '../../shared/shortcuts';
import { isMac as platformIsMac } from '../utils/platform';
import AnnouncementBanner from './AnnouncementBanner';
import FestivalEgg from './FestivalEgg';
import { fetchCompat } from '../api'

/** 标签页加载态：内容区骨架，避免切换时的空白闪烁 */
function TabFallback() {
  return (
    <div className="flex-1 flex flex-col gap-4 p-8 min-h-0" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl animate-pulse" style={{ background: 'var(--glass-hairline, rgba(127,127,127,.18))' }} />
        <div className="h-4 w-32 rounded-full animate-pulse" style={{ background: 'var(--glass-hairline, rgba(127,127,127,.18))' }} />
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--glass-hairline, rgba(127,127,127,.13))', animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}

const TABS_KEY = 'lyclaw_tabs';
const ACTIVE_TAB_KEY = 'lyclaw_active_tab';

// 低性能设备（老款 Intel Mac 等）：降级玻璃模糊与动画，CPU 核数≤4 或内存≤4GB 命中
const _lc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
const _mem = typeof navigator !== 'undefined' && (navigator as any).deviceMemory ? (navigator as any).deviceMemory : 8
if (_lc <= 4 || _mem <= 4) document.documentElement.setAttribute('data-low-power', '1')

function loadPersistedTabs(): WorkTab[] | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const tabs = JSON.parse(raw);
    return Array.isArray(tabs) && tabs.length > 0 ? tabs : null;
  } catch { return null; }
}

function MainApp() {
  const { settings, loaded, saveSettings } = useSettings();
  const { sessions, activeId, setActiveId: setActiveIdRaw, create, remove, updateTitle, setProject, refresh } = useSessions();
  // 记录上次活跃会话（v14.8）：供「启动恢复上次会话」用
  const setActiveId = useCallback((id: string | null) => {
    try { if (id) localStorage.setItem('lyclaw_last_session', id); else localStorage.removeItem('lyclaw_last_session') } catch { /* ignore */ }
    setActiveIdRaw(id)
  }, [setActiveIdRaw]);
  const { c, theme } = useTheme();

  const [tabs, setTabs] = useState<WorkTab[]>(() => loadPersistedTabs() || []);
  const [activeTabId, setActiveTabId] = useState<string>(() => localStorage.getItem(ACTIVE_TAB_KEY) || '');
  // 激活过的标签保持挂载（保留滚动/编辑器/流式状态）；从未激活的不挂载以跳过懒加载
  const [everMounted, setEverMounted] = useState<Set<string>>(() => new Set());
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(new Set());
  const [showBrowserOverlay, setShowBrowserOverlay] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [toolServerOk, setToolServerOk] = useState<boolean | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  // 多端适配（v13.5）：手机侧栏改为抽屉；键盘弹出时把输入区顶上来
  const vp = useViewport();
  const isAndroid = useAndroid();
  const kbInset = useKeyboardInset();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerTouchX = useRef(0);
  // 切到桌面宽度时自动收起抽屉，避免抽屉状态残留导致布局错位
  useEffect(() => { if (!vp.isMobile && mobileNavOpen) setMobileNavOpen(false); }, [vp.isMobile, mobileNavOpen]);
  // 抽屉打开时 Esc 关闭
  useEffect(() => {
    if (!mobileNavOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [mobileNavOpen]);
  // 左滑关闭抽屉（位移超过 60px 判定）
  const onDrawerTouchStart = useCallback((e: React.TouchEvent) => { drawerTouchX.current = e.touches[0]?.clientX ?? 0 }, []);
  const onDrawerTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - drawerTouchX.current
    if (dx < -60) setMobileNavOpen(false)
  }, []);

  const handleStreamingChange = useCallback((sid: string, streaming: boolean) => {
    setStreamingSessionIds(prev => {
      const next = new Set(prev);
      if (streaming) next.add(sid); else next.delete(sid);
      if (next.size === prev.size) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    if (tabs.length > 0) {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
    }
  }, [tabs, activeTabId]);

  // 记录激活过的标签：切走后仍保持挂载（状态不丢），但懒加载 chunk 只在首次激活时下载
  useEffect(() => {
    if (!activeTabId) return;
    setEverMounted(prev => (prev.has(activeTabId) ? prev : new Set(prev).add(activeTabId)));
  }, [activeTabId]);

  // 首帧引导：loaded 落定且尚无任何标签时建一个默认对话（仅此一次，之后靠用户操作增删标签）
  useEffect(() => {
    if (!loaded || tabs.length > 0) return;
    (async () => {
      // 启动恢复上次会话（v14.8 / v14.9 修竞态）：
      // 修复前 sessions 还是 []（异步未返回）就 find，恢复必然失败；
      // 修复前恢复失败时无条件 create()，老用户每次启动都多一个空会话。
      let restoreOk = false
      try {
        const raw = localStorage.getItem('lyclaw_settings')
        const pref = raw ? JSON.parse(raw).restoreLastSession : false
        const lastSid = localStorage.getItem('lyclaw_last_session')
        if (pref && lastSid) {
          // 先确保会话列表已加载（sessions 可能在异步加载中）
          let list = sessions
          if (!list.length) {
            const mod = await import('../store/storage')
            list = await mod.listSessions()
          }
          const found = list.find(x => x.id === lastSid)
          if (found) {
            const tab: WorkTab = { id: uid(), type: 'chat', title: found.title || '新对话', sessionId: lastSid };
            setTabs([tab]);
            setActiveTabId(tab.id);
            setActiveId(lastSid);
            restoreOk = true
          }
        }
      } catch { /* ignore */ }
      if (!restoreOk) {
        // 仅当确实没有任何会话时才 create；有会话时打开最近一条而不是新建
        let list = sessions
        if (!list.length) {
          const mod = await import('../store/storage')
          list = await mod.listSessions()
        }
        const sid = list[0]?.id || (await create()).id;
        const tab: WorkTab = { id: uid(), type: 'chat', title: list[0]?.title || '新对话', sessionId: sid };
        setTabs([tab]);
        setActiveTabId(tab.id);
        if (list[0]?.id) setActiveId(list[0].id)
      }
    })();
    // 一次性引导：补 sessions/tabs.length 会在会话被删空时重复建 Tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 安全设置即时生效：设置页改动直接刷新全局 settings 状态（saveSettings 为 useCallback([]) 稳定引用）
  useEffect(() => {
    const onSettingsUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) saveSettings(detail as typeof settings);
    };
    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, [saveSettings]);

  // 聊天字号 → CSS 变量（消息气泡/正文读取 --chat-font）
  useEffect(() => {
    const map: Record<string, string> = { small: '14.5px', standard: '16px', large: '18px' };
    const size = map[(settings as any).chatFontSize || 'standard'] || '16px';
    document.documentElement.style.setProperty('--chat-font', size);
    try { localStorage.setItem('lyclaw_font_size', (settings as any).chatFontSize || 'standard') } catch { /* ignore */ }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetchCompat('/api/health');
        if (!cancelled) setToolServerOk(res.ok);
      } catch {
        if (!cancelled) setTimeout(check, 2000);
      }
    };
    check();
    return () => { cancelled = true };
  }, []);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onOpenBrowserOverlay) {
      api.onOpenBrowserOverlay((url: string) => { setBrowserUrl(url); setShowBrowserOverlay(true); });
    }
    return () => { if (api?.removeBrowserOverlayListener) api.removeBrowserOverlayListener(); };
  }, []);

  // 性能（v14.9）：稳定引用——此前每次 App 渲染都换新函数，击穿所有 MessageBubble 的 memo
  const handleOpenBrowser = useCallback((url: string) => { setBrowserUrl(url); setShowBrowserOverlay(true); }, []);

  const openTab = useCallback((type: PageType, opts?: { sessionId?: string; title?: string; refId?: string; iconPath?: string }) => {
    if (opts?.sessionId) {
      const existing = tabs.find(t => t.type === 'chat' && t.sessionId === opts.sessionId);
      if (existing) { setActiveTabId(existing.id); return; }
    }
    // 员工/群组标签：同一个对象只开一个标签页，重复点击时聚焦已开的那个
    if ((type === 'employee' || type === 'group') && opts?.refId) {
      const existing = tabs.find(t => t.type === type && t.refId === opts.refId);
      if (existing) { setActiveTabId(existing.id); return; }
    }
    if (SINGLE_INSTANCE.includes(type)) {
      const existing = tabs.find(t => t.type === type);
      if (existing) { setActiveTabId(existing.id); return; }
    }
    const tab: WorkTab = { id: uid(), type, title: opts?.title || PAGE_META[type]?.label || String(type), sessionId: opts?.sessionId, refId: opts?.refId, iconPath: opts?.iconPath };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [tabs]);

  // LY HARNESS 插件面板的跳转请求
  useEffect(() => {
    const h = (e: Event) => openTab((e as CustomEvent).detail?.page || 'skills')
    window.addEventListener('open-skills-market', h)
    window.addEventListener('open-harness', h)
    return () => { window.removeEventListener('open-skills-market', h); window.removeEventListener('open-harness', h) }
  }, [openTab])

  // v12.3：1024 彩蛋（输入框 /1024 或命令面板触发）
  const [festivalEgg, setFestivalEgg] = useState(false)
  useEffect(() => {
    const h = () => setFestivalEgg(true)
    window.addEventListener('open-festival-egg', h)
    return () => window.removeEventListener('open-festival-egg', h)
  }, [])

  // v12.1：输入框的 /导出 、/用量 等命令 → 打开对应面板标签
  useEffect(() => {
    const h = (e: Event) => {
      const type = String((e as CustomEvent).detail || '')
      if (type) openTab(type as PageType)
    }
    window.addEventListener('open-panel', h)
    // 会话克隆（v14.8）：右键菜单克隆后刷新列表并直接打开副本
    const onCloned = (e: Event) => {
      const newId = String((e as CustomEvent).detail || '')
      if (!newId) return
      refresh().then(() => {
        setActiveId(newId)
        openTab('chat', { title: '会话副本', sessionId: newId })
      }).catch(() => {})
    }
    window.addEventListener('session-cloned', onCloned)
    return () => {
      window.removeEventListener('open-panel', h)
      window.removeEventListener('session-cloned', onCloned)
    }
  }, [openTab])

  // v11.0.3：打开「用户协议与隐私政策」页（关于页入口派发）
  useEffect(() => {
    const h = () => openTab('legal')
    window.addEventListener('open-legal', h)
    return () => window.removeEventListener('open-legal', h)
  }, [openTab])

  // UXL（v14.11）：启动拉已批准扩展 → 注册成动态页面；变更时刷新注册表。
  // 扩展落在 ~/.lyclaw/extensions/，asar 更新不动；apiVersion 不符服务端已排除。
  useEffect(() => {
    const sync = async () => {
      const list = await refreshExts()
      const live = new Set(list.map(x => extType(x.id)))
      // 清掉不再活跃的注册项
      getAllExtMetaKeys().forEach(k => { if (!live.has(k)) unregisterExtMeta(k) })
      for (const x of list) registerExtMeta(extType(x.id), x.name, x.icon)
    }
    sync()
    const off = subscribeExts(sync)
    window.addEventListener('extensions-changed', sync)
    // AI 在同会话里用 create_extension 生成后服务端无法直推渲染层，
    // 30s 轮询兜底（同会话内也能感知新扩展；成本低，仅一个 GET）
    const iv = setInterval(sync, 30_000)
    return () => { off(); clearInterval(iv); window.removeEventListener('extensions-changed', sync) }
  }, [])

  // v10.0：启动即拉取已安装技能清单（系统提示词据此提示模型按需 load_skill）
  useEffect(() => {
    refreshSkillManifest()
    const onChanged = () => refreshSkillManifest()
    window.addEventListener('skills-changed', onChanged)
    window.addEventListener('focus', onChanged)
    return () => { window.removeEventListener('skills-changed', onChanged); window.removeEventListener('focus', onChanged) }
  }, [])

  // 关闭的标签栈（v14.8）：Cmd+Shift+T 重新打开
  const closedTabStack = useRef<WorkTab[]>([]);
  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    closedTabStack.current.push(tabs[idx]);
    if (closedTabStack.current.length > 20) closedTabStack.current.shift();
    const next = tabs.filter(t => t.id !== id);
    if (next.length === 0) {
      (async () => {
        const sid = sessions[0]?.id || (await create()).id;
        const tab: WorkTab = { id: uid(), type: 'chat', title: '新对话', sessionId: sid };
        setTabs([tab]);
        setActiveTabId(tab.id);
      })();
      return;
    }
    setTabs(next);
    if (id === activeTabId) {
      const neighbor = next[Math.min(idx, next.length - 1)];
      setActiveTabId(neighbor.id);
    }
}, [tabs, activeTabId, sessions, create]);

  // 桌宠电话按钮 → 打开通话模式
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onStartCall) return;
    const off = api.onStartCall(() => openTab('call'));
    return off;
  }, [openTab]);

  // 全局截图 → 打开框选浮层
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onScreenshot) return;
    const off = api.onScreenshot((dataUrl: string) => { if (dataUrl) setPendingScreenshot(dataUrl); });
    return off;
  }, []);

  // 界面内截图按钮 → 打开框选浮层
  useEffect(() => {
    const h = (e: Event) => setPendingScreenshot((e as CustomEvent).detail);
    window.addEventListener('open-screenshot-crop', h);
    return () => window.removeEventListener('open-screenshot-crop', h);
  }, []);

  // 首次启动强制同意门：同意后置 true 移除 gate（localStorage 版本化，协议更新会重新征求）
  const [legalOk, setLegalOk] = useState(hasLegalConsent)
  // 求星门（v14.11.3）：法务同意后 + 未点过「不再提示」时显示；
  // 延迟 2.5s 让主界面先渲染完（LegalGate 关闭瞬间连弹两个全屏太压迫）
  const [starGate, setStarGate] = useState(false)
  // 新手引导（v14.15.0）：首次启动自动出现（在求星之后），About 页可重看
  const [tour, setTour] = useState(false)
  useEffect(() => {
    if (legalOk && !starGate) {
      const t = setTimeout(() => { if (shouldShowTour()) setTour(true) }, 2600)
      return () => clearTimeout(t)
    }
  }, [legalOk, starGate])
  useEffect(() => {
    const h = () => setTour(true)
    window.addEventListener('jutian-tour', h)
    return () => window.removeEventListener('jutian-tour', h)
  }, [])
  // 焦点模式（v14.17.0）：隐藏标签栏/状态栏，只留对话——命令面板或 Ctrl+Shift+F 触发，Esc 退出
  const [immersive, setImmersive] = useState(false)
  useEffect(() => {
    const h = () => setImmersive(v => !v)
    window.addEventListener('jutian-immersive', h)
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && immersive) setImmersive(false)
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); setImmersive(v => !v) }
    }
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('jutian-immersive', h); window.removeEventListener('keydown', k) }
  }, [immersive])
  useEffect(() => { if (immersive) setSidebarCollapsed(true) }, [immersive])
  // 收藏直达（v14.16.0）：打开会话标签 → 跳转高亮原消息
  useEffect(() => {
    const h = (e: Event) => {
      const f = (e as CustomEvent).detail || {}
      if (!f.sessionId || !f.msgId) return
      openTab('chat', { sessionId: f.sessionId })
      setTimeout(() => window.dispatchEvent(new CustomEvent('chat-jump-to-message', { detail: f.msgId })), 450)
    }
    window.addEventListener('jutian-open-favorite', h)
    return () => window.removeEventListener('jutian-open-favorite', h)
  }, [openTab])
  useEffect(() => {
    const h = () => openTab('tasks')
    window.addEventListener('jutian-open-tab-tasks', h)
    return () => window.removeEventListener('jutian-open-tab-tasks', h)
  }, [openTab])
  useEffect(() => {
    const h = () => { handleCreateSessionRef.current?.(); setTimeout(() => { window.dispatchEvent(new CustomEvent('jutian-gongwen-on')) }, 300) }
    window.addEventListener('jutian-gongwen-new', h)
    return () => window.removeEventListener('jutian-gongwen-new', h)
  }, [])
  useEffect(() => {
    if (!legalOk) return
    const t = setTimeout(() => setStarGate(shouldShowStarGate()), 2500)
    return () => clearTimeout(t)
  }, [legalOk])
  // 求星门（v14.11.3）：首次启动强制显示，可稍后/永不再提示
  const [cliPrompt, setCliPrompt] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
            try {
        // 延后 8 秒：让用户先看到界面，别一进来就被弹窗盖脸
        await new Promise(r => setTimeout(r, 20000));
        if (!shouldShowCliPrompt()) return;
        const r = await fetchCompat('/api/cli/status').then((x) => x.json());
        if (r && r.installed === false) setCliPrompt(true);
      } catch { /* 服务未就绪则不弹 */ }
    }, 3600);
    return () => clearTimeout(t);
  }, []);

  // 代码块「在 Code 打开」（v14.9.2）：把片段写进工作区 .jutian-snippets/ 后打开 Code 标签
  useEffect(() => {
    const h = async (e: Event) => {
      try {
        const { content, lang } = (e as CustomEvent).detail as { content: string; lang?: string }
        if (!content?.trim()) return
        const extMap: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', shell: 'sh', bash: 'sh', html: 'html', css: 'css', json: 'json', markdown: 'md', sql: 'sql', yaml: 'yml' }
        const ext = extMap[String(lang || '').toLowerCase()] || (String(lang || 'text').slice(0, 4) || 'txt')
        const name = 'snippet-' + Date.now().toString(36) + '.' + ext
        const wd = JSON.parse(localStorage.getItem('lyclaw_settings') || '{}').workDir || ''
        const path = (wd ? wd.replace(/\/$/, '') : '') + '/.jutian-snippets/' + name
        const r = await fetchCompat('/api/code/write-file', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        openTabRef.current('code')
        // CodeView 挂载后监听此事件打开文件
        setTimeout(() => window.dispatchEvent(new CustomEvent('code-open-file', { detail: { path, name } })), 600)
      } catch (err) {
        window.dispatchEvent(new CustomEvent('chat-error-toast', { detail: '在 Code 打开失败：' + String((err as Error)?.message || err) }))
      }
    }
    window.addEventListener('open-in-code', h)
    return () => window.removeEventListener('open-in-code', h)
  }, [])

  // 应用内剪贴板历史（v14.9）：copy 事件记录 + Cmd+Shift+B 通知输入框开面板
  useEffect(() => {
    const onCopy = () => {
      try {
        const sel = String(window.getSelection?.() || '')
        if (sel.trim()) {
          void import('../utils/clipboardHistory').then(m => m.recordClip(sel, 'manual'))
        }
      } catch { /* ignore */ }
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  // 全局命令面板（Cmd/Ctrl+K）+ 标签页快捷键（Cmd+N 新建对话 / Cmd+T 新标签页 / Cmd+W 关闭标签）
  const [cmdOpen, setCmdOpen] = useState(false);
  const openTabRef = useRef(openTab);
  const closeTabRef = useRef<(id: string) => void>(() => {});
  const activeTabRef = useRef<string>('');
  const activeSessionIdRef = useRef<string | null>(null);
  const tabsOrderRef = useRef<WorkTab[]>([]);
  const switchTabRef = useRef<((id: string) => void) | null>(null);
  const reopenClosedTabRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // ? 打开快捷键一览（输入框/可编辑区内不抢）
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        openTabRef.current('shortcuts');
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // 快捷键自定义（v14.20.0）：按生效键位表匹配（用户可在快捷键页改键）
      const __binds = effectiveBindings();
      const hit = (id: string) => {
        const b = __binds.find(x => x.id === id);
        if (!b) return false;
        const pc = parseCombo(b.combo);
        return pc ? matchesCombo(e, pc, detectMac()) : false;
      };
      // 复制最后一条 AI 回复（v14.8）：从当前会话消息里取最后一条 assistant 正文
      if (hit('copy-last-reply')) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        (async () => {
          try {
            const sid = activeSessionIdRef.current
            if (!sid) return
            const msgs = await (await import('../store/storage')).listMessages(sid)
            const last = [...msgs].reverse().find(m => m.role === 'assistant' && (m.content || '').trim())
            if (last) {
              await navigator.clipboard.writeText(last.content)
              window.dispatchEvent(new CustomEvent('chat-error-toast', { detail: '已复制最后一条回复' }))
            }
          } catch { /* 静默 */ }
        })()
        return
      }
      if (hit('open-export')) { e.preventDefault(); openTabRef.current('export'); return }
      // 剪贴板历史面板（v14.9）
      if (hit('clip-history')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-clip-history'))
        return
      }
      // 朗读最后回复（v14.8）
      if (hit('open-diagnostics')) { e.preventDefault(); openTabRef.current('diagnostics'); return }
      if (hit('read-aloud-last')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('read-aloud-last'))
        return
      }
      // Ctrl/Cmd+Tab：循环切换标签（v14.8）
      if (k === 'tab') {
        const dir = e.shiftKey ? -1 : 1;
        if (!hit(dir === -1 ? 'prev-tab' : 'next-tab')) return;
        e.preventDefault();
        const order = tabsOrderRef.current;
        if (order.length > 1) {
          const cur = order.findIndex(t => t.id === activeTabRef.current);
          const nextTab = order[(cur + dir + order.length) % order.length];
          if (nextTab) switchTabRef.current?.(nextTab.id)
        }
        return
      }
      // Cmd+Shift+T：重新打开刚关闭的标签（v14.8）
      if (hit('reopen-tab')) {
        e.preventDefault();
        reopenClosedTabRef.current?.()
        return
      }
      // Cmd+加/减/0 快速调节聊天字号（v14.8）
      if (hit('font-up') || hit('font-down') || hit('font-reset')) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        const sizes = ['small', 'standard', 'large'] as const;
        const cur = sizes.indexOf((localStorage.getItem('lyclaw_font_size') as typeof sizes[number]) || 'standard');
        let next = cur;
        if (hit('font-up')) next = Math.min(sizes.length - 1, cur + 1);
        else if (hit('font-down')) next = Math.max(0, cur - 1);
        else next = 1;
        if (next !== cur) {
          localStorage.setItem('lyclaw_font_size', sizes[next]);
          window.dispatchEvent(new CustomEvent('settings-updated', { detail: { ...(JSON.parse(localStorage.getItem('lyclaw_settings') || '{}')), chatFontSize: sizes[next] } }))
        }
        return
      }
      if (hit('palette')) { e.preventDefault(); setCmdOpen(v => !v) }
      else if (hit('new-chat')) { e.preventDefault(); handleCreateSessionRef.current?.() }
      else if (hit('new-tab')) { e.preventDefault(); openTabRef.current('newtab') }
      else if (hit('close-tab')) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return; // 输入框内留给系统关闭行为
        e.preventDefault();
        const active = activeTabRef.current;
        if (active) closeTabRef.current(active);
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, []);
  openTabRef.current = openTab;
  closeTabRef.current = closeTab;

  // 托盘「新建对话」→ 创建会话并打开
  const handleCreateSessionRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onTrayNewChat) return;
    const off = api.onTrayNewChat(() => { handleCreateSessionRef.current?.() });
    // 托盘快捷入口（v14.8）：通话 / 调研 / 截图提问
    const offTrayOpen = api.onTrayOpen?.((page: string) => {
      if (page === 'call' || page === 'research') openTabRef.current(page as never)
    });
    return () => { off(); if (offTrayOpen) offTrayOpen() };
  }, []);

  const handleSelectSession = useCallback((sid: string) => {
    setActiveId(sid);
    const session = sessions.find(s => s.id === sid);
    openTab('chat', { sessionId: sid, title: typeof session?.title === 'string' ? session.title.slice(0, 12) || '对话' : '对话' });
  }, [sessions, openTab, setActiveId]);

  // 全局搜索命中某条消息：打开会话 → 轮询等消息渲染出来 → 滚动定位并高亮
  // （标签页是懒挂载的，事件必须在目标 ChatView 就绪后派发，否则一次性事件会错过）
  const handleJumpToMessage = useCallback((sid: string, messageId: string) => {
    handleSelectSession(sid);
    let tries = 0;
    const fire = () => {
      // 只认可见标签里的消息（隐藏的旧标签不触发）
      const el = Array.from(document.querySelectorAll(`[data-msg-id="${messageId}"]`)).find(e => (e as HTMLElement).offsetParent !== null);
      if (el) { window.dispatchEvent(new CustomEvent('chat-jump-to-message', { detail: messageId })); return; }
      if (++tries < 30) setTimeout(fire, 120);   // 最多等 ~3.6s
    };
    setTimeout(fire, 280);
  }, [handleSelectSession]);

  // 新标签页全局搜索：打开会话 / 跳转消息（v14.11）
  useEffect(() => {
    const onSession = (e: Event) => {
      const sid = String((e as CustomEvent).detail?.sessionId || '')
      if (sid) handleSelectSession(sid)
    }
    const onMessage = (e: Event) => {
      const d = (e as CustomEvent).detail || {}
      if (d.sessionId && d.messageId) handleJumpToMessage(String(d.sessionId), String(d.messageId))
    }
    window.addEventListener('newtab-open-session', onSession)
    window.addEventListener('newtab-open-message', onMessage)
    return () => {
      window.removeEventListener('newtab-open-session', onSession)
      window.removeEventListener('newtab-open-message', onMessage)
    }
  }, [handleSelectSession, handleJumpToMessage])

  // 极简首页输入框：新建会话 → 挂载后把草稿填进 composer（不自动发送，用户可再改）
  useEffect(() => {
    const h = (e: Event) => {
      const text = String((e as CustomEvent).detail || '')
      if (!text) return
      handleCreateSessionRef.current?.()
      let tries = 0
      const fill = () => {
        const el = document.querySelector('textarea[data-composer="main"]') || document.querySelector('textarea')
        if (el || ++tries >= 20) window.dispatchEvent(new CustomEvent('followup-fill', { detail: text }))
        else setTimeout(fill, 80)
      }
      setTimeout(fill, 300)
    }
    window.addEventListener('jutian-minimal-ask', h)
    return () => window.removeEventListener('jutian-minimal-ask', h)
  }, [])

  const handleCreateSession = useCallback(async () => {
    // 新会话直接带上当前工作目录作为项目分组标签
    const s = await create(undefined, settings.workDir || '');
    openTab('chat', { sessionId: s.id, title: '新对话' });
  }, [create, openTab, settings.workDir]);
  handleCreateSessionRef.current = handleCreateSession;

  // 新标签页选择功能入口：对话需先建会话（openTab('chat') 无 sessionId 渲染为空）
  const handleNewTabPick = useCallback(async (type: PageType) => {
    if (type === 'newtab') return;
    if (type === 'chat') { await handleCreateSession(); setTabs(prev => prev.filter(t => t.type !== 'newtab')); return }
    openTab(type);
    setTabs(prev => prev.filter(t => t.type !== 'newtab'));
  }, [openTab, setTabs, handleCreateSession]);

  const handleDeleteSession = useCallback(async (sid: string) => {
    tabs.filter(t => t.sessionId === sid).forEach(t => closeTab(t.id));
    await remove(sid);
  }, [tabs, closeTab, remove]);

  const handleTitleGenerated = useCallback((sid: string, firstMsg: string) => {
    const safeMsg = String(firstMsg || '');
    const title = safeMsg.length > 20 ? safeMsg.slice(0, 20) + '...' : safeMsg;
    updateTitle(sid, title);
    setTabs(prev => prev.map(t => t.sessionId === sid && t.type === 'chat' ? { ...t, title: title.slice(0, 12) || '对话' } : t));
  }, [updateTitle]);

  const handleAiTitle = useCallback((sid: string, title: string) => {
    updateTitle(sid, title);
    setTabs(prev => prev.map(t => t.sessionId === sid && t.type === 'chat' ? { ...t, title: title.slice(0, 12) || '对话' } : t));
  }, [updateTitle]);

  // ChatTab props 稳定化（v14.11.5）：配合 memo(ChatTab)，任一标签开始/结束流式时
  // 不再把所有已挂载会话的 ChatView+MessageInput 拖着重渲染
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const handleOpenResearch = useCallback((seed?: string) => { if (seed) sendResearchSeed(seed); openTab('research') }, [openTab]);
  const handleModelChange = useCallback((m: string) => { saveSettings({ ...settingsRef.current, model: m }) }, [saveSettings]);
  const handleScreenshotConsumed = useCallback(() => setPendingScreenshot(null), []);

  // 视觉设置实时读取（设置页改动即时生效，含默认动态视频壁纸）。
  // 默认值与回落规则统一走 store/visual，避免这里与设置页各写一份导致漂移
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(loadVisualSettings)
  useEffect(() => {
    const h = () => setVisualSettings(loadVisualSettings())
    window.addEventListener('visual-changed', h)
    return () => window.removeEventListener('visual-changed', h)
  }, [])
  const bgImage: string = resolveWallpaper(visualSettings.bgImage)
  // 毛玻璃依赖壁纸折射：无壁纸时通知 CSS 关闭 backdrop-filter（退化为纯净底色）
  useEffect(() => {
    document.documentElement.setAttribute('data-wallpaper', bgImage ? 'on' : 'off')
  }, [bgImage])
  const bgOpacity = Math.max(0, Math.min(1, theme === 'dark'
    ? (visualSettings.bgOpacityDark ?? DEFAULT_VISUAL.bgOpacityDark)
    : (visualSettings.bgOpacityLight ?? DEFAULT_VISUAL.bgOpacityLight)))

  // 氛围模式（顶栏「氛围」按钮开关；Esc 退出）
  const [ambient, setAmbient] = useState(() => localStorage.getItem('lyclaw_ambient') === '1')
  useEffect(() => {
    const h = () => setAmbient(localStorage.getItem('lyclaw_ambient') === '1')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && localStorage.getItem('lyclaw_ambient') === '1') { try { localStorage.setItem('lyclaw_ambient', '0') } catch {} ; h() } }
    window.addEventListener('ambient-changed', h)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('ambient-changed', h); window.removeEventListener('keydown', esc) }
  }, [])

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  activeTabRef.current = activeTab?.id || '';
  activeSessionIdRef.current = activeTab?.sessionId || activeId || null;
  tabsOrderRef.current = tabs;
  switchTabRef.current = (id: string) => { setActiveTabId(id); try { localStorage.setItem(ACTIVE_TAB_KEY, id) } catch { /* ignore */ } };
  reopenClosedTabRef.current = () => {
    const last = closedTabStack.current.pop();
    if (!last) return;
    setTabs(prev => [...prev, last]);
    switchTabRef.current?.(last.id);
  };

  const renderTabBody = (tab: WorkTab) => {
    switch (tab.type) {
      case 'chat':
        return tab.sessionId ? (
          <ChatTab key={tab.id} sessionId={tab.sessionId} settings={settings} onTitleGenerated={handleTitleGenerated} onAiTitle={handleAiTitle} onOpenBrowser={handleOpenBrowser} onOpenResearch={handleOpenResearch} onStreamingChange={handleStreamingChange} onModelChange={handleModelChange} onProjectChange={setProject} active={tab.id === activeTabId} incomingScreenshot={pendingScreenshot} onScreenshotConsumed={handleScreenshotConsumed} />
        ) : null;
      case 'call':
        return <VoiceCall settings={settings} onClose={() => closeTab(tab.id)} />;
      case 'kb':
        return <KnowledgeBase onClose={() => closeTab(tab.id)} />;
      case 'diary':
        return <DiaryPanel onClose={() => closeTab(tab.id)} />;
      case 'plugins':
        return <HarnessPanel onClose={() => closeTab(tab.id)} />;
      case 'freemodels':
        return <FreeModelsPanel settings={settings} onSettingsChange={s => saveSettings(s)} />;
      case 'docs':
        return <DocsPanel onClose={() => closeTab(tab.id)} />;
      case 'persona':
        return <PersonaChatTab settings={settings} onClose={() => closeTab(tab.id)} />;
      case 'employees':
        return <EmployeesPanel onClose={() => closeTab(tab.id)} onOpenTab={openTab} />;
      case 'employee':
        return tab.refId ? <EmployeeChatTab key={tab.id} empId={tab.refId} settings={settings} onClose={() => closeTab(tab.id)} /> : null;
      case 'group':
        return tab.refId ? <GroupChatTab key={tab.id} groupId={tab.refId} settings={settings} onClose={() => closeTab(tab.id)} /> : null;
      case 'newtab':
        return <NewTabPage onPick={handleNewTabPick} sessions={sessions} />;
      case 'files':
        return <FilesTab settings={settings} />;
      case 'terminal':
        return (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TerminalPanel cwd={settings.workDir || undefined as any} />
          </div>
        );
      case 'ppt':
        return <PPTView onBack={() => closeTab(tab.id)} />;
      case 'outputs':
        return <OutputsPanel embedded onClose={() => closeTab(tab.id)} />;
      case 'skills':
        return <SkillMarket embedded onClose={() => closeTab(tab.id)} />;
      case 'code':
        return <CodeView settings={settings} onBack={() => closeTab(tab.id)} />;
      case 'memory':
        return <MemoryPanel embedded onClose={() => closeTab(tab.id)} />;
      case 'tasks':
        return <ScheduledTasksPanel embedded onClose={() => closeTab(tab.id)} />;
      case 'workflow':
        return <WorkflowPanel onClose={() => closeTab(tab.id)} />;
      case 'qqbot':
        return <QQBotTab />;
      case 'settings':
        return <SettingsModal embedded settings={settings} onSave={s => saveSettings({ ...s })} onClose={() => closeTab(tab.id)} onOpenFreeModels={() => openTab('freemodels')} />;
      case 'legal':
        return <LegalPage onClose={() => closeTab(tab.id)} />;
      case 'research':
        return <ResearchPanel onClose={() => closeTab(tab.id)} />;
      case 'templates':
        return <TemplatesPanel onClose={() => closeTab(tab.id)} />;
      case 'snippets':
        return <SnippetsPanel onClose={() => closeTab(tab.id)} />;
      case 'usage':
        return <UsagePanel onClose={() => closeTab(tab.id)} />;
      case 'diagnostics':
        return <DiagnosticsPanel onClose={() => closeTab(tab.id)} />;
      case 'shortcuts':
        return <ShortcutsPanel onClose={() => closeTab(tab.id)} />;
      case 'export':
        return <ExportPanel sessions={sessions} loadMessages={async (sid) => (await import('../store/storage')).listMessages(sid)} onClose={() => closeTab(tab.id)} />;
      case 'backup':
        return <BackupPanel onClose={() => closeTab(tab.id)} />;
      case 'todos':
        return <TodosPanel onClose={() => closeTab(tab.id)} />;
      case 'compare':
        return <ComparePanel settings={settings} onClose={() => closeTab(tab.id)} />;
      case 'about':
        return <AboutPage embedded onClose={() => closeTab(tab.id)} />;
      case 'extensions':
        return <ExtensionsPanel />;
      case 'harness':
        return <DshPanel />;
      default:
        // UXL 动态扩展：ext:<id> → ExtPanel（iframe 沙箱）
        if (String(tab.type).startsWith('ext:')) return <ExtPanel type={String(tab.type)} />;
        return null;
    }
  };

  const mainAreaStyle = { position: 'relative' as const, zIndex: 1, ['--kb-inset' as string]: `${kbInset}px` } as React.CSSProperties;
  return (
    <div className="h-screen overflow-hidden flex relative jt-compact">
      <BackgroundLayer bgImage={bgImage} opacity={bgOpacity} />
      {bgImage && <div className="global-veil" aria-hidden />}
      {/* 氛围模式：全屏氛围光晕（顶栏「氛围」按钮开关，Esc 退出） */}
      {ambient && <div className="ambient-veil" aria-hidden />}

      {/* Sidebar：桌面常驻（可折叠），手机为抽屉 */}
      {vp.isMobile && mobileNavOpen && (
        <div className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}
      <div
        onTouchStart={vp.isMobile ? onDrawerTouchStart : undefined}
        onTouchEnd={vp.isMobile ? onDrawerTouchEnd : undefined}
        className={vp.isMobile ? `sidebar-shell${mobileNavOpen ? ' is-open' : ''}` : `jt-in-left duration-300 overflow-hidden shrink-0 transition-[width,min-width] ease-[cubic-bezier(0.32,0.72,0,1)]`}
        style={vp.isMobile
          ? { background: 'var(--glass-bg, #fff)' }
          : { width: sidebarCollapsed ? 0 : 280, minWidth: sidebarCollapsed ? 0 : 280, position: 'relative', zIndex: 1 }}>
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          workingIds={streamingSessionIds}
          onSelect={(sid) => { handleSelectSession(sid); setMobileNavOpen(false) }}
          onCreate={() => { handleCreateSession(); setMobileNavOpen(false) }}
          onDelete={handleDeleteSession}
          onOpenTab={(t) => { openTab(t); setMobileNavOpen(false) }}
          onCollapse={() => { setSidebarCollapsed(true); setMobileNavOpen(false) }}
          onJumpToMessage={handleJumpToMessage}
        />
      </div>

      {/* Sidebar toggle（仅桌面：手机用 TabBar 里的菜单按钮） */}
      {sidebarCollapsed && !vp.isMobile && (
        <div className="absolute top-2 z-30 titlebar-nodrag" style={{ left: platformIsMac() ? 84 : 8 }}>
          <button onClick={() => setSidebarCollapsed(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: c.textTertiary }}
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            title="展开侧边栏">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      )}

      {/* Main content: TabBar + tabs */}
      <div className="jt-in-fade jt-d1 flex-1 flex flex-col min-w-0 h-screen overflow-hidden" style={mainAreaStyle}>
        {!immersive && <TabBar
          tabs={tabs}
          activeTabId={activeTab?.id || ''}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onOpenType={(type) => openTab(type)}
          toolServerOk={toolServerOk}
          onOpenSettings={() => openTab('settings')}
          onOpenWorkDir={() => fetchCompat(`/api/sessions/${activeId || ''}/folder`).catch(() => {})}
          workingSessionIds={streamingSessionIds}
          isMobile={vp.isMobile}
          onToggleSidebar={() => setMobileNavOpen(v => !v)}
        />}
        {/* 应用公告横幅（v11.7）：进应用自动读取 GitHub docs/notice.md；关同条不再打扰 */}
        <AnnouncementBanner />
        {isAndroid && (
          <div className="px-4 py-3 text-center" style={{ background: '#7f1d1d', color: '#fecaca' }}>
            <div style={{ font: '700 15px/1.4 -apple-system,sans-serif', color: '#fca5a5' }}>
              安卓版仍在开发中
            </div>
            <div style={{ font: '400 12px/1.5 -apple-system,sans-serif', color: '#fecaca99', marginTop: 4 }}>
              语音、部分工具、快捷键等功能尚不可用。建议优先使用桌面端。
            </div>
          </div>
        )}
        {tabs.map(tab => {
          const isActive = tab.id === activeTab?.id;
          // 从未激活过的标签不挂载：其懒加载 chunk 不会下载，首屏只加载对话核心
          if (!isActive && !everMounted.has(tab.id)) return null;
          return (
            <div key={tab.id} className={`flex-1 flex flex-col min-h-0 overflow-hidden ${isActive ? '' : 'hidden'}`} style={{ display: isActive ? 'flex' : 'none' }}>
              {/* 每个标签页独立错误边界：单个面板崩溃只坏这个标签，
                  侧栏、标签栏和其他标签页照常可用，不会整 App 白屏。
                  resetKey 带上 sessionId/refId：在同一标签内换对话也能自动恢复 */}
              <ErrorBoundary inline resetKey={`${tab.id}:${tab.sessionId || tab.refId || ''}`} label="这个标签页加载出错了">
                <Suspense fallback={<TabFallback />}>{renderTabBody(tab)}</Suspense>
              </ErrorBoundary>
            </div>
          );
        })}

        {showBrowserOverlay && <BrowserOverlay initialUrl={browserUrl} onClose={() => setShowBrowserOverlay(false)} />}

        {/* 截图框选浮层：裁剪结果派发给当前活跃聊天 */}
        {pendingScreenshot && (
          <ScreenshotCrop
            dataUrl={pendingScreenshot}
            onCancel={() => setPendingScreenshot(null)}
            onConfirm={(cropped) => { window.dispatchEvent(new CustomEvent('attach-screenshot', { detail: cropped })); setPendingScreenshot(null); }}
          />
        )}

        {/* 全局状态栏（桌面）；手机换成底部导航，省高度 */}
        {vp.isMobile
          ? <MobileTabBar activeType={activeTab?.type || null} onPick={(t) => openTab(t)} />
          : (!immersive && <StatusBar serverOk={toolServerOk} model={settings.model} workDir={settings.workDir} />)}
      </div>

      {!legalOk && <LegalGate onAgree={() => setLegalOk(true)} />}

      {legalOk && starGate && <StarGate onClose={() => setStarGate(false)} />}
      {legalOk && tour && <Suspense fallback={null}><OnboardingTour onDone={() => setTour(false)} /></Suspense>}

      {festivalEgg && <FestivalEgg onClose={() => setFestivalEgg(false)} />}

      {/* 断网徽标 + PWA 安装邀请（有事件才出现） */}
      <RuntimeHints />

      {/* jtcode CLI 安装邀请 */}
      {cliPrompt && <CliInstallModal onClose={() => setCliPrompt(false)} />}

      {/* 全局命令面板 Cmd+K */}
      <PermissionPrompt />
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onOpenTab={(t) => openTab(t as any)}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession as () => void}
      />
    </div>
  );
}

export default function App() {
  // 漏网的异步异常（未处理的 Promise 拒绝、运行时错误）接到全局提示，
  // 不再只静静地出现在控制台里
  useGlobalErrorListener()
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MainApp />
        <ErrorToastHost />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
