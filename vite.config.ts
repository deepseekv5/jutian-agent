import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * ly-next 架构 — 前端构建配置
 * 单一后端：serve.cjs（端口 3211）。开发时 /api 全部代理到后端，前端不再内嵌任何服务逻辑。
 */
export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['bore.pub', '.trycloudflare.com', '.localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:3211',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // 大依赖分块，改善首屏加载
        // 注意：只对【静态依赖】做 manualChunks。pptxgenjs 已是动态 import，
        // 若强行分组会把它和 rollup 的 preload 助手挤进同一 chunk，
        // 导致主 chunk 启动时被静态拖走（首屏白下 365KB）。
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-highlight'],
          'vendor-codemirror': [
            '@codemirror/state', '@codemirror/view', '@codemirror/commands',
            '@codemirror/search', '@codemirror/autocomplete', '@codemirror/language',
          ],
        },
      },
    },
  },
})
