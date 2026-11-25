import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import { LanguageProvider } from './hooks/useLanguage'
import './index.css'
// 液态玻璃主题层（v18.5.0）：全局可开关，覆盖所有标签页的按钮/输入/卡片
import './assets/liquid-glass.css'
import './types'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
)
