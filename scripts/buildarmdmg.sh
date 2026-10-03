#!/bin/bash
set -euo pipefail

echo "========================================"
echo "  巨天agent — ARM64 DMG 构建脚本"
echo "========================================"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 1. 清理旧产物
echo "[1/5] 清理旧的构建产物..."
rm -rf dist release

# 2. 安装/重建原生模块
echo "[2/5] 重建 better-sqlite3 (electron native)..."
npm rebuild better-sqlite3

# 3. 构建前端
echo "[3/5] 构建 Vite 前端..."
npx vite build

# 4. 重建 Electron 原生模块
echo "[4/5] 重建 electron 原生模块..."
bash scripts/rebuild-for-electron.sh

# 5. 打包 DMG (仅 ARM64)
echo "[5/5] 打包 DMG (arm64)..."
npx electron-builder --mac --arm64 --publish=never

# 输出结果
DMG_PATH="$(ls -t release/*.dmg 2>/dev/null | head -1)"
echo ""
echo "========================================"
if [ -n "$DMG_PATH" ]; then
    DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
    echo "  构建成功!"
    echo "  DMG: $DMG_PATH"
    echo "  大小: $DMG_SIZE"
else
    echo "  构建失败: 未找到 DMG 文件"
    echo "  请检查上方错误日志"
    exit 1
fi
echo "========================================"
