/**
 * 巨天agent SQLite 数据库层 (CJS — serve.cjs 用)
 * 数据库文件：~/.lyclaw/data.db
 */

'use strict'

const Database = require('better-sqlite3')
const { join } = require('path')
const { homedir } = require('os')
const { mkdirSync, existsSync } = require('fs')
const nodeCrypto = require('crypto')

const DB_DIR = join(homedir(), '.lyclaw')
const DB_PATH = join(DB_DIR, 'data.db')

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// 知识条目表（AI 与用户可写，支撑图谱连线）
db.exec(`CREATE TABLE IF NOT EXISTS kb_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  links TEXT DEFAULT '[]',
  source TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`)

// 知识库向量表（幂等）
db.exec(`CREATE TABLE IF NOT EXISTS kb_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  chunk TEXT NOT NULL,
  vector TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`)

// kb_entries 扩展列（幂等迁移：notebook 笔记本分组 / pinned 置顶 / icon）
try { db.exec(`ALTER TABLE kb_entries ADD COLUMN notebook TEXT DEFAULT ''`) } catch (e) { if (!/duplicate column/i.test(e.message)) throw e }
try { db.exec(`ALTER TABLE kb_entries ADD COLUMN pinned INTEGER DEFAULT 0`) } catch (e) { if (!/duplicate column/i.test(e.message)) throw e }
try { db.exec(`ALTER TABLE kb_entries ADD COLUMN icon TEXT DEFAULT ''`) } catch (e) { if (!/duplicate column/i.test(e.message)) throw e }

db.pragma('busy_timeout = 3000')

// ─── 建表 ───
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '新对话',
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    content TEXT,
    thinking TEXT,
    tool_calls TEXT,
    tool_call_id TEXT,
    created_at INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS code_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS code_tabs (
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'text',
    FOREIGN KEY (project_id) REFERENCES code_projects(id) ON DELETE CASCADE
  );
