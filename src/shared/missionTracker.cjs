"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var missionTracker_exports = {};
__export(missionTracker_exports, {
  DEFAULT_MAX_ROUNDS: () => DEFAULT_MAX_ROUNDS,
  DEFAULT_PROJECT: () => DEFAULT_PROJECT,
  MAX_HISTORY: () => MAX_HISTORY,
  MAX_MILESTONE_NOTES: () => MAX_MILESTONE_NOTES,
  MAX_TRIED_NOTES: () => MAX_TRIED_NOTES,
  MissionTracker: () => MissionTracker,
  createMemoryStore: () => createMemoryStore,
  makeId: () => makeId
});
module.exports = __toCommonJS(missionTracker_exports);
const DEFAULT_MAX_ROUNDS = 20;
const DEFAULT_PROJECT = "";
const MAX_HISTORY = 200;
const MAX_TRIED_NOTES = 8;
const MAX_MILESTONE_NOTES = 60;
function makeId(prefix = "") {
  let uuid = "";
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") uuid = c.randomUUID();
  } catch {
    uuid = "";
  }
  const suffix = uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${suffix}` : suffix;
}
function asString(v) {
  return typeof v === "string" ? v : "";
}
function asNumber(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item === "string" && item.length > 0) out.push(item);
  }
  return out;
}
function asEnum(v, allowed, fallback) {
  return typeof v === "string" && allowed.includes(v) ? v : fallback;
}
const MISSION_STATUSES = ["active", "paused", "completed", "failed", "cancelled"];
const MILESTONE_STATUSES = ["pending", "in_progress", "done", "blocked"];
const HISTORY_KINDS = ["progress", "evaluate", "pause", "resume", "complete", "fail"];
function cloneMissions(missions) {
  return JSON.parse(JSON.stringify(missions));
}
function appendNote(target, note, now) {
  const text = note.trim();
  if (!text || target.notes.includes(text)) return;
  target.notes.push(text);
  if (target.notes.length > MAX_MILESTONE_NOTES) {
    target.notes.splice(0, target.notes.length - MAX_MILESTONE_NOTES);
  }
  target.updatedAt = now;
}
function appendSession(target, sessionId, now) {
  const id = sessionId.trim();
  if (!id || target.sessionIds.includes(id)) return false;
  target.sessionIds.push(id);
  target.updatedAt = now;
  return true;
}
function normalizeMission(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const id = asString(r.id);
  const goal = asString(r.goal);
  if (!id || !goal) return null;
  const now = Date.now();
  const rawMilestones = Array.isArray(r.milestones) ? r.milestones : [];
  const milestones = [];
  for (let i = 0; i < rawMilestones.length; i++) {
    const rm = rawMilestones[i];
    if (!rm || typeof rm !== "object" || Array.isArray(rm)) continue;
    const m = rm;
    const mid = asString(m.id);
    const title = asString(m.title);
    if (!mid || !title) continue;
    milestones.push({
      id: mid,
      title,
      status: asEnum(m.status, MILESTONE_STATUSES, "pending"),
      sessionIds: asStringArray(m.sessionIds),
      notes: asStringArray(m.notes),
      createdAt: asNumber(m.createdAt, now),
      updatedAt: asNumber(m.updatedAt, now)
    });
  }
  const rawHistory = Array.isArray(r.history) ? r.history : [];
  const history = [];
  for (const rh of rawHistory) {
    if (!rh || typeof rh !== "object" || Array.isArray(rh)) continue;
    const h = rh;
    history.push({
      at: asNumber(h.at, now),
      sessionId: asString(h.sessionId),
      kind: asEnum(h.kind, HISTORY_KINDS, "progress"),
      detail: asString(h.detail)
    });
  }
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  const currentMilestoneId = asString(r.currentMilestoneId);
  const rawMaxRounds = asNumber(r.maxRounds, DEFAULT_MAX_ROUNDS);
  const maxRounds = rawMaxRounds > 0 ? Math.max(1, Math.floor(rawMaxRounds)) : DEFAULT_MAX_ROUNDS;
  return {
    id,
    goal,
    status: asEnum(r.status, MISSION_STATUSES, "active"),
    project: asString(r.project) || DEFAULT_PROJECT,
    milestones,
    currentMilestoneId: currentMilestoneId && milestones.some((m) => m.id === currentMilestoneId) ? currentMilestoneId : null,
    rounds: Math.max(0, Math.floor(asNumber(r.rounds, 0))),
    maxRounds,
    lastNote: asString(r.lastNote),
    history,
    createdAt: asNumber(r.createdAt, now),
    updatedAt: asNumber(r.updatedAt, now)
  };
}
class MemoryMissionStore {
  data = [];
  load() {
    return cloneMissions(this.data);
  }
  save(missions) {
    this.data = cloneMissions(missions);
  }
}
function createMemoryStore() {
  return new MemoryMissionStore();
}
class MissionTracker {
  /** 内存中的唯一真相源 */
  missions = [];
  /** 实际使用的持久化后端 */
  store;
  /** 最近一次 save 是否失败：暴露给运维排查，不抛异常 */
  lastPersistError = null;
  constructor(store) {
    this.store = store || new MemoryMissionStore();
    try {
      const loaded = this.store.load();
      if (Array.isArray(loaded)) {
        const seen = /* @__PURE__ */ new Set();
        this.missions = [];
        for (let i = 0; i < loaded.length; i++) {
          const mission = normalizeMission(loaded[i]);
          if (!mission || seen.has(mission.id)) continue;
          seen.add(mission.id);
          this.missions.push(mission);
        }
      }
    } catch {
      this.missions = [];
    }
  }
  // ── 查询 ──────────────────────────────────────────────────
  /** 最近一次持久化失败的原因；从未失败则为 null */
  get persistError() {
    return this.lastPersistError;
  }
  /** 按 id 取任务；未知 id 返回 undefined */
  get(id) {
    return this.find(id);
  }
  /** 列出任务；传 status 则只返回该状态。返回的是内部引用，调用方不应直接改写 */
  list(status) {
    if (status === void 0) return this.missions.slice();
    return this.missions.filter((m) => m.status === status);
  }
  /** 统计概览：byStatus 固定包含 5 个键（即使计数为 0），便于 UI 直接渲染 */
  stats() {
    const byStatus = {};
    for (const s of MISSION_STATUSES) byStatus[s] = 0;
    let totalRounds = 0;
    for (const m of this.missions) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
      totalRounds += m.rounds;
    }
    return { total: this.missions.length, byStatus, totalRounds };
  }
  // ── 创建与里程碑 ──────────────────────────────────────────
  /** 创建任务；goal 为空仍允许创建（后续由接线层填指令），但会规整为字符串 */
  create(goal, opts) {
    const now = Date.now();
    const rawMax = opts?.maxRounds;
    const maxRounds = rawMax === void 0 ? DEFAULT_MAX_ROUNDS : Math.max(1, Math.floor(Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_ROUNDS));
    const mission = {
      id: makeId("mission"),
      goal: asString(goal),
      status: "active",
      project: asString(opts?.project) || DEFAULT_PROJECT,
      milestones: [],
      currentMilestoneId: null,
      rounds: 0,
      maxRounds,
      lastNote: "",
      history: [{
        at: now,
        sessionId: "",
        kind: "progress",
        detail: `\u4EFB\u52A1\u521B\u5EFA\uFF1A${asString(goal).slice(0, 120) || "\uFF08\u672A\u586B\u5199\u76EE\u6807\uFF09"}`
      }],
      createdAt: now,
      updatedAt: now
    };
    this.missions.push(mission);
    this.persist();
    return mission;
  }
  /** 新增里程碑，返回其 id；未知任务返回空串。第一个里程碑自动成为当前里程碑 */
  addMilestone(missionId, title) {
    const m = this.find(missionId);
    if (!m) return "";
    const now = Date.now();
    const cleanTitle = asString(title).trim();
    if (!cleanTitle) return "";
    const milestone = {
      id: makeId("ms"),
      title: cleanTitle,
      status: "pending",
      sessionIds: [],
      notes: [],
      createdAt: now,
      updatedAt: now
    };
    m.milestones.push(milestone);
    if (!m.currentMilestoneId) {
      m.currentMilestoneId = milestone.id;
      milestone.status = "in_progress";
    }
    m.updatedAt = now;
    this.persist();
    return milestone.id;
  }
  /** 修改里程碑状态并记录可选 note；未知任务 / 里程碑静默返回 */
  markMilestone(missionId, milestoneId, status, note) {
    const m = this.find(missionId);
    if (!m) return;
    const ms = m.milestones.find((x) => x.id === milestoneId);
    if (!ms) return;
    const now = Date.now();
    ms.status = asEnum(status, MILESTONE_STATUSES, "pending");
    if (note !== void 0) appendNote(ms, note, now);
    ms.updatedAt = now;
    m.updatedAt = now;
    this.persist();
  }
  /**
   * 关联会话到当前里程碑：去重；首次关联时补一条 progress 历史。
   * 没有当前里程碑时静默返回（任务还没拆步骤）。
   */
  linkSession(missionId, sessionId) {
    const m = this.find(missionId);
    if (!m) return;
    const cur = this.currentMilestone(m);
    if (!cur) return;
    const now = Date.now();
    if (!appendSession(cur, sessionId, now)) return;
    this.record(m, now, sessionId, "progress", `\u4F1A\u8BDD ${sessionId} \u5F00\u59CB\u63A8\u8FDB\u91CC\u7A0B\u7891\u300C${cur.title}\u300D`);
    m.updatedAt = now;
    this.persist();
  }
  // ── 核心状态机 ────────────────────────────────────────────
  /**
   * 推进一轮：吃进评估器结果，产出"继续 / 暂停 / 完成 / 失败"的决策。
   *
   * 状态转移：
   *   ok=false                       -> paused（评估器不可用，不盲目续跑）
   *   done=true 且无剩余里程碑        -> completed
   *   done=true 且有剩余里程碑        -> 切到下一个里程碑，继续
   *   done=false 且 rounds<maxRounds  -> 继续，附续跑指令（含已尝试路线）
   *   rounds>=maxRounds              -> failed（封顶）
   *
   * 注意：done=true 的那一轮也会计入 rounds；若刚好触顶且还有后续里程碑，
   * 任务仍判 failed，但已完成的里程碑与当前指针会保留，便于人工接手。
   */
  advance(missionId, sessionId, evaluation) {
    const m = this.find(missionId);
    if (!m) return this.noPlan("\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u9664");
    if (m.status !== "active") {
      return this.noPlan(`\u4EFB\u52A1\u5F53\u524D\u72B6\u6001\u4E3A ${m.status}\uFF0C\u65E0\u6CD5\u63A8\u8FDB`);
    }
    const now = Date.now();
    const ev = evaluation || { done: false, note: "", ok: false };
    const note = asString(ev.note).trim();
    const ok = !!ev.ok;
    const done = ok && !!ev.done;
    m.rounds += 1;
    m.updatedAt = now;
    m.lastNote = note;
    const cur = this.currentMilestone(m);
    if (cur) appendSession(cur, sessionId, now);
    const label = !ok ? "\u8BC4\u4F30\u4E0D\u53EF\u7528" : done ? "\u5B8C\u6210" : "\u672A\u5B8C\u6210";
    this.record(
      m,
      now,
      sessionId,
      "evaluate",
      `\u7B2C ${m.rounds} \u8F6E\u8BC4\u4F30\uFF08${label}\uFF09${note ? `\uFF1A${note}` : ""}`
    );
    if (!ok) {
      this.setStatus(m, "paused", now, sessionId, `\u8BC4\u4F30\u5668\u4E0D\u53EF\u7528\uFF0C\u4EFB\u52A1\u5DF2\u6682\u505C${note ? `\uFF1A${note}` : ""}`);
      return {
        shouldContinue: false,
        nextDirective: "",
        reason: "\u8BC4\u4F30\u5668\u4E0D\u53EF\u7528\uFF0C\u4EFB\u52A1\u5DF2\u6682\u505C\uFF0C\u9700\u4FEE\u590D\u540E\u624B\u52A8\u6062\u590D"
      };
    }
    if (done) {
      if (cur) {
        cur.status = "done";
        if (note) appendNote(cur, `\u5DF2\u5B8C\u6210\uFF1A${note}`, now);
        cur.updatedAt = now;
      }
      const next = m.milestones.find(
        (x) => x.id !== cur?.id && x.status !== "done"
      );
      if (!next) {
        this.setStatus(
          m,
          "completed",
          now,
          sessionId,
          note ? `\u76EE\u6807\u8FBE\u6210\uFF1A${note}` : "\u5168\u90E8\u91CC\u7A0B\u7891\u5DF2\u5B8C\u6210"
        );
        return {
          shouldContinue: false,
          nextDirective: "",
          reason: "\u76EE\u6807\u5DF2\u5B8C\u6210\uFF0C\u5168\u90E8\u91CC\u7A0B\u7891\u8FBE\u6210"
        };
      }
      m.currentMilestoneId = next.id;
      if (next.status !== "blocked") next.status = "in_progress";
      next.updatedAt = now;
      if (m.rounds >= m.maxRounds) {
        this.setStatus(
          m,
          "failed",
          now,
          sessionId,
          `\u5DF2\u63A8\u8FDB ${m.rounds} \u8F6E\uFF0C\u8FBE\u5230\u4E0A\u9650 ${m.maxRounds} \u8F6E`
        );
        return {
          shouldContinue: false,
          nextDirective: "",
          reason: "\u8FBE\u5230\u6700\u5927\u8F6E\u6B21\u4E0A\u9650\uFF0C\u4EFB\u52A1\u5DF2\u5931\u8D25\uFF08\u91CC\u7A0B\u7891\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF09"
        };
      }
      this.persist();
      return {
        shouldContinue: true,
        nextDirective: this.buildDirective(m),
        reason: "\u5F53\u524D\u91CC\u7A0B\u7891\u5B8C\u6210\uFF0C\u5DF2\u8FDB\u5165\u4E0B\u4E00\u91CC\u7A0B\u7891"
      };
    }
    if (cur && note) appendNote(cur, note, now);
    if (m.rounds >= m.maxRounds) {
      this.setStatus(
        m,
        "failed",
        now,
        sessionId,
        `\u5DF2\u63A8\u8FDB ${m.rounds} \u8F6E\uFF0C\u8FBE\u5230\u4E0A\u9650 ${m.maxRounds} \u8F6E`
      );
      return {
        shouldContinue: false,
        nextDirective: "",
        reason: "\u8FBE\u5230\u6700\u5927\u8F6E\u6B21\u4E0A\u9650\uFF0C\u4EFB\u52A1\u5DF2\u5931\u8D25"
      };
    }
    this.persist();
    return {
      shouldContinue: true,
      nextDirective: this.buildDirective(m),
      reason: "\u76EE\u6807\u5C1A\u672A\u5B8C\u6210\uFF0C\u9700\u7EE7\u7EED\u63A8\u8FDB"
    };
  }
  // ── 显式状态操作 ──────────────────────────────────────────
  /** 暂停：仅 active 可暂停。原因会写进历史 */
  pause(missionId, reason) {
    this.transition(missionId, "paused", reason || "\u4EFB\u52A1\u5DF2\u6682\u505C", ["active"]);
  }
  /**
   * 恢复：paused / failed 可恢复为 active。
   * paused -> active 保留累计轮次；failed -> active 视为人工续命，重置 rounds=0 给新预算，
   * 否则一个已经触顶的任务恢复后下一轮又会立刻失败，恢复动作将毫无意义。
   */
  resume(missionId, reason) {
    const m = this.find(missionId);
    if (!m) return;
    if (m.status !== "paused" && m.status !== "failed") return;
    const now = Date.now();
    const fromFailed = m.status === "failed";
    if (fromFailed) m.rounds = 0;
    this.setStatus(
      m,
      "active",
      now,
      "",
      reason || (fromFailed ? "\u4EFB\u52A1\u4ECE\u5931\u8D25\u6001\u6062\u590D\uFF0C\u8F6E\u6B21\u9884\u7B97\u5DF2\u91CD\u7F6E" : "\u4EFB\u52A1\u5DF2\u6062\u590D")
    );
  }
  /** 完成：仅 active / paused 可标记完成 */
  complete(missionId, reason) {
    this.transition(missionId, "completed", reason || "\u4EFB\u52A1\u5DF2\u624B\u52A8\u5B8C\u6210", ["active", "paused"]);
  }
  /** 取消：仅未终结的任务可取消（completed / cancelled 是终态） */
  cancel(missionId, reason) {
    this.transition(missionId, "cancelled", reason || "\u4EFB\u52A1\u5DF2\u53D6\u6D88", ["active", "paused", "failed"]);
  }
  // ── 展示 ──────────────────────────────────────────────────
  /** 生成给模型 / UI 的文本摘要：目标、状态、里程碑、轮次、最近 note 一目了然 */
  summary(missionId) {
    const m = this.find(missionId);
    if (!m) return "";
    const lines = [];
    lines.push(`\u3010\u4EFB\u52A1\u8FDB\u5EA6\u3011${m.id}`);
    lines.push(`\u76EE\u6807\uFF1A${m.goal || "\uFF08\u672A\u586B\u5199\uFF09"}`);
    lines.push(`\u72B6\u6001\uFF1A${m.status}${m.project ? ` | \u9879\u76EE\uFF1A${m.project}` : ""}`);
    lines.push(`\u8F6E\u6B21\uFF1A${m.rounds}/${m.maxRounds}`);
    lines.push(`\u91CC\u7A0B\u7891\uFF08${m.milestones.length}\uFF09\uFF1A`);
    if (m.milestones.length === 0) {
      lines.push("  \uFF08\u5C1A\u672A\u62C6\u5206\u91CC\u7A0B\u7891\uFF09");
    } else {
      m.milestones.forEach((ms, i) => {
        const sessions = ms.sessionIds.length ? ` | \u4F1A\u8BDD\uFF1A${ms.sessionIds.join(", ")}` : "";
        const current = ms.id === m.currentMilestoneId ? " <- \u5F53\u524D" : "";
        lines.push(`  ${i + 1}. [${ms.status}] ${ms.title}${sessions}${current}`);
      });
    }
    lines.push(`\u6700\u8FD1\u8BC4\u4F30\uFF1A${m.lastNote || "\uFF08\u6682\u65E0\uFF09"}`);
    lines.push(`\u5386\u53F2\u6761\u76EE\uFF1A${m.history.length}`);
    return lines.join("\n");
  }
  // ── 内部实现 ──────────────────────────────────────────────
  find(id) {
    if (!id) return void 0;
    return this.missions.find((m) => m.id === id);
  }
  currentMilestone(m) {
    if (!m.currentMilestoneId) return void 0;
    return m.milestones.find((x) => x.id === m.currentMilestoneId);
  }
  /** 统一的"无操作"返回值，保证 advance 的形状固定 */
  noPlan(reason) {
    return { shouldContinue: false, nextDirective: "", reason };
  }
  /** 环形缓冲写历史；超过上限时丢弃最旧的条目 */
  record(m, at, sessionId, kind, detail) {
    m.history.push({ at, sessionId, kind, detail });
    if (m.history.length > MAX_HISTORY) {
      m.history.splice(0, m.history.length - MAX_HISTORY);
    }
  }
  /**
   * 状态切换 + 历史记录 + 持久化。
   * kind 从目标状态推导：active 记为 resume，其余状态同名映射；
   * cancelled 没有专属 kind，归入 progress（历史类型清单里没有 cancel）。
   */
  setStatus(m, status, at, sessionId, detail) {
    m.status = status;
    m.updatedAt = at;
    const kind = status === "active" ? "resume" : status === "paused" ? "pause" : status === "completed" ? "complete" : status === "failed" ? "fail" : "progress";
    this.record(m, at, sessionId, kind, detail);
    this.persist();
  }
  /** 带前置状态校验的通用转移（pause / complete / cancel 共用） */
  transition(missionId, target, detail, allowedFrom) {
    const m = this.find(missionId);
    if (!m) return;
    if (!allowedFrom.includes(m.status)) return;
    this.setStatus(m, target, Date.now(), "", detail);
  }
  /**
   * 构造续跑指令：明确带上目标、当前里程碑、评估反馈以及"已尝试路线"，
   * 让新会话里的模型不会重复上一轮已经证明走不通的做法。
   */
  buildDirective(m) {
    const cur = this.currentMilestone(m);
    const title = cur ? cur.title : "\uFF08\u5C1A\u672A\u8BBE\u7F6E\u91CC\u7A0B\u7891\uFF09";
    const tried = cur ? cur.notes.slice(-MAX_TRIED_NOTES) : [];
    const lines = [];
    lines.push(`\u3010\u957F\u4EFB\u52A1\u7EED\u8DD1\u6307\u4EE4\u3011\u76EE\u6807\uFF1A${m.goal || "\uFF08\u672A\u586B\u5199\uFF09"}`);
    lines.push(`\u5F53\u524D\u91CC\u7A0B\u7891\uFF1A${title}`);
    lines.push(`\u8BC4\u4F30\u53CD\u9988\uFF1A${m.lastNote || "\uFF08\u8BC4\u4F30\u5668\u672A\u7ED9\u51FA\u8BF4\u660E\uFF09"}`);
    if (tried.length === 0) {
      lines.push("\u5DF2\u5C1D\u8BD5\u8DEF\u7EBF\uFF1A\u6682\u65E0\u8BB0\u5F55");
    } else {
      lines.push("\u5DF2\u5C1D\u8BD5\u8DEF\u7EBF\uFF08\u8BF7\u52FF\u91CD\u590D\uFF09\uFF1A");
      tried.forEach((note, i) => lines.push(`  ${i + 1}. ${note}`));
    }
    lines.push(
      `\u8F6E\u6B21\u8FDB\u5EA6\uFF1A${m.rounds}/${m.maxRounds}\u3002\u8BF7\u6362\u7528\u65B0\u8DEF\u7EBF\u63A8\u8FDB\u300C${title}\u300D\uFF0C\u672C\u8F6E\u987B\u7ED9\u51FA\u53EF\u9A8C\u8BC1\u7684\u5B9E\u9645\u4EA7\u51FA\u3002`
    );
    return lines.join("\n");
  }
  /**
   * 持久化：先做 JSON 往返快照再交给 store，避免外部 store 持有同一份引用后
   * 被后续内存修改意外污染。任何失败都吞掉并记录到 lastPersistError。
   */
  persist() {
    try {
      this.store.save(cloneMissions(this.missions));
      this.lastPersistError = null;
    } catch (err) {
      this.lastPersistError = err;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_PROJECT,
  MAX_HISTORY,
  MAX_MILESTONE_NOTES,
  MAX_TRIED_NOTES,
  MissionTracker,
  createMemoryStore,
  makeId
});
