/**
 * TTS 域（v13.8.2 自 serve.ts 抽出）
 *
 * 系统语音合成兜底（macOS say / Windows SAPI / Linux espeak 系）+
 * 多格式磁盘缓存。Edge TTS 主链路在 electron/edge-tts.cjs。
 * 依赖注入：execFile（进程执行）与 tmpDir（合成临时目录）由宿主传入。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TTS_CACHE_TYPES = [
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['wav', 'audio/wav'],
  ['aiff', 'audio/aiff'],
]

/** 缓存键：文本+音色+语速 */
function cacheKey(spoken, voice, speed) {
  return crypto.createHash('sha1').update(spoken + '|' + (voice || '') + '|' + (Number(speed) || 1)).digest('hex')
}

/** 查缓存：命中返回 { buf, mime }，未命中 null */
function cacheLookup(cacheDir, key) {
  try {
    for (const [ext, mime] of TTS_CACHE_TYPES) {
      const f = path.join(cacheDir, key + '.' + ext)
      if (fs.existsSync(f)) return { buf: fs.readFileSync(f), mime }
    }
  } catch { /* 读失败视为未命中 */ }
  return null
}

/** 写缓存（写失败不影响返回） */
function cacheStore(cacheDir, key, ext, buf) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, key + '.' + ext), buf)
  } catch { /* 只读环境跳过 */ }
}

/** 系统语音合成：按平台选择离线引擎，产出可直接播放的音频 */
async function osTtsSynthesize(text, voice, speed, execFile, tmpDir) {
  const execAsync = execFile // 注入的是 promisify 版（返回 { stdout, stderr }）
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* 已存在 */ }
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const rate = Math.max(0.5, Math.min(2, Number(speed) || 1));
  const clean = String(text || "").slice(0, 4000);
  try {
    if (process.platform === "darwin") {
      const aiff = path.join(tmpDir, stamp + ".aiff");
      const m4a = path.join(tmpDir, stamp + ".m4a");
      const v = /[\u4e00-\u9fff]/.test(clean) ? "Tingting" : "Samantha";
      await execAsync("say", ["-v", v, "-r", String(Math.round(180 * rate)), "-o", aiff, clean], { timeout: 60e3 });
      try {
        await execAsync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", aiff, m4a], { timeout: 60e3 });
        return { buf: fs.readFileSync(m4a), mime: "audio/mp4", ext: ".m4a" };
      } catch {
        return { buf: fs.readFileSync(aiff), mime: "audio/aiff", ext: ".aiff" };
      }
    }
    if (process.platform === "win32") {
      const wav = path.join(tmpDir, stamp + ".wav");
      const txt = path.join(tmpDir, stamp + ".txt");
      fs.writeFileSync(txt, clean, "utf-8");
      const q = (s) => s.replace(/'/g, "''");
      const ps = [
        "Add-Type -AssemblyName System.Speech;",
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
        `$s.Rate = ${Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))};`,
        `$s.SetOutputToWaveFile('${q(wav)}');`,
        `$s.Speak([IO.File]::ReadAllText('${q(txt)}', [Text.Encoding]::UTF8));`,
        "$s.Dispose();",
      ].join(" ");
      await execAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 90e3 });
      if (!fs.existsSync(wav)) throw new Error("系统语音未产出音频");
      return { buf: fs.readFileSync(wav), mime: "audio/wav", ext: ".wav" };
    }
    // Linux：espeak-ng → espeak → pico2wave
    const wav = path.join(tmpDir, stamp + ".wav");
    const speedArg = String(Math.round(175 * rate));
    for (const [bin, args] of [
      ["espeak-ng", ["-v", "zh", "-s", speedArg, "-w", wav]],
      ["espeak", ["-v", "zh", "-s", speedArg, "-w", wav]],
      ["pico2wave", ["-l", "zh-CN", "-w", wav]],
    ]) {
      try {
        await execAsync(bin, [...args, clean.slice(0, 2000)], { timeout: 60e3 });
        if (fs.existsSync(wav) && fs.statSync(wav).size > 1000) {
          return { buf: fs.readFileSync(wav), mime: "audio/wav", ext: ".wav" };
        }
      } catch { /* 试下一个引擎 */ }
    }
    throw new Error("没有可用的系统语音引擎（Linux 建议安装 espeak-ng）");
  } finally {
    try {
      for (const f of fs.readdirSync(tmpDir)) if (f.startsWith(stamp)) fs.unlinkSync(path.join(tmpDir, f));
    } catch { /* 清理失败不影响结果 */ }
  }
}

module.exports = { osTtsSynthesize, cacheKey, cacheLookup, cacheStore, TTS_CACHE_TYPES }
