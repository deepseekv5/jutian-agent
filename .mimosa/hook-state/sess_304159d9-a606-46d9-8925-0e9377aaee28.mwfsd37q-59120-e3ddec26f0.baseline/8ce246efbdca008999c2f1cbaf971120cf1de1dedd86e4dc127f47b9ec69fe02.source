/**
 * ssePayloads 单元测试 —— 全站流式解析的唯一实现
 *
 * 纯函数用假 ReadableStream 驱动，不需要起服务。覆盖真实上游会遇到的形状：
 * 跨 chunk 拆行的 data、无 data: 前缀的心跳/注释、带不带空格的 data:、
 * [DONE] 产出、流尾无换行的残包不产出（与原各处实现一致）。
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
    expect(await collect(['data: {"x"', ':1}\n', 'data: {"y":2}\n'])).toEqual(['{"x":1}', '{"y":2}'])
  })

  it('兼容不带空格的 data: 前缀', async () => {
    expect(await collect(['data:{"k":0}\n'])).toEqual(['{"k":0}'])
  })

  it('跳过心跳与注释行，只产出 data', async () => {
    const got = await collect([': ping\n\n', 'data: real\n', '\n', 'data: second\n'])
    expect(got).toEqual(['real', 'second'])
  })

  it('产出 [DONE] 交由调用方决定终止', async () => {
    expect(await collect(['data: a\n', 'data: [DONE]\n'])).toEqual(['a', '[DONE]'])
  })

  it('流尾无换行的残包不产出（与原实现一致，不当完整行处理）', async () => {
    // 末行没有 \n，按约定留在 buffer 里不产出
    expect(await collect(['data: full\n', 'data: tail'])).toEqual(['full'])
  })

  it('空流产出零条', async () => {
    expect(await collect([])).toEqual([])
  })

  it('多行 data 同 chunk 一次送达', async () => {
    expect(await collect(['data: 1\ndata: 2\ndata: 3\n'])).toEqual(['1', '2', '3'])
  })
})
