/**
 * edge-tts.cjs —— Node 原生 Microsoft Edge TTS 客户端（v10.8.0）
 *
 * 动机：原 TTS 依赖打包的 python-runtime（arm64 专用），mac-x64 / Windows 上没有
 * 对应运行时，语音功能整端哑掉。本模块用纯 Node 实现 edge-tts 的 WebSocket 协议
 * （与 edge-tts python 包同一套握手与 DRM 令牌），零 python 依赖，随 app.asar
 * 分发到所有平台；更新包天然携带语音引擎。
 *
 * 协议要点（对齐 edge-tts python 实现）：
 * - Sec-MS-GEC：当前时间对齐 5 分钟窗口后转 100ns ticks，拼 TrustedClientToken
 *   取 SHA256 大写
 * - WSS 端点 speech.platform.bing.com，带 TrustedClientToken / Sec-MS-GEC / 版本
 * - 先发 speech.config（mp3 24kHz 输出），再发 SSML；二进制帧头 2 字节大端长度，
 *   Path:audio 的 payload 追加为音频，Path:turn.end 结束
 */
const crypto = require("crypto");
const WebSocket = require("ws");

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" +
  TRUSTED_CLIENT_TOKEN;
const VOICES_URL =
  "https://api.msedgeservices.com/tts/cognitiveservices/voices/list?TrustedClientToken=" +
  TRUSTED_CLIENT_TOKEN;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

let cachedVoices = null;
let cachedVoicesAt = 0;

/** Sec-MS-GEC DRM 令牌：时间对齐 5 分钟窗口 → 100ns ticks → SHA256 大写 */
function secMsGec() {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const strToHash = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash("sha256").update(strToHash, "ascii").digest("hex").toUpperCase();
}

/** edge-tts python 同款时间戳（服务端不严格校验，但保持同形） */
function edgeTimestamp() {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

/**
 * 合成语音 → mp3 Buffer
 * @param {string} text 待合成文本
 * @param {string} voice 音色，如 zh-CN-XiaoxiaoNeural
 * @param {number} speed 语速倍率（1.0 = +0%）
 * @returns {Promise<Buffer>}
 */
function splitText(text, max) {
  // 按句末标点切段（每段 ≤ max 字），保证语气自然断点
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i >= Math.floor(max * 0.6); i--) {
      if ('。！？；.!?;，,'.includes(rest[i - 1])) { cut = i; break; }
    }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out.length ? out : [text];
}

/** 单段合成（一条 WebSocket 连接） */
function synthOne(spokenRaw, voice, speed) {
  return new Promise((resolve, reject) => {
    const spoken = String(spokenRaw || "").trim();
    if (!spoken) { reject(new Error("缺少文本")); return; }
    const v = voice || "zh-CN-XiaoxiaoNeural";
    const ratePct = Math.round(((Number(speed) || 1) - 1) * 100);
    const rate = `+${ratePct >= 0 ? ratePct : ""}${ratePct}%`.replace("++", "+");
    const reqId = crypto.randomBytes(16).toString("hex");
    const url = `${WSS_URL}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    let ws;
    try {
      ws = new WebSocket(url, {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
          Cookie: `muid=${crypto.randomBytes(16).toString("hex").toUpperCase()};`,
        },
        handshakeTimeout: 15000,
      });
    } catch (e) { reject(e); return; }

    const chunks = [];
    let settled = false;
    const done = (err, buf) => {
      if (settled) return;
      settled = true;
      try { ws && ws.close(); } catch { /* 已关闭 */ }
      clearTimeout(guard);
      if (err) reject(err);
      else resolve(buf);
    };
    // 整体守卫：40s 未完成视为失败
    const guard = setTimeout(() => done(new Error("TTS 合成超时")), 40000);

    ws.on("open", () => {
      const configMsg =
        `X-Timestamp:${edgeTimestamp()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      ws.send(configMsg, (err2) => { if (err2) done(err2); });
      const lang = (v.match(/^([a-z]{2,3}-[A-Za-z]{2,})/) || [])[1] || "zh-CN";
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
        `<voice name='${v}'>` +
        `<prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${spoken.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]))}` +
        `</prosody></voice></speak>`;
      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${edgeTimestamp()}Z\r\n` +
        "Path:ssml\r\n\r\n" + ssml;
      ws.send(ssmlMsg, (err2) => { if (err2) done(err2); });
    });

    ws.on("message", (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!isBinary) {
        const textMsg = buf.toString("utf-8");
        if (textMsg.includes("Path:turn.end")) {
          if (chunks.length === 0) done(new Error("TTS 未返回音频"));
          else done(null, Buffer.concat(chunks));
        }
        return;
      }
      // 二进制帧：前 2 字节大端 header 长度
      const headerLen = buf.readUInt16BE(0);
      const headers = buf.slice(2, 2 + headerLen).toString("utf-8");
      if (headers.includes("Path:audio")) {
        chunks.push(buf.slice(2 + headerLen));
      }
    });

    ws.on("error", (e) => done(new Error(`TTS 连接失败: ${e.message}`)));
    ws.on("close", () => { if (!settled) done(new Error("TTS 连接提前关闭")); });
  });
}

/** 音色目录（缓存 1 小时） */
async function listVoices() {
  if (cachedVoices && Date.now() - cachedVoicesAt < 3600000) return cachedVoices;
  const res = await fetch(`${VOICES_URL}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`, {
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`音色目录 HTTP ${res.status}`);
  cachedVoices = await res.json();
  cachedVoicesAt = Date.now();
  return cachedVoices;
}

/**
 * 合成入口：长文按句切段并行合成（多连接同时跑），Buffer.concat 拼接。
 * mp3 帧独立，顺序拼接可直接播放。
 */
async function synthesize(text, voice, speed) {
  const clean = String(text || '').trim().slice(0, 6000);
  if (!clean) throw new Error('缺少文本');
  const segs = splitText(clean, 300);
  if (segs.length === 1) return synthOne(segs[0], voice, speed);
  const bufs = await Promise.all(segs.map((seg) => synthOne(seg, voice, speed)));
  return Buffer.concat(bufs);
}

module.exports = { synthesize, listVoices, secMsGec };
