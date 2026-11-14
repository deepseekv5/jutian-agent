import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'

// SQLite 三档适配：node:sqlite 档让手机/Termux 也能用真 SQL。
// 本机 Node < 22 时没有 node:sqlite，相关用例跳过（CI 的 Node 20 job 即如此）。
const requireCjs = createRequire(import.meta.url)
const shim = requireCjs('../src/shared/sqliteShim.cjs')

const hasNodeSqlite = (() => {
  try { requireCjs('node:sqlite'); return true } catch { return false }
})()

function tmpDbPath() {
  return path.join(os.tmpdir(), `shim-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

describe('sqliteShim.open（引擎选择）', () => {
  it('open 返回可用引擎并带 __engine 标记', () => {
    const p = tmpDbPath()
    const db = shim.open(p)
    expect(['better-sqlite3', 'node:sqlite']).toContain(db.__engine)
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t(id, v) VALUES (?, ?)').run('a', '1')
    expect(db.prepare('SELECT v FROM t WHERE id = ?').get('a')).toMatchObject({ v: '1' })
    db.close()
    fs.rmSync(p, { force: true })
  })
})

describe.skipIf(!hasNodeSqlite)('node:sqlite 适配层', () => {
  it('建表/写入/查询（位置参数）', () => {
    const p = tmpDbPath()
    const db = shim.openNodeSqlite(p)
    expect(db.__engine).toBe('node:sqlite')
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t(id, v) VALUES (?, ?)').run('x', 'hello')
    expect(db.prepare('SELECT v FROM t WHERE id = ?').get('x')).toMatchObject({ v: 'hello' })
    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(1)
    db.close()
    fs.rmSync(p, { force: true })
  })

  it('命名参数（db.cjs 的知识库写入依赖这个）', () => {
    const p = tmpDbPath()
    const db = shim.openNodeSqlite(p)
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t(id, v) VALUES (@id, @v)').run({ id: 'n1', v: 'named' })
    expect(db.prepare('SELECT v FROM t WHERE id = @id').get({ id: 'n1' })).toMatchObject({ v: 'named' })
    db.close()
    fs.rmSync(p, { force: true })
  })

  it('pragma 适配（journal_mode 设置不抛错）', () => {
    const p = tmpDbPath()
    const db = shim.openNodeSqlite(p)
    expect(() => db.pragma('journal_mode = WAL')).not.toThrow()
    expect(() => db.pragma('busy_timeout = 3000')).not.toThrow()
    db.close()
    fs.rmSync(p, { force: true })
  })

  it('transaction 提交生效、异常回滚', () => {
    const p = tmpDbPath()
    const db = shim.openNodeSqlite(p)
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY)')
    const insertMany = db.transaction((items: string[]) => {
      for (const id of items) db.prepare('INSERT INTO t(id) VALUES (?)').run(id)
    })
    insertMany(['a', 'b'])
    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(2)

    const boom = db.transaction(() => {
      db.prepare('INSERT INTO t(id) VALUES (?)').run('c')
      throw new Error('rollback me')
    })
    expect(() => boom()).toThrow('rollback me')
    // 回滚后 c 不应存在
    expect(db.prepare('SELECT * FROM t WHERE id = ?').get('c')).toBeUndefined()
    expect(db.prepare('SELECT * FROM t').all()).toHaveLength(2)
    db.close()
    fs.rmSync(p, { force: true })
  })

  it('数据落盘：关闭后重新打开仍能读到', () => {
    const p = tmpDbPath()
    const db1 = shim.openNodeSqlite(p)
    db1.exec('CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT)')
    db1.prepare('INSERT INTO t(id, v) VALUES (?, ?)').run('persist', 'yes')
    db1.close()
    const db2 = shim.openNodeSqlite(p)
    expect(db2.prepare('SELECT v FROM t WHERE id = ?').get('persist')).toMatchObject({ v: 'yes' })
    db2.close()
    fs.rmSync(p, { force: true })
  })
})