`)

// 迁移：为已有 messages 表添加 thinking 列（忽略已存在的情况）
try {
  db.exec(`ALTER TABLE messages ADD COLUMN thinking TEXT`)
} catch (e) {
  if (!e.message?.includes('duplicate column name')) throw e
}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN swarm TEXT`)
} catch (e) {
  if (!e.message?.includes('duplicate column name')) throw e
}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN variants TEXT`)
} catch (e) {
  if (!e.message?.includes('duplicate column name')) throw e
}

function genId() {
  return nodeCrypto.randomUUID()
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
function ts() {
  return Date.now()
}

// ─── Sessions ───
function createSession(id, title) {
  const now = ts()
  db.prepare('INSERT OR REPLACE INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, title || '新对话', now, now)
  return getSession(id)
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null
}

function listSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all()
}

function updateSession(id, fields) {
  const sets = []
  const vals = []
  if (fields.title !== undefined) { sets.push('title = ?'); vals.push(fields.title) }
  sets.push('updated_at = ?'); vals.push(fields.updated_at || ts())
  vals.push(id)
  db.prepare('UPDATE sessions SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals)
}

function deleteSession(id) {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// ─── Messages ───
function addMessage(id, session_id, role, content, thinking, tool_calls, tool_call_id, swarm) {
  const row = { id, session_id, role, content: content || '', created_at: ts() }
  if (thinking) row.thinking = thinking
  if (tool_calls) row.tool_calls = tool_calls
  if (tool_call_id) row.tool_call_id = tool_call_id
  if (swarm) row.swarm = swarm
  const keys = Object.keys(row)
  db.prepare('INSERT OR REPLACE INTO messages (' + keys.join(',') + ') VALUES (' + keys.map(function(){return'?'}).join(',') + ')')
    .run(...keys.map(function(k){return row[k]}))
  return row
}

function getMessages(session_id) {
  return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(session_id)
}

function deleteMessages(session_id) {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(session_id)
}

function updateMessage(id, fields) {
  const sets = []
  const vals = []
  if (fields.content !== undefined) { sets.push('content = ?'); vals.push(fields.content) }
  if (fields.thinking !== undefined) { sets.push('thinking = ?'); vals.push(fields.thinking) }
  if (fields.tool_calls !== undefined) { sets.push('tool_calls = ?'); vals.push(fields.tool_calls) }
  if (fields.swarm !== undefined) { sets.push('swarm = ?'); vals.push(fields.swarm) }
  if (fields.variants !== undefined) { sets.push('variants = ?'); vals.push(fields.variants) }
  if (sets.length === 0) return
  vals.push(id)
  db.prepare('UPDATE messages SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals)
}

function getLastMessage(session_id) {
  return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session_id) || null
}

// 数据库维护：VACUUM 回收空间（设置 → 数据 → 优化数据库）
function vacuumDb() {
  const before = db.prepare("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()").get()
  db.exec('VACUUM')
  const after = db.prepare("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()").get()
  return { before: before?.size || 0, after: after?.size || 0 }
}

// ─── Memories ───
function setMemory(key, value) {
  const now = ts()
  const existing = db.prepare('SELECT id FROM memories WHERE key = ?').get(key)
  if (existing) {
    db.prepare('UPDATE memories SET value = ?, updated_at = ? WHERE key = ?').run(value, now, key)
  } else {
    db.prepare('INSERT INTO memories (id, key, value, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(uid(), key, value, now, now)
  }
}

function getMemory(key) {
  const row = db.prepare('SELECT value FROM memories WHERE key = ?').get(key)
  return row ? row.value : null
}

function getAllMemories() {
  return db.prepare('SELECT key, value FROM memories ORDER BY updated_at DESC').all()
}

function deleteMemory(key) {
  db.prepare('DELETE FROM memories WHERE key = ?').run(key)
}

// ─── Settings ───
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

function getAllSettings() {
  return db.prepare('SELECT key, value FROM settings').all()
}

// ─── Code Projects ───
function createCodeProject(id, name, rootPath, createdAt, updatedAt) {
  db.prepare('INSERT OR REPLACE INTO code_projects (id, name, root_path, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, name, rootPath, createdAt, updatedAt || createdAt)
  return getCodeProject(id)
}

function getCodeProject(id) {
  return db.prepare('SELECT * FROM code_projects WHERE id = ?').get(id) || null
}

function listCodeProjects() {
  return db.prepare('SELECT * FROM code_projects ORDER BY updated_at DESC').all()
}

function deleteCodeProject(id) {
  db.prepare('DELETE FROM code_tabs WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM code_projects WHERE id = ?').run(id)
}

function saveCodeTabs(projectId, tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    db.prepare('DELETE FROM code_tabs WHERE project_id = ?').run(projectId)
    return
  }
  const del = db.prepare('DELETE FROM code_tabs WHERE project_id = ?')
  const ins = db.prepare('INSERT INTO code_tabs (project_id, path, name, language) VALUES (?,?,?,?)')
  const batchMany = db.transaction((pid, items) => {
    del.run(pid)
    for (const t of items) {
      ins.run(pid, t.path, t.name, t.language || 'text')
    }
  })
  batchMany(projectId, tabs)
}

function getCodeTabs(projectId) {
  return db.prepare('SELECT path, name, language FROM code_tabs WHERE project_id = ?').all(projectId)
}

// ─── 迁移：localStorage → SQLite ───
function migrateFromLocalStorage(lsData) {
  try {
    if (lsData.sessions) {
      var sessions = JSON.parse(lsData.sessions)
      if (Array.isArray(sessions)) {
        var stmt = db.prepare('INSERT OR REPLACE INTO sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)')
        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i]
          stmt.run(s.id, s.title || '新对话',
            new Date(s.created_at || Date.now()).getTime(),
            new Date(s.updated_at || Date.now()).getTime())
        }
      }
    }
    if (lsData.messagesKeys) {
      for (var j = 0; j < lsData.messagesKeys.length; j++) {
        var key = lsData.messagesKeys[j]
        if (key.startsWith('lyclaw_messages_')) {
          var sessionId = key.replace('lyclaw_messages_', '')
          var val = lsData[key]
          if (val && typeof val === 'string') {
            var messages = JSON.parse(val)
            if (Array.isArray(messages)) {
              var mStmt = db.prepare('INSERT OR REPLACE INTO messages (id, session_id, role, content, tool_calls, tool_call_id, created_at) VALUES (?,?,?,?,?,?,?)')
              for (var k = 0; k < messages.length; k++) {
                var m = messages[k]
                mStmt.run(m.id, sessionId, m.role, m.content || '',
                  m.tool_calls ? JSON.stringify(m.tool_calls) : null,
                  m.tool_call_id || null,
                  new Date(m.created_at || Date.now()).getTime())
              }
            }
          }
        }
      }
    }
    if (lsData.settings) {
      var settings = JSON.parse(lsData.settings)
      if (settings && typeof settings === 'object') {
        for (var sk in settings) {
          if (Object.prototype.hasOwnProperty.call(settings, sk)) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)')
              .run(sk, String(settings[sk]))
          }
        }
      }
    }
    if (lsData.memories) {
      for (var n = 0; n < lsData.memories.length; n++) {
        var item = lsData.memories[n]
        if (typeof item === 'string') {
          try {
            var obj = JSON.parse(item)
            setMemory(obj.key, obj.value)
          } catch (e) {}
        }
      }
    }
    if (lsData.codeProjects) {
      var codeProjs = JSON.parse(lsData.codeProjects)
      if (Array.isArray(codeProjs)) {
        var cpStmt = db.prepare('INSERT OR REPLACE INTO code_projects (id, name, root_path, created_at, updated_at) VALUES (?,?,?,?,?)')
        for (var p = 0; p < codeProjs.length; p++) {
          var cp = codeProjs[p]
          cpStmt.run(cp.id, cp.name, cp.rootPath, cp.created_at || new Date().toISOString(), cp.updated_at || new Date().toISOString())
        }
      }
    }
    return true
  } catch (e) {
    console.error('[db] migrate failed:', e)
    return false
  }
}

// ─── 知识库 ───
function upsertKbEntry(entry) {
  db.prepare(`INSERT INTO kb_entries (id, title, content, tags, links, source, notebook, pinned, icon, created_at, updated_at)
    VALUES (@id, @title, @content, @tags, @links, @source, @notebook, @pinned, @icon, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET title=@title, content=@content, tags=@tags, links=@links,
      notebook=@notebook, pinned=@pinned, icon=@icon, updated_at=datetime('now')`)
    .run({
      notebook: '', pinned: 0, icon: '', source: 'user', tags: '[]', links: '[]',
      ...entry,
    })
  return db.prepare('SELECT * FROM kb_entries WHERE id = ?').get(entry.id)
}
function listKbEntries() {
  return db.prepare('SELECT * FROM kb_entries ORDER BY pinned DESC, updated_at DESC').all()
}
function getKbEntryByTitle(title) {
  return db.prepare('SELECT * FROM kb_entries WHERE title = ?').get(title) || null
}
function getKbEntry(id) {
  return db.prepare('SELECT * FROM kb_entries WHERE id = ?').get(id) || null
}
// 反向链接：links 列里引用了该 id 的其它条目
function kbBacklinks(id) {
  return db.prepare(`SELECT * FROM kb_entries WHERE id != ? AND links LIKE ?`).all(id, `%"${id}"%`)
}
// 笔记本分组统计
function kbNotebooks() {
  return db.prepare(`SELECT COALESCE(notebook,'') AS notebook, COUNT(*) AS n FROM kb_entries GROUP BY notebook ORDER BY n DESC`).all()
}
// 全文检索笔记（标题+正文）
function kbSearchNotes(q) {
  return db.prepare(`SELECT id, title, content, notebook, updated_at FROM kb_entries WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 50`)
    .all(`%${q}%`, `%${q}%`)
}
function deleteKbEntry(id) {
  db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id)
  db.prepare("DELETE FROM kb_chunks WHERE path = ?").run('entry:' + id)
}
function kbInsert(path, chunk, vector) {
  db.prepare('INSERT INTO kb_chunks (path, chunk, vector) VALUES (?, ?, ?)').run(path, chunk, JSON.stringify(vector))
}
function kbAll() {
  return db.prepare('SELECT id, path, chunk, vector FROM kb_chunks').all()
}
function kbCount() {
  return db.prepare('SELECT COUNT(*) as n FROM kb_chunks').get().n
}
function kbClear() {
  db.prepare('DELETE FROM kb_chunks').run()
}
function kbDeleteByPath(path) {
  db.prepare('DELETE FROM kb_chunks WHERE path = ?').run(path)
}

module.exports = {
  db, genId,
  createSession, getSession, listSessions, updateSession, deleteSession,
  addMessage, getMessages, deleteMessages, updateMessage, getLastMessage, vacuumDb,
  setMemory, getMemory, getAllMemories, deleteMemory,
  setSetting, getSetting, getAllSettings,
  createCodeProject, getCodeProject, listCodeProjects, deleteCodeProject,
  saveCodeTabs, getCodeTabs,
  kbInsert, kbAll, kbCount, kbClear, kbDeleteByPath,
  upsertKbEntry, listKbEntries, getKbEntryByTitle, deleteKbEntry,
  getKbEntry, kbBacklinks, kbNotebooks, kbSearchNotes,
  migrateFromLocalStorage,
}
