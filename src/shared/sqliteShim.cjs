/**
 * SQLite 三档引擎适配（v13.3）—— 让"真 SQL"在所有端都能跑
 *
 * 优先级：
 *   1. better-sqlite3   桌面端（Electron ABI 原生模块，CI 各平台重建）
 *   2. node:sqlite      Node 22.5+ 内置 SQLite —— Termux/手机/无原生编译环境
 *   3. （调用方回退）    jsondb JSON 存储
 *
 * 为什么需要第 2 档：手机（Termux）装不上原生模块，过去只能退到 JSON 文件，
 * 知识库等 SQL 特性全废。Node 22+ 自带 SQLite，无需编译，能拿到真 SQL。
 *
 * node:sqlite 与 better-sqlite3 的差异全部在这一层抹平：
 *   · 无 pragma()/transaction() 方法 → 用 exec 实现同名方法
 *   · 语句对象方法签名一致（run/get/all 均支持位置参数与命名参数）
 */

'use strict'

function openBetterSqlite(filePath) {
  const Database = require('better-sqlite3')
  const db = new Database(filePath)
  db.__engine = 'better-sqlite3'
  return db
}

function openNodeSqlite(filePath) {
  const { DatabaseSync } = require('node:sqlite')
  const raw = new DatabaseSync(filePath)
  const shim = {
    __engine: 'node:sqlite',
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
        // better-sqlite3 的 iterate 返回迭代器；node:sqlite 无对应方法，
        // 用 all 模拟（db.cjs 当前未使用，保留以防后续代码依赖）
        iterate: (...args) => stmt.all(...args)[Symbol.iterator](),
      }
    },
    exec(sql) {
      raw.exec(sql)
    },
    pragma(expr) {
      raw.exec('PRAGMA ' + expr)
    },
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN')
        try {
          const out = fn(...args)
          raw.exec('COMMIT')
          return out
        } catch (e) {
          try { raw.exec('ROLLBACK') } catch { /* 事务已中断 */ }
          throw e
        }
      }
    },
    close() {
      raw.close()
    },
  }
  return shim
}

/**
 * 打开数据库：先 better-sqlite3，失败退 node:sqlite。
 * 两者都不可用时抛错，由调用方回退 jsondb。
 */
function open(filePath) {
  try {
    return openBetterSqlite(filePath)
  } catch (e) {
    // 原生模块缺失/ABI 不符（手机上必然如此）——继续尝试内置引擎
    try {
      return openNodeSqlite(filePath)
    } catch (e2) {
      const err = new Error(`SQLite 不可用：better-sqlite3(${e.message}) / node:sqlite(${e2.message})`)
      err.betterSqliteError = e.message
      err.nodeSqliteError = e2.message
      throw err
    }
  }
}

module.exports = { open, openBetterSqlite, openNodeSqlite }
