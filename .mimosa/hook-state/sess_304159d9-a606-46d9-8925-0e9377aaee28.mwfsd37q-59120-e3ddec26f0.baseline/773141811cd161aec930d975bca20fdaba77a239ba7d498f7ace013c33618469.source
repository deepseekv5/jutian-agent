#!/bin/bash
# 为 Electron 33.4.11 (NODE_MODULE_VERSION 130) 编译 better-sqlite3
# 解决 macOS 27 CLT C++ 头文件不完整的问题

set -e

ELECTRON_VERSION="33.4.11"
MODULE_DIR="node_modules/better-sqlite3"

if [ ! -d "$MODULE_DIR" ]; then
  echo "Error: $MODULE_DIR not found"
  exit 1
fi

export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
export CXXFLAGS="-isystem ${SDKROOT}/usr/include/c++/v1 -std=c++20"
export PATH="/opt/homebrew/bin:$PATH"

echo "=== Rebuilding better-sqlite3 for Electron ${ELECTRON_VERSION} ==="

cd "$MODULE_DIR"
npx node-gyp rebuild \
  --target="${ELECTRON_VERSION}" \
  --arch=arm64 \
  --dist-url=https://electronjs.org/headers \
  --release

echo "=== Verify: checking NODE_MODULE_VERSION ==="
grep -r "NODE_MODULE_VERSION" ~/Library/Caches/node-gyp/${ELECTRON_VERSION}/include/node/node_version.h | grep "#define NODE_MODULE_VERSION"

echo "=== Rebuild complete ==="
