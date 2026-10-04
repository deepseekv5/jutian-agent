@echo off
rem 巨天agent — 一键启动开发环境(自动安装依赖)
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [jutian] 未检测到 Node.js,请先安装 Node.js 18+:https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [jutian] 首次运行,正在安装依赖(约 1-2 分钟)...
  call npm install
  if errorlevel 1 (
    echo [jutian] 依赖安装失败,请检查网络后重试
    pause
    exit /b 1
  )
)

node scripts/dev.mjs
if errorlevel 1 pause
