import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { translate, type Lang } from '../../shared/i18n';

type Language = Lang;

interface LanguageCtx {
  lang: Language;
  setLang: (lang: Language) => void;
  /** 内联文案：t('中文', 'English') */
  t: (zh: string, en?: string) => string;
  /** 字典文案：tt('nav.chat') / tt('chat.messages', { n: 3 }) */
  tt: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'zh',
  setLang: () => {},
  t: (zh) => zh,
  tt: (key) => key,
});

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('app-language');
      if (saved === 'en' || saved === 'zh') return saved;
      // 首次启动跟随系统语言：英文环境不该先给一屏中文
      const nav = (navigator.language || '').toLowerCase();
      return nav.startsWith('zh') ? 'zh' : 'en';
    } catch { return 'zh'; }
  });

  // <html lang> 同步：影响读屏器发音、字体回退与浏览器翻译提示
  useEffect(() => {
    try { document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'; } catch { /* 测试环境无 document */ }
  }, [lang]);

  // 回调与 context value 全部稳定：否则每次 Provider 渲染都产生新对象，
  // 所有用 useLanguage 的组件会被无条件重渲染
  const setLang = useCallback((l: Language) => {
    setLangState(l);
    try { localStorage.setItem('app-language', l); } catch { /* 隐私模式 */ }
  }, []);

  const t = useCallback((zh: string, en?: string) => lang === 'zh' ? zh : (en ?? zh), [lang]);
  const tt = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const ctxValue = useMemo(() => ({ lang, setLang, t, tt }), [lang, setLang, t, tt]);

  return (
    <LanguageContext.Provider value={ctxValue}>
      {children}
    </LanguageContext.Provider>
  );
}
