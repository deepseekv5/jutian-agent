import { createContext, useContext, useState, useCallback, useMemo } from 'react';

type Language = 'zh' | 'en';

interface LanguageCtx {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (zh: string, en?: string) => string;
}

const LanguageContext = createContext<LanguageCtx>({ lang: 'zh', setLang: () => {}, t: (zh) => zh });

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('app-language');
      return saved === 'en' ? 'en' : 'zh';
    } catch { return 'zh'; }
  });

  // 回调与 context value 全部稳定：否则每次 Provider 渲染都产生新对象，
  // 所有用 useLanguage 的组件会被无条件重渲染
  const setLang = useCallback((l: Language) => {
    setLangState(l);
    localStorage.setItem('app-language', l);
  }, []);

  const t = useCallback((zh: string, en?: string) => lang === 'zh' ? zh : (en ?? zh), [lang]);

  const ctxValue = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={ctxValue}>
      {children}
    </LanguageContext.Provider>
  );
}
