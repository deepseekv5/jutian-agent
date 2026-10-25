/**
 * JSON 文件数据库（手机独立模式 / 原生模块不可用时的完整降级）
 *
 * 背景：better-sqlite3 是原生模块，桌面三平台有预编译包；但在
 * Android(Termux/bionic)、或任何 ABI 对不上的环境里加载失败——
 * 之前 makeDbFallback 是"空读+写丢弃"的占位代理，界面能开但
 * 数据全丢，等于不可用。
 *
 * 本模块用单个 JSON 文件实现 db.cjs 的对话核心 API
 * （会话/消息/设置/记忆/代码项目），行为与 SQLite 版逐一对齐：
 *   · 相同的函数签名与返回形状（字段名、排序）
 *   · 写操作防抖 500ms 落盘（打字/流式期间不逐条写文件）
 *   · 进程退出前 flush
 * 知识库向量表（kb*）在手机模式返回空集而非报错——检索功能
 * 不可用是诚实的降级，不假装有数据。
 *
 * 导出形状与 db.cjs 完全一致，serve.ts 里可无缝替换。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

function createJsonDb(filePath) {
  const DIR = path.dirname(filePath);
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* 只读环境由调用方处理 */ }

  // 数据形状：与 SQLite 各表一一对应
  let data = {
    sessions: [],     // {id,title,created_at,updated_at,project}
    messages: [],     // {id,session_id,role,content,thinking,tool_calls,tool_call_id,swarm,variants,created_at}
    settings: [],     // {key,value}
    memories: [],     // {key,value,updated_at}
    codeProjects: [], // {id,name,rootPath,created_at,updated_at}
    codeTabs: {},     // {projectId: JSON字符串}
  };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(data)) {
      if (parsed[k] !== undefined) data[k] = parsed[k];
    }
  } catch (e) { /* 首次启动或文件损坏：从空库开始 */ }

  let flushTimer = null;
  let dirty = false;

  function flush() {
    try {
      // 原子写：先写临时文件再 rename，写一半断电不会毁掉整库
      const tmp = filePath + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
      fs.renameSync(tmp, filePath);
      dirty = false;
    } catch (e) {
      console.error('[jsondb] 落盘失败:', e.message);
    }
  }

  /** 防抖落盘：高频写（流式期间每条消息一次 update）不逐次同步 IO */
  function scheduleFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (dirty) flush();
    }, 500);
  }

  // 退出前把还没落盘的写操作刷出去
  for (const ev of ['exit', 'SIGINT', 'SIGTERM']) {
    try { process.on(ev, () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } if (dirty) flush(); }); } catch (e) { /* ignore */ }
  }

  const ts = () => Date.now();
  const genId = () => nodeCrypto.randomUUID();

  /* ─── Sessions ─── */
  function createSession(id, title, project) {
    const now = ts();
    const row = { id: id || genId(), title: title || '新对话', created_at: now, updated_at: now, project: project || '' };
    const i = data.sessions.findIndex((s) => s.id === row.id);
    if (i >= 0) data.sessions[i] = row; else data.sessions.unshift(row);
    scheduleFlush();
    return getSession(row.id);
  }
  function getSession(id) {
    return data.sessions.find((s) => s.id === id) || null;
  }
  function listSessions() {
    // 与 SQLite 版一致：按 updated_at 倒序
    return [...data.sessions].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }
  function updateSession(id, fields) {
    const s = data.sessions.find((x) => x.id === id);
    if (!s) return;
    if (fields.title !== undefined) s.title = fields.title;
    if (fields.project !== undefined) s.project = fields.project;
    s.updated_at = fields.updated_at || ts();
    scheduleFlush();
  }
  function deleteSession(id) {
    data.sessions = data.sessions.filter((s) => s.id !== id);
    data.messages = data.messages.filter((m) => m.session_id !== id);
    scheduleFlush();
  }

  /* ─── Messages ─── */
  function addMessage(id, session_id, role, content, thinking, tool_calls, tool_call_id, swarm) {
    const row = { id: id || genId(), session_id, role, content: content || '', created_at: ts() };
    if (thinking) row.thinking = thinking;
    if (tool_calls) row.tool_calls = tool_calls;
    if (tool_call_id) row.tool_call_id = tool_call_id;
    if (swarm) row.swarm = swarm;
    const i = data.messages.findIndex((m) => m.id === row.id);
    if (i >= 0) data.messages[i] = row; else data.messages.push(row);
    scheduleFlush();
    return row;
  }
  function getMessages(session_id) {
    return data.messages
      .filter((m) => m.session_id === session_id)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }
  function messageCounts() {
    const out = {};
    for (const m of data.messages) out[m.session_id] = (out[m.session_id] || 0) + 1;
    return out;
  }
  function deleteMessages(session_id) {
    data.messages = data.messages.filter((m) => m.session_id !== session_id);
    scheduleFlush();
  }
  function updateMessage(id, fields) {
    const m = data.messages.find((x) => x.id === id);
    if (!m) return;
    for (const k of ['content', 'thinking', 'tool_calls', 'swarm', 'variants']) {
      if (fields[k] !== undefined) m[k] = fields[k];
    }
    scheduleFlush();
  }
  function deleteMessagesAfter(session_id, afterMessageId) {
    // 回滚/重生成用：删掉某消息之后的所有消息
    const list = getMessages(session_id);
    const idx = list.findIndex((m) => m.id === afterMessageId);
    if (idx < 0) return 0;
    const doomed = new Set(list.slice(idx + 1).map((m) => m.id));
    if (!doomed.size) return 0;
    data.messages = data.messages.filter((m) => !doomed.has(m.id));
    scheduleFlush();
    return doomed.size;
  }
  function getLastMessage(session_id) {
    const list = getMessages(session_id);
    return list.length ? list[list.length - 1] : null;
  }
  function vacuumDb() {
    flush();
    const size = (() => { try { return fs.statSync(filePath).size; } catch (e) { return 0; } })();
    return { before: size, after: size };
  }

  /* ─── Settings ─── */
  function setSetting(key, value) {
    const row = data.settings.find((s) => s.key === key);
    if (row) row.value = String(value);
    else data.settings.push({ key, value: String(value) });
    scheduleFlush();
  }
  function getSetting(key) {
    const row = data.settings.find((s) => s.key === key);
    return row ? row.value : undefined;
  }
  function getAllSettings() {
    return data.settings.map((s) => ({ key: s.key, value: s.value }));
  }

  /* ─── Memories ─── */
  function setMemory(key, value) {
    const row = data.memories.find((m) => m.key === key);
    if (row) { row.value = value; row.updated_at = ts(); }
    else data.memories.push({ key, value, updated_at: ts() });
    scheduleFlush();
  }
  function getMemory(key) {
    const row = data.memories.find((m) => m.key === key);
    return row ? row.value : undefined;
  }
  function getAllMemories() {
    return data.memories.map((m) => ({ key: m.key, value: m.value, updated_at: m.updated_at }));
  }
  function deleteMemory(key) {
    data.memories = data.memories.filter((m) => m.key !== key);
    scheduleFlush();
  }

  /* ─── 代码项目（Code 工作台）─── */
  function createCodeProject(id, name, rootPath) {
    const now = ts();
    const row = { id: id || genId(), name: name || '未命名', rootPath: rootPath || '', created_at: now, updated_at: now };
    data.codeProjects.unshift(row);
    scheduleFlush();
    return row;
  }
  function getCodeProject(id) {
    return data.codeProjects.find((p) => p.id === id) || null;
  }
  function listCodeProjects() {
    return [...data.codeProjects].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }
  function deleteCodeProject(id) {
    data.codeProjects = data.codeProjects.filter((p) => p.id !== id);
    delete data.codeTabs[id];
    scheduleFlush();
  }
  function saveCodeTabs(projectId, tabsJson) {
    data.codeTabs[projectId] = tabsJson;
    scheduleFlush();
  }
  function getCodeTabs(projectId) {
    return data.codeTabs[projectId] || null;
  }

  /* ─── 知识库：手机模式诚实降级（返回空集，不报错也不造假数据）─── */
  const kbEmpty = {
    kbInsert: () => {},
    kbAll: () => [],
    kbCount: () => 0,
    kbClear: () => {},
    kbDeleteByPath: () => {},
    upsertKbEntry: () => {},
    listKbEntries: () => [],
    getKbEntryByTitle: () => null,
    deleteKbEntry: () => {},
    getKbEntry: () => null,
    kbBacklinks: () => [],
    kbNotebooks: () => [],
    kbSearchNotes: () => [],
  };

  function migrateFromLocalStorage(payload) {
    try {
      if (payload && Array.isArray(payload.sessions)) {
        for (const s of payload.sessions) {
          if (!s || !s.id) continue;
          if (!getSession(s.id)) createSession(s.id, s.title, s.project);
        }
      }
      if (payload && payload.messages && typeof payload.messages === 'object') {
        for (const [sid, msgs] of Object.entries(payload.messages)) {
          if (!Array.isArray(msgs)) continue;
          for (const m of msgs) {
            if (m && m.id && !data.messages.find((x) => x.id === m.id)) {
              addMessage(m.id, sid, m.role, m.content, m.thinking, m.tool_calls, m.tool_call_id, m.swarm);
            }
          }
        }
      }
      scheduleFlush();
    } catch (e) { /* 迁移失败保持现状 */ }
  }

  return {
    __jsondb: true,
    genId,
    createSession, getSession, listSessions, updateSession, deleteSession,
    addMessage, getMessages, deleteMessages, deleteMessagesAfter, updateMessage, getLastMessage, vacuumDb, messageCounts,
    setMemory, getMemory, getAllMemories, deleteMemory,
    setSetting, getSetting, getAllSettings,
    createCodeProject, getCodeProject, listCodeProjects, deleteCodeProject,
    saveCodeTabs, getCodeTabs,
    migrateFromLocalStorage,
    ...kbEmpty,
    // 兼容个别直接访问 db.db 的调用点
    db: { exec: () => {}, prepare: () => ({ run: () => {}, get: () => null, all: () => [] }) },
    flush,
  };
}

module.exports = { createJsonDb };
