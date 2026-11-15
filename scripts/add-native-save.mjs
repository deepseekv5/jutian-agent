/**
 * codemod：把「a[download] 浏览器下载」模式替换为统一入口 downloadFile（utils/nativeSave）
 * v16.7 安卓原生保存改造。跑一次即可；已替换的文件会跳过（幂等按 import 标记）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  'src/renderer/settings/AboutContent.tsx',
  'src/renderer/settings/SettingsModal.tsx',
  'src/renderer/app/NewTabPage.tsx',
  'src/renderer/panels/GongwenDesk.tsx',
  'src/renderer/panels/BackupPanel.tsx',
  'src/renderer/panels/ExportPanel.tsx',
  'src/renderer/panels/persona/PersonaChatTab.tsx',
  'src/renderer/panels/DiagnosticsPanel.tsx',
  'src/renderer/panels/KnowledgeBase.tsx',
]

// 标准块：const a … a.href=URL.createObjectURL(X) … a.download=NAME … a.click()…revoke
// 变量名可能为 a / a2；blob 变量 X 原样引用
const blockRe = /([ \t]*)const (a\d?) = document\.createElement\('a'\)\n[ \t]*\2\.href = URL\.createObjectURL\((blob\w*)\)\n[ \t]*\2\.download = ([^\n]+)\n[ \t]*\2\.click\(\);?[ \t]*(?:URL\.revokeObjectURL\(\2\.href\)|setTimeout\(\(\) => URL\.revokeObjectURL\(\2\.href\), \d+\))?\n?/g

let total = 0
for (const f of files) {
  let src = readFileSync(f, 'utf-8')
  if (src.includes("from '../utils/nativeSave'") || src.includes('from "../../utils/nativeSave"')) { console.log('skip(已接):', f); continue }
  let count = 0
  src = src.replace(blockRe, (m, ind, aVar, blobVar, nameExpr) => {
    count++
    return `${ind}void downloadFile(${nameExpr}, ${blobVar})`
  })
  if (!count) { console.log('no-match:', f); continue }
  // 注入 import（放在最后一个相对 import 之后）
  const rel = f.split('/').length - 1 // 距 src/renderer 的深度决定 ../ 层级
  const depth = f.replace('src/renderer/', '').split('/').length - 1
  const dots = '../'.repeat(depth)
  const imp = `import { downloadFile } from '${dots}utils/nativeSave'\n`
  const lines = src.split('\n')
  let lastImp = -1
  for (let i = 0; i < lines.length; i++) if (/^import .* from ['"]\./.test(lines[i])) lastImp = i
  lines.splice(lastImp + 1, 0, imp.trimEnd())
  writeFileSync(f, lines.join('\n'))
  total += count
  console.log(`✓ ${f}: ${count} 处`)
}
console.log('total:', total)
