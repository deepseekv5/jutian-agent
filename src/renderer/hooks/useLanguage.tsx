import { createContext, useContext, useState, useEffect } from 'react';

type Language = 'zh' | 'en';

interface LanguageCtx {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (zh: string, en?: string) => string;
}

const LanguageContext = createContext<LanguageCtx>({ lang: 'zh', setLang: () => {}, t: (zh, en) => zh });

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

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem('app-language', l);
  };

  const t = (zh: string, en?: string) => lang === 'zh' ? zh : (en ?? zh);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
