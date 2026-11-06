/**
 * 打包后原生模块架构自检（v14.11.2）
 *
 * 用户反馈「mac-x64 里没有 sqlite，知识库都不会保存」——根因是
 * better-sqlite3 的 .node 在某些架构/ABI 组合下缺失或架构不对，
 * 而 app.asar 自更新包只替换纯 JS 包，永远带不了 app.asar.unpacked/
 * 里的原生模块。所以每个平台的**完整安装包**必须在发布前自证：
 *   1. app.asar.unpacked 里存在 better_sqlite3.node
 *   2. 该 .node 的架构与本次构建目标架构一致
 *   3. 大小合理（>100KB，排除占位/截断文件）
 *
 * 用法：node scripts/verify-native.cjs <arch> <platform> [resourcesDir]
 *   arch      = x64 | arm64
 *   platform  = darwin | win32 | linux
 *   resourcesDir 默认按平台探测 release/*-unpacked/resources 或 release/win-unpacked/resources
 *
 * 零依赖：只用 node:fs / node:child_process（file 命令在 macOS/Linux runner
 * 上有；Windows 用 PE 头 magic 直接判）。校验失败 exit 1，CI 会红灯阻断发布。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ARCH = process.argv[2] || ''
const PLATFORM = process.argv[3] || process.platform
const REL = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'

function findResources(explicit) {
  if (explicit) return [explicit]
  const out = path.resolve('release')
  const candidates = [
    path.join(out, 'mac-unpacked', 'resources'),           // mac 单架构
    path.join(out, 'mac-arm64-unpacked', 'resources'),
    path.join(out, 'mac-x64-unpacked', 'resources'),
    path.join(out, 'win-unpacked', 'resources'),
    path.join(out, 'win-x64-unpacked', 'resources'),
    path.join(out, 'win-arm64-unpacked', 'resources'),
    path.join(out, 'linux-unpacked', 'resources'),
    path.join(out, 'linux-x64-unpacked', 'resources'),
    path.join(out, 'linux-arm64-unpacked', 'resources'),
  ]
  // 也扫 release 下任意 *-unpacked/resources
  try {
    for (const d of fs.readdirSync(out)) {
      const r = path.join(out, d, 'resources')
      if (fs.existsSync(r) && !candidates.includes(r)) candidates.push(r)
    }
  } catch { /* 目录不存在 */ }
  return candidates
}

function archOfFile(p, platform) {
  try {
    const out = execFileSync('file', [p], { encoding: 'utf8' })
    if (/ARM64|aarch64/i.test(out)) return 'arm64'
    if (/x86-64|x86_64|PE32\+.*x86-64/i.test(out)) return 'x64'
  } catch { /* 回退二进制解析 */ }
  return archOfBinary(fs.readFileSync(p), platform)
}

function archOfBinary(buf, platform) {
  if (platform === 'win32') {
    // PE: 0x8664 = x64, 0xAA64 = ARM64
    if (buf.length > 0x40) {
      const magic = buf.readUInt16LE(0x3c + 4)
      if (magic === 0x8664) return 'x64'
      if (magic === 0xaa64) return 'arm64'
      if (magic === 0x14c) return 'ia32'
    }
    return 'unknown'
  }
  if (platform === 'darwin') {
    // Mach-O fat/单架构：magic 0xcffaedfe=64位小端, cputype 在偏移 4
    if (buf.length > 8) {
      const magic = buf.readUInt32LE(0)
      const is64le = magic === 0xfeedfacf || magic === 0xcffaedfe
      const isFat = magic === 0xcafebabe || magic === 0xbebafeca
      if (is64le) {
        const cpu = buf.readUInt32LE(4)
        if (cpu === 0x01000007) return 'x64'
        if (cpu === 0x0100000c) return 'arm64'
      }
      if (isFat && buf.length > 0x20) {
        // fat 头里第一段 cputype（大端）
        const cpu = buf.readUInt32BE(8)
        if (cpu === 0x01000007) return 'x64'
        if (cpu === 0x0100000c) return 'arm64'
      }
    }
    return 'unknown'
  }
  // Linux ELF: e_machine 0x3e=x86_64, 0xb7=aarch64
  if (buf.length > 0x14) {
    const m = buf.readUInt16LE(0x12)
    if (m === 0x3e) return 'x64'
    if (m === 0xb7) return 'arm64'
  }
  return 'unknown'
}

let checked = 0, failed = 0
for (const res of findResources(process.argv[4])) {
  const unpacked = path.join(res, 'app.asar.unpacked')
  const p = path.join(unpacked, REL)
  if (!fs.existsSync(p)) continue
  checked++
  const buf = fs.readFileSync(p)
  const got = archOfFile(p, PLATFORM)
  const sizeOk = buf.length > 100 * 1024
  const archOk = got === ARCH
  console.log(`[verify-native] ${p}`)
  console.log(`  size=${Math.round(buf.length / 1024)}KB arch=${got} (expect ${ARCH}) platform=${PLATFORM}`)
  // file 命令做二次印证（有就用，没有不影响）
  try {
    const out = execFileSync('file', [p], { encoding: 'utf8' }).trim()
    console.log('  file:', out.slice(0, 160))
  } catch { /* Windows 无 file，跳过 */ }
  if (!sizeOk || !archOk) {
    console.error(`  ✗ 不合格：${!sizeOk ? '文件过小' : ''} ${!archOk ? '架构不匹配' : ''}`)
    failed++
  } else {
    console.log('  ✓ 合格')
  }
}

if (checked === 0) {
  console.error('[verify-native] ✗ 没找到任何 app.asar.unpacked 下的 better_sqlite3.node —— 该平台安装包缺原生模块，发布阻断')
  process.exit(1)
}
if (failed > 0) {
  console.error(`[verify-native] ✗ ${failed}/${checked} 个产物不合格，发布阻断`)
  process.exit(1)
}
console.log(`[verify-native] ✓ ${checked} 个产物全部合格（${PLATFORM}-${ARCH}）`)
