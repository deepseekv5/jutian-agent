/**
 * ssePayloads 单元测试 —— 全站流式解析的唯一实现
 *
 * 纯函数用假 ReadableStream 驱动，不需要起服务。覆盖真实上游会遇到的形状：
 * 跨 chunk 拆行的 data、CRLF 行尾、同一事件多行 data 合并（SSE 规范）、
 * 无 data: 前缀的心跳/注释、event: 等字段行、带不带空格的 data:、
 * [DONE] 产出、EOF 冲刷、流尾无换行的残包不产出（与原各处实现一致）。
 */
import { describe, it, expect } from 'vitest'
import { ssePayloads } from '../src/shared/sse'

/** 把若干 Uint8Array 分片包成浏览器风格 ReadableStream */
function fakeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]))
      else controller.close()
    },
  })
}

async function collect(chunks: string[]): Promise<string[]> {
  const out: string[] = []
  for await (const p of ssePayloads(fakeStream(chunks))) out.push(p)
  return out
}

describe('ssePayloads', () => {
  it('解析单条完整 data 行', async () => {
    expect(await collect(['data: {"a":1}\n\n'])).toEqual(['{"a":1}'])
  })

  it('跨 chunk 拼回被拆开的行', async () => {
    // 同一行分两段送达（在引号后断开），必须拼成一个 payload，不能各吐半截
    expect(await collect(['data: {"x"', ':1}\n\n', 'data: {"y":2}\n\n'])).toEqual(['{"x":1}', '{"y":2}'])
  })

  it('兼容不带空格的 data: 前缀', async () => {
    expect(await collect(['data:{"k":0}\n\n'])).toEqual(['{"k":0}'])
  })

  it('跳过心跳与注释行，只产出 data', async () => {
    const got = await collect([': ping\n\n', 'data: real\n', '\n', 'data: second\n'])
    expect(got).toEqual(['real', 'second'])
  })

  it('产出 [DONE] 交由调用方决定终止', async () => {
    // 真实上游每个事件都以空行收尾，[DONE] 是独立事件
    expect(await collect(['data: a\n\n', 'data: [DONE]\n\n'])).toEqual(['a', '[DONE]'])
  })

  it('[DONE] 哨兵终止：哨兵之后的数据不再被消费（调用方 break 模式）', async () => {
    // 模拟 agentLoop / stream.ts 的消费方式：见 [DONE] 即 break，
    // 上游哨兵后仍推来的残余数据（断连前的尾巴）不应被处理
    const got: string[] = []
    let stopped = false
    for await (const p of ssePayloads(fakeStream(['data: 1\n\n', 'data: [DONE]\n\n', 'data: {"late":true}\n\n']))) {
      if (p === '[DONE]') { stopped = true; break }
      got.push(p)
    }
    expect(got).toEqual(['1'])
    expect(stopped).toBe(true)
  })

  it('[DONE] 带 CRLF 行尾同样能被识别', async () => {
    const got = await collect(['data: x\r\n\r\n', 'data: [DONE]\r\n\r\n'])
    expect(got).toEqual(['x', '[DONE]'])
  })

  it('流尾无换行的残包不产出（与原实现一致，不当完整行处理）', async () => {
    // 末行没有 \n，按约定留在 buffer 里不产出；'data: full\n' 是完整行，
    // 虽未等到空行，EOF 冲刷产出 —— 不少上游最后一个事件以单个 \n 结尾即断连
    expect(await collect(['data: full\n', 'data: tail'])).toEqual(['full'])
  })

  it('EOF 冲刷：只差空行未派发的完整事件在流结束时产出', async () => {
    expect(await collect(['data: last-event\n'])).toEqual(['last-event'])
  })

  it('空流产出零条', async () => {
    expect(await collect([])).toEqual([])
  })

  describe('CRLF 行尾（真实上游 / 各类代理会出现）', () => {
    it('事件与空行都用 \r\n 时正常产出', async () => {
      expect(await collect(['data: {"a":1}\r\n\r\n'])).toEqual(['{"a":1}'])
    })

    it('CRLF 与 LF 混流不串行', async () => {
      expect(await collect(['data: a\r\n\r\ndata: b\n\n'])).toEqual(['a', 'b'])
    })

    it('CRLF 下的注释心跳行被忽略', async () => {
      expect(await collect([': keepalive\r\n\r\n', 'data: real\r\n\r\n'])).toEqual(['real'])
    })
  })

  describe('同一事件多行 data 合并（SSE 规范：连续 data: 用 \\n 拼接）', () => {
    it('三行 data 合并为一个载荷', async () => {
      // 规范行为：空行前所有 data 行合成一个事件，行间以 \n 连接
      expect(await collect(['data: 1\ndata: 2\ndata: 3\n\n'])).toEqual(['1\n2\n3'])
    })

    it('网关把长 JSON 拆成两行 data：合并后 JSON.parse 可用', async () => {
      // 旧行为逐行吐半截 JSON，解析必败、数据被调用方 catch 静默吞掉
      const payloads = await collect(['data: {"a":\ndata: 1}\n\n'])
      expect(payloads).toEqual(['{"a":\n1}'])
      expect(JSON.parse(payloads[0])).toEqual({ a: 1 })
    })

    it('注释行出现在事件中间不截断 data 合并', async () => {
      // 事件内部穿插心跳注释行：只忽略注释，不派发、不拆事件
      expect(await collect(['data: {"a":\n: keepalive\ndata: 1}\n\n'])).toEqual(['{"a":\n1}'])
    })

    it('不同事件的 data 不串到一起', async () => {
      expect(await collect(['data: 1\ndata: 2\n\n', 'data: 3\n\n'])).toEqual(['1\n2', '3'])
    })
  })

  describe('非 data 字段行', () => {
    it('event: / id: 字段行被忽略，不影响 data 产出', async () => {
      expect(await collect(['event: message\ndata: x\nid: 42\nretry: 100\n\n'])).toEqual(['x'])
    })

    it('只有注释与 event: 字段的事件不产出空载荷', async () => {
      expect(await collect(['event: ping\n: hello\n\n'])).toEqual([])
    })
  })
})
