#!/usr/bin/env bash
# 巨天agent — 一键启动开发环境(自动安装依赖)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[jutian] 未检测到 Node.js,请先安装 Node.js 18+:https://nodejs.org" >&2
  exit 1
fi

if [ ! -f node_modules/vite/bin/vite.js ]; then
  echo "[jutian] 首次运行,正在安装依赖(约 1-2 分钟)..."
  npm install
fi

exec node scripts/dev.mjs
