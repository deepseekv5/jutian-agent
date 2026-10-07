import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useSessions } from '../hooks/useSessions';
import { ThemeProvider, useTheme } from '../hooks/useTheme';
import Sidebar from './Sidebar';
import ChatTab from '../chat/ChatTab';
import TabBar, { PAGE_META, SINGLE_INSTANCE, type WorkTab, type PageType } from './TabBar';
import StatusBar from './StatusBar';
import BackgroundLayer from './BackgroundLayer';
import CommandPalette from './CommandPalette';
import WelcomeSplash from './WelcomeSplash';
import CliInstallModal, { shouldShowCliPrompt } from './CliInstallModal';
import ErrorBoundary from './ErrorBoundary';
import TerminalPanel from '../code/TerminalPanel';
import NewTabPage from './NewTabPage';
import { refreshSkillManifest } from '../engine/skillManifest';
import type { Settings } from '../types';

/* ─── 重功能按需加载：首屏只保留对话核心，PPT / 代码 / 通话 / 集群等首次打开时才拉取 ─── */
const FilesTab = lazy(() => import('../panels/FilesTab'));
const SettingsModal = lazy(() => import('../settings/SettingsModal'));
const SkillMarket = lazy(() => import('../panels/SkillMarket'));
const MemoryPanel = lazy(() => import('../panels/MemoryPanel'));
const OutputsPanel = lazy(() => import('../panels/OutputsPanel'));
const ScheduledTasksPanel = lazy(() => import('../panels/ScheduledTasksPanel'));
const BrowserOverlay = lazy(() => import('./BrowserOverlay'));
const CodeView = lazy(() => import('../code/CodeView'));
const VoiceCall = lazy(() => import('../media/VoiceCall'));
const KnowledgeBase = lazy(() => import('../panels/KnowledgeBase'));
const ScreenshotCrop = lazy(() => import('../media/ScreenshotCrop'));
const AboutPage = lazy(() => import('../settings/AboutPage'));
const PPTView = lazy(() => import('../media/PPTView'));
const QQBotTab = lazy(() => import('../panels/QQBotTab'));
const DiaryPanel = lazy(() => import('../panels/DiaryPanel'));
const EmployeesPanel = lazy(() => import('../agents/EmployeesPanel'));
const EmployeeChatTab = lazy(() => import('../agents/EmployeeChatTab'));
const GroupChatTab = lazy(() => import('../agents/GroupChatTab'));
const HarnessPanel = lazy(() => import('./HarnessPanel'));
const FreeModelsPanel = lazy(() => import('../panels/FreeModelsPanel'));

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

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

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
  const { sessions, activeId, setActiveId, create, remove, updateTitle } = useSessions();
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

  useEffect(() => {
    if (!loaded || tabs.length > 0) return;
    (async () => {
      const sid = sessions[0]?.id || (await create()).id;
      const tab: WorkTab = { id: uid(), type: 'chat', title: sessions[0]?.title || '新对话', sessionId: sid };
      setTabs([tab]);
      setActiveTabId(tab.id);
    })();
  }, [loaded]);

  // 安全设置即时生效：设置页改动直接刷新全局 settings 状态
  useEffect(() => {
    const onSettingsUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) saveSettings(detail as typeof settings);
    };
    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, []);

  // 聊天字号 → CSS 变量（消息气泡/正文读取 --chat-font）
  useEffect(() => {
    const map: Record<string, string> = { small: '14.5px', standard: '16px', large: '18px' };
    const size = map[(settings as any).chatFontSize || 'standard'] || '16px';
    document.documentElement.style.setProperty('--chat-font', size);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
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

  const handleOpenBrowser = (url: string) => { setBrowserUrl(url); setShowBrowserOverlay(true); };

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
    const tab: WorkTab = { id: uid(), type, title: opts?.title || PAGE_META[type].label, sessionId: opts?.sessionId, refId: opts?.refId, iconPath: opts?.iconPath };
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

  // v10.0：启动即拉取已安装技能清单（系统提示词据此提示模型按需 load_skill）
  useEffect(() => {
    refreshSkillManifest()
    const onChanged = () => refreshSkillManifest()
    window.addEventListener('skills-changed', onChanged)
    window.addEventListener('focus', onChanged)
    return () => { window.removeEventListener('skills-changed', onChanged); window.removeEventListener('focus', onChanged) }
  }, [])

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
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

  const handleNewTabPick = useCallback((type: PageType) => {
    if (type === 'newtab') return;
    openTab(type);
    setTabs(prev => prev.filter(t => t.type !== 'newtab'));
  }, [openTab, setTabs]);

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

  // 内测欢迎页（每次启动）+ jtcode 安装邀请（欢迎页结束后、未安装且未选"不再提醒"时弹出）
  const [splashDone, setSplashDone] = useState(false);
  const [cliPrompt, setCliPrompt] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      setSplashDone(true);
      try {
        if (!shouldShowCliPrompt()) return;
        const r = await fetch('/api/cli/status').then((x) => x.json());
        if (r && r.installed === false) setCliPrompt(true);
      } catch { /* 服务未就绪则不弹 */ }
    }, 3600);
    return () => clearTimeout(t);
  }, []);

  // 全局命令面板（Cmd/Ctrl+K）+ 标签页快捷键（Cmd+N 新建对话 / Cmd+T 新标签页 / Cmd+W 关闭标签）
  const [cmdOpen, setCmdOpen] = useState(false);
  const openTabRef = useRef(openTab);
  const closeTabRef = useRef<(id: string) => void>(() => {});
  const activeTabRef = useRef<string>('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setCmdOpen(v => !v) }
      else if (k === 'n') { e.preventDefault(); handleCreateSessionRef.current?.() }
      else if (k === 't') { e.preventDefault(); openTabRef.current('newtab') }
      else if (k === 'w') {
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
    return off;
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

  const handleCreateSession = useCallback(async () => {
    const s = await create();
    openTab('chat', { sessionId: s.id, title: '新对话' });
  }, [create, openTab]);
  handleCreateSessionRef.current = handleCreateSession;

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

  // 视觉设置实时读取（设置页改动即时生效，含默认动态视频壁纸）
  const [visualSettings, setVisualSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('visual-settings') || 'null') || { bgImage: '/bg_upload.mp4', bgOpacityLight: 0.5, bgOpacityDark: 0.6 } } catch { return { bgImage: '/bg_upload.mp4', bgOpacityLight: 0.5, bgOpacityDark: 0.6 } }
  })
  useEffect(() => {
    const h = () => { try { setVisualSettings(JSON.parse(localStorage.getItem('visual-settings') || 'null') || {}) } catch { /* ignore */ } }
    window.addEventListener('visual-changed', h)
    return () => window.removeEventListener('visual-changed', h)
  }, [])
  const _rawBg = (visualSettings as any).bgImage as string | undefined
  // 缺失或旧默认 /bg.jpg 一律回落到内置动态视频壁纸；用户显式设 '' 表示关闭
  const bgImage: string = _rawBg === '' ? '' : (!_rawBg || _rawBg === '/bg.jpg' ? '/bg_upload.mp4' : _rawBg)
  // 毛玻璃依赖壁纸折射：无壁纸时通知 CSS 关闭 backdrop-filter（退化为纯净底色）
  useEffect(() => {
    document.documentElement.setAttribute('data-wallpaper', bgImage ? 'on' : 'off')
  }, [bgImage])
  const bgOpacity = Math.max(0, Math.min(1, theme === 'dark'
    ? ((visualSettings as any).bgOpacityDark ?? 0.6)
    : ((visualSettings as any).bgOpacityLight ?? 0.5)))

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  activeTabRef.current = activeTab?.id || '';

  const renderTabBody = (tab: WorkTab) => {
    switch (tab.type) {
      case 'chat':
        return tab.sessionId ? (
          <ChatTab key={tab.id} sessionId={tab.sessionId} settings={settings} onTitleGenerated={handleTitleGenerated} onAiTitle={handleAiTitle} onOpenBrowser={handleOpenBrowser} onStreamingChange={handleStreamingChange} onModelChange={(m) => saveSettings({ ...settings, model: m })} active={tab.id === activeTabId} onOpenTab={openTab} incomingScreenshot={pendingScreenshot} onScreenshotConsumed={() => setPendingScreenshot(null)} />
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
      case 'employees':
        return <EmployeesPanel onClose={() => closeTab(tab.id)} onOpenTab={openTab} />;
      case 'employee':
        return tab.refId ? <EmployeeChatTab key={tab.id} empId={tab.refId} settings={settings} onClose={() => closeTab(tab.id)} /> : null;
      case 'group':
        return tab.refId ? <GroupChatTab key={tab.id} groupId={tab.refId} settings={settings} onClose={() => closeTab(tab.id)} /> : null;
      case 'newtab':
        return <NewTabPage onPick={handleNewTabPick} />;
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
      case 'qqbot':
        return <QQBotTab />;
      case 'settings':
        return <SettingsModal embedded settings={settings} onSave={s => saveSettings({ ...s })} onClose={() => closeTab(tab.id)} onOpenFreeModels={() => openTab('freemodels')} />;
      case 'about':
        return <AboutPage embedded onClose={() => closeTab(tab.id)} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen overflow-hidden flex relative" style={{ background: bgImage ? "transparent" : "transparent" }}>
      <BackgroundLayer bgImage={bgImage} opacity={bgOpacity} />
      {bgImage && <div className="global-veil" aria-hidden />}

      {/* Sidebar */}
      <div className="transition-all duration-300 overflow-hidden shrink-0" style={{ width: sidebarCollapsed ? 0 : 280, minWidth: sidebarCollapsed ? 0 : 280, position: 'relative', zIndex: 1 }}>
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          workingIds={streamingSessionIds}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onDelete={handleDeleteSession}
          onOpenTab={openTab}
          onCollapse={() => setSidebarCollapsed(true)}
          onJumpToMessage={handleJumpToMessage}
        />
      </div>

      {/* Sidebar toggle */}
      {sidebarCollapsed && (
        <div className="absolute top-2 z-30 titlebar-nodrag" style={{ left: /Mac/i.test(navigator.platform || navigator.userAgent) ? 84 : 8 }}>
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
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden" style={{ position: 'relative', zIndex: 1 }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTab?.id || ''}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onOpenType={(type) => openTab(type)}
          toolServerOk={toolServerOk}
          onOpenSettings={() => openTab('settings')}
          onOpenWorkDir={() => fetch(`/api/sessions/${activeId || ''}/folder`).catch(() => {})}
          workingSessionIds={streamingSessionIds}
        />
        {tabs.map(tab => {
          const isActive = tab.id === activeTab?.id;
          // 从未激活过的标签不挂载：其懒加载 chunk 不会下载，首屏只加载对话核心
          if (!isActive && !everMounted.has(tab.id)) return null;
          return (
            <div key={tab.id} className={`flex-1 flex flex-col min-h-0 overflow-hidden ${isActive ? '' : 'hidden'}`} style={{ display: isActive ? 'flex' : 'none' }}>
              <Suspense fallback={<TabFallback />}>{renderTabBody(tab)}</Suspense>
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

        {/* 全局状态栏 */}
        <StatusBar serverOk={toolServerOk} model={settings.model} workDir={settings.workDir} />
      </div>

      {/* 内测欢迎页（每次启动） */}
      {!splashDone && <WelcomeSplash />}

      {/* jtcode CLI 安装邀请 */}
      {cliPrompt && <CliInstallModal onClose={() => setCliPrompt(false)} />}

      {/* 全局命令面板 Cmd+K */}
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
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MainApp />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
