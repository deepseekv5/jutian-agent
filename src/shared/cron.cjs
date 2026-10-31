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
var cron_exports = {};
__export(cron_exports, {
  nextCronTime: () => nextCronTime,
  parseCron: () => parseCron,
  parseCronField: () => parseCronField,
  validateCron: () => validateCron
});
module.exports = __toCommonJS(cron_exports);
const RANGES = [
  [0, 59],
  // minute
  [0, 23],
  // hour
  [1, 31],
  // day of month
  [1, 12],
  // month
  [0, 7]
  // day of week (0/7 = Sunday，解析后统一成 0)
];
function parseCronField(field, min, max) {
  const out = /* @__PURE__ */ new Set();
  const f = String(field || "").trim();
  if (!f) return null;
  for (const part of f.split(",")) {
    const seg = part.trim();
    if (!seg) return null;
    let step = 1;
    let base = seg;
    const slash = seg.indexOf("/");
    if (slash >= 0) {
      base = seg.slice(0, slash);
      step = Number(seg.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) return null;
    }
    let lo;
    let hi;
    if (base === "*" || base === "") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(base);
      hi = slash >= 0 ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}
function parseCron(expr) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = [];
  for (let i = 0; i < 5; i++) {
    const s = parseCronField(parts[i], RANGES[i][0], RANGES[i][1]);
    if (!s) return null;
    sets.push(s);
  }
  if (sets[4].has(7)) {
    sets[4].delete(7);
    sets[4].add(0);
  }
  return {
    minutes: sets[0],
    hours: sets[1],
    days: sets[2],
    months: sets[3],
    weekdays: sets[4],
    domRestricted: parts[2].trim() !== "*",
    dowRestricted: parts[4].trim() !== "*"
  };
}
function nextCronTime(expr, from = /* @__PURE__ */ new Date()) {
  const f = parseCron(expr);
  if (!f) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (!f.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = f.days.has(d.getDate());
    const dowOk = f.weekdays.has(d.getDay());
    const dayOk = f.domRestricted && f.dowRestricted ? domOk || dowOk : f.domRestricted ? domOk : f.dowRestricted ? dowOk : true;
    if (!dayOk) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!f.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!f.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}
function validateCron(expr) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return "cron \u9700\u8981 5 \u6BB5\uFF1A\u5206 \u65F6 \u65E5 \u6708 \u5468\uFF08\u4F8B\uFF1A0 9 * * 1-5\uFF09";
  const f = parseCron(expr);
  if (!f) return "cron \u8868\u8FBE\u5F0F\u65E0\u6CD5\u89E3\u6790\uFF0C\u8BF7\u68C0\u67E5\u6570\u5B57\u8303\u56F4\u4E0E\u7B26\u53F7\uFF08\u652F\u6301 * , - /\uFF09";
  if (!nextCronTime(expr, /* @__PURE__ */ new Date())) return "\u8BE5\u8868\u8FBE\u5F0F\u6C38\u8FDC\u4E0D\u4F1A\u89E6\u53D1\uFF08\u4F8B\u5982 2 \u6708 30 \u65E5\uFF09";
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  nextCronTime,
  parseCron,
  parseCronField,
  validateCron
});
