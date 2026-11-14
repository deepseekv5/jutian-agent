/**
 * jsondb 行为对齐测试——它是手机独立模式的数据底座
 *
 * 验证方向不是"函数存在"，而是与 SQLite 版（db.cjs）行为逐项一致：
 * 返回字段名、排序方向、幂等性、持久化（杀进程重开数据还在）。
 * 任何形状漂移都会在手机上表现为"存了但读不回来"。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createJsonDb } from '../src/shared/jsondb.cjs'

let dir: string
let file: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsondb-'))
  file = path.join(dir, 'data.json')
})

describe('会话与消息（对话核心链路）', () => {
  it('建会话→加消息→读回，字段与排序和 SQLite 版一致', () => {
    const db = createJsonDb(file)
    db.createSession('s1', '测试会话', '/proj')
    db.addMessage('m1', 's1', 'user', '你好', '', '', '')
    db.addMessage('m2', 's1', 'assistant', '你好，我是巨天', '思考中', '[]', '')
    const msgs = db.getMessages('s1')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].id).toBe('m1')            // created_at 升序（与 SQLite ORDER BY 一致）
    expect(msgs[1].content).toBe('你好，我是巨天')
    expect(msgs[1].thinking).toBe('思考中')
    const s = db.getSession('s1')
    expect(s.title).toBe('测试会话')
    expect(s.project).toBe('/proj')
  })

  it('持久化：flush 后重开库，数据还在（手机重启不丢对话）', () => {
    const db = createJsonDb(file)
    db.createSession('s2', '持久化测试')
    db.addMessage('m3', 's2', 'user', '这条消息必须活过重启')
    db.flush()                                // 模拟进程退出前的落盘
    const db2 = createJsonDb(file)            // 全新实例（= 杀进程重开）
    expect(db2.getMessages('s2')).toHaveLength(1)
    expect(db2.getMessages('s2')[0].content).toBe('这条消息必须活过重启')
    expect(db2.getSession('s2')?.title).toBe('持久化测试')
  })

  it('更新消息内容（流式完成的 update 路径）', () => {
    const db = createJsonDb(file)
    db.createSession('s3')
    db.addMessage('m4', 's3', 'assistant', '半截')
    db.updateMessage('m4', { content: '完整回复' })
    expect(db.getMessages('s3')[0].content).toBe('完整回复')
  })

  it('deleteMessagesAfter：回滚/重生成要删掉指定消息之后的内容', () => {
    const db = createJsonDb(file)
    db.createSession('s4')
    for (let i = 1; i <= 4; i++) db.addMessage(`k${i}`, 's4', 'user', `消息${i}`)
    const n = db.deleteMessagesAfter('s4', 'k2')   // 保留 k1 k2，删 k3 k4
    expect(n).toBe(2)
    expect(db.getMessages('s4')).toHaveLength(2)
  })

  it('listSessions 按 updated_at 倒序（侧栏顺序）', () => {
    const db = createJsonDb(file)
    db.createSession('a1', '旧')
    db.createSession('a2', '新')
    db.updateSession('a1', { title: '旧', updated_at: Date.now() - 5000 })
    const list = db.listSessions()
    expect(list[0].id).not.toBe('a1')  // a1 更新时间更早，不应排第一
  })

  it('messageCounts 空会话不在结果里（空会话清理依赖此形状）', () => {
    const db = createJsonDb(file)
    db.createSession('mc1')
    db.addMessage('x1', 'mc1', 'user', 'a')
    db.addMessage('x2', 'mc1', 'user', 'b')
    db.createSession('mc-empty')
    const c = db.messageCounts()
    expect(c['mc1']).toBe(2)
    expect(c['mc-empty']).toBeUndefined()  // 与 SQLite GROUP BY 一致：无消息的会话不出现在计数里
  })
})

describe('设置与记忆', () => {
  it('API Key 等设置真实保存并持久化（手机上配密钥的前提）', () => {
    const db = createJsonDb(file)
    db.setSetting('apiKey', 'sk-test-123')
    db.setSetting('model', 'big-pickle')
    db.flush()
    const db2 = createJsonDb(file)
    expect(db2.getSetting('apiKey')).toBe('sk-test-123')
    const all = db2.getAllSettings()
    expect(all.find((r: any) => r.key === 'model')?.value).toBe('big-pickle')
  })

  it('记忆读写删', () => {
    const db = createJsonDb(file)
    db.setMemory('user-name', '测试者')
    expect(db.getMemory('user-name')).toBe('测试者')
    db.deleteMemory('user-name')
    expect(db.getMemory('user-name')).toBeUndefined()
    db.flush()
    expect(createJsonDb(file).getAllMemories()).toHaveLength(0)
  })
})

describe('降级行为（诚实，不造假数据）', () => {
  it('知识库接口返回空集而非报错', () => {
    const db = createJsonDb(file)
    expect(db.kbAll()).toEqual([])
    expect(db.kbCount()).toBe(0)
    expect(db.kbSearchNotes('任意')).toEqual([])
    expect(() => db.kbInsert('p', 'c', [])).not.toThrow()
  })
})

describe('边界', () => {
  it('文件损坏时从空库开始（不崩）', () => {
    fs.writeFileSync(file, '{corrupted', 'utf-8')
    const db = createJsonDb(file)
    expect(db.listSessions()).toEqual([])
    expect(() => db.createSession('fresh', '损坏后新建')).not.toThrow()
  })

  it('genId 生成合法 UUID', () => {
    const db = createJsonDb(file)
    expect(db.genId()).toMatch(/[0-9a-f-]{36}/)
  })
})
