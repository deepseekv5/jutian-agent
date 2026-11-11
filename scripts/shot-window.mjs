#!/usr/bin/env node
/** 视觉验收辅助：截巨天agent 窗口（不依赖点击坐标），输出 /tmp/jt-shot-<name>.png */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

const name = process.argv[2] || 'now'
const py = `
import Quartz, Quartz.CoreGraphics as CG
wl = CG.CGWindowListCopyWindowInfo(CG.kCGWindowListOptionOnScreenOnly | CG.kCGWindowListExcludeDesktopElements, CG.kCGNullWindowID)
w = next((x for x in wl if '巨天' in x.get('kCGWindowOwnerName','')), None)
if w is None: print('NOWINDOW'); raise SystemExit(1)
b = w['kCGWindowBounds']
print(int(b['X']), int(b['Y']), int(b['Width']), int(b['Height']))
`
const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim()
if (out === 'NOWINDOW' || !out) { console.error('window not found'); process.exit(1) }
const [x, y, w, h] = out.split(' ').map(Number)
execFileSync('screencapture', ['-x', '/tmp/jt-full.png'])
const crop = `
from PIL import Image
im = Image.open('/tmp/jt-full.png')
sx = im.size[0] / 1680.0
box = (int(${x}*sx), int(${y}*sx), int((${x}+${w})*sx), int((${y}+${h})*sx))
im.crop(box).save('/tmp/jt-shot-${name}.png')
print(box)
`
writeFileSync('/tmp/jt-crop.py', crop)
console.log(execFileSync('python3', ['-I', '/tmp/jt-crop.py'], { encoding: 'utf8' }).trim())
console.log(`/tmp/jt-shot-${name}.png`)
