import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createJsonDb } = require('../src/shared/jsondb.cjs')

let dir: string
let file: string
let db: any

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jutian-kb-'))
  file = path.join(dir, 'data.json')
  db = createJsonDb(file)
})
afterEach(() => {
  // 防抖定时器会在删目录后回调写文件，先给它时间跑完再清理，避免噪音
  try { db?.flush?.() } catch { /* ignore */ }
  try { clearTimeout((db as any).__flushTimerForTest) } catch { /* ignore */ }
})

describe('jsondb 知识库降级持久化（v14.11.2）', () => {
  it('条目写入后能读回，且跨实例（重启）不丢', () => {
    db.upsertKbEntry({ id: 'e1', title: '测试笔记', content: '内容', tags: '["a"]', links: '["e2"]', notebook: '工作', pinned: 1 })
    db.upsertKbEntry({ id: 'e2', title: '另一篇', content: '别的内容', links: '[]' })
    db.flush()
    // 模拟应用重启：新实例从同一文件读回
    const db2 = createJsonDb(file)
    const all = db2.listKbEntries()
    expect(all.length).toBe(2)
    expect(all[0].title).toBe('测试笔记') // pinned=1 排前
    expect(db2.getKbEntry('e1').content).toBe('内容')
    expect(db2.getKbEntryByTitle('另一篇').id).toBe('e2')
  })

  it('反链接 / 笔记本 / 全文搜索可用', () => {
    db.upsertKbEntry({ id: 'a', title: 'Alpha', content: '苹果', links: '["b"]', notebook: 'N1' })
    db.upsertKbEntry({ id: 'b', title: 'Beta', content: '香蕉', links: '[]', notebook: 'N1' })
    expect(db.kbBacklinks('b').map((x: any) => x.id)).toEqual(['a'])
    expect(db.kbNotebooks()).toEqual([{ notebook: 'N1', n: 2 }])
    expect(db.kbSearchNotes('苹果').map((x: any) => x.id)).toEqual(['a'])
    expect(db.kbSearchNotes('香蕉')[0].title).toBe('Beta')
  })

  it('分块真落盘，count/delete/clear 生效（此前 kbInsert 是 no-op）', () => {
    db.kbInsert('entry:a', 'chunk one', [0.1, 0.2])
    db.kbInsert('entry:a', 'chunk two', [0.3])
    db.flush()
    const db2 = createJsonDb(file)
    expect(db2.kbCount()).toBe(2)
    expect(db2.kbAll()[0].chunk).toBe('chunk one')
    db2.kbDeleteByPath('entry:a')
    expect(db2.kbCount()).toBe(0)
    db2.kbInsert('entry:b', 'x', [])
    db2.kbClear()
    expect(db2.kbCount()).toBe(0)
  })

  it('删除条目时连带删掉它的分块', () => {
    db.upsertKbEntry({ id: 'x', title: 'X', content: '' })
    db.kbInsert('entry:x', 'c1', [])
    db.deleteKbEntry('x')
    expect(db.getKbEntry('x')).toBe(null)
    expect(db.kbCount()).toBe(0)
  })

  it('upsert 覆盖同名 id 并刷新 updated_at', () => {
    db.upsertKbEntry({ id: 'u', title: '旧', content: 'v1' })
    db.upsertKbEntry({ id: 'u', title: '新', content: 'v2' })
    expect(db.listKbEntries().length).toBe(1)
    expect(db.getKbEntry('u').title).toBe('新')
  })
})
