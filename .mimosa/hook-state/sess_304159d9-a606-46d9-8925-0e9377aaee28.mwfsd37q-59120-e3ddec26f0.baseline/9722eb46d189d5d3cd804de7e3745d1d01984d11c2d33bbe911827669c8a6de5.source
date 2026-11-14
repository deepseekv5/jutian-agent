/**
 * SSE data 行解析 —— 全站唯一的流式响应切分实现
 *
 * 背景：此前 6 处各自手写「reader.read() → TextDecoder → 按 \n 切行 →
 * 找 data: 前缀 → slice/trim」，写法互有出入（'data:' 与 'data: '、
 * [DONE] 有的 break 有的 continue、半行有的跳过有的丢），
 * 任何一个边界 bug 都要在六处各修一遍。
 *
 * 语义（与原先各处行为等价）：
 *  - 只产出 data: 行的载荷字符串（已去掉前缀并 trim，兼容带不带空格两种写法）
 *  - 心跳、注释行、非 data: 行直接跳过；调用方对载荷自行 JSON.parse
 *  - [DONE] 也照常产出，由调用方决定 continue 还是 break（各家语义不同，不替调用方做主）
 *  - 流结束时最后一段无换行的残包不处理 —— 与原先所有实现一致
 *  - 提前 break 时取消底层读取，不把后续字节继续拉进内存
 *
 * 注：src/shared/jtcode-cli.mjs 是 node 直跑的独立 CLI（无构建步骤），
 * 引不了 .ts，它保留一份同语义的 14 行内联实现。
 */
export async function* ssePayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        yield line.slice(5).trim()
      }
    }
  } finally {
    // 调用方 break/return 提前退出时也把流收干净
    try { reader.cancel() } catch { /* 已结束 */ }
    try { reader.releaseLock() } catch { /* 已释放 */ }
  }
}
