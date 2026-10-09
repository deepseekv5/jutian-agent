import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'release/**', 'node_modules/**', 'python-runtime/**',
      'docs/**', 'tools/**', 'archive/**', 'public/**',
      // 构建产物：esbuild 从同名 .ts 生成的 CJS，源文件才是被检查的对象
      'src/shared/*.cjs', 'serve.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ─── 前端（浏览器）───
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 全项目 301 处 any：先关掉噪音，改为按目录灰度收紧（见下方 overrides）
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // ─── 后端源码（Node/CJS 风格，src/server 为反推产物）───
  {
    files: ['src/server/**/*.ts', 'src/shared/**/*.{cjs,mjs,js}'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      // serve.ts 由 bundle 反推而来，保留 var / require 风格，避免无谓改动引入风险
      'no-var': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': 'off',
    },
  },

  // ─── 灰度：把「新增 any」变成错误，旧代码可渐进迁移 ───
  {
    files: ['src/renderer/store/*.ts', 'src/renderer/engine/*.ts', 'src/renderer/types.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  },
)
