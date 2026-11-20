/**
 * SSE data 行解析 —— 全站唯一的流式响应切分实现
 *
 * 背景：此前 6 处各自手写「reader.read() → TextDecoder → 按 \n 切行 →
 * 找 data: 前缀 → slice/trim」，写法互有出入（'data:' 与 'data: '、
 * [DONE] 有的 break 有的 continue、半行有的跳过有的丢），
 * 任何一个边界 bug 都要在六处各修一遍。
 *
 * 语义（v18.1.1 起对齐 WHATWG Server-Sent Events 规范）：
 *  - 事件以空行结束；同一事件里连续多行 data: 按规范用 \n 拼接成一个载荷。
 *    真实上游会出现：网关把长 JSON 拆成两行 data: 下发，逐行吐会导致
 *    JSON.parse 必败、整块数据被调用方的 catch 静默吞掉。
 *  - 行尾兼容 CRLF（\r\n）与 LF；注释行（: 开头的心跳）与 event:/id:/retry:
 *    等字段一律忽略。
 *  - 只产出 data: 行的载荷字符串（已去掉前缀并 trim，兼容带不带空格两种写法）；
 *    调用方对载荷自行 JSON.parse。
 *  - [DONE] 也照常产出，由调用方决定 continue 还是 break（各家语义不同，不替调用方做主）。
 *  - 流结束时：最后一段无换行的残包不处理（与原先所有实现一致）；但已收到完整行、
 *    只差一个空行未派发的事件在 EOF 冲刷产出 —— 严格按规范应丢弃，可现实中不少
 *    上游最后一个事件以单个 \n 结尾就断开连接，丢弃等于丢最后一个数据块
 *    （原逐行实现也不会丢，这里保持不丢）。
 *
 * 注：src/shared/jtcode-cli.mjs 是 node 直跑的独立 CLI（无构建步骤），
 * 引不了 .ts，它保留一份逐行切分的简化内联实现。
 */
export async function* ssePayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // 当前事件积攒的 data 行（SSE 规范：同一事件的多行 data 用 \n 拼接派发）
  let dataLines: string[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        // CRLF 兼容：按 LF 切行后去掉行尾残留的 \r
        const line = (raw.endsWith('\r') ? raw.slice(0, -1) : raw).trim()
        if (!line) {
          // 空行 = 事件边界：把该事件积攒的多行 data 合并派发
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n')
            dataLines = []
            yield payload
          }
          continue
        }
        if (line.startsWith(':')) continue // 注释 / 心跳行
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        // event: / id: / retry: 及未知字段：与 data 无关，忽略
      }
    }
    // EOF 冲刷：完整行已收到但没等到空行的事件 —— 产出最后一个数据块
    if (dataLines.length > 0) yield dataLines.join('\n')
  } finally {
    // 调用方 break/return 提前退出时也把流收干净
    try { reader.cancel() } catch { /* 已结束 */ }
    try { reader.releaseLock() } catch { /* 已释放 */ }
  }
}
