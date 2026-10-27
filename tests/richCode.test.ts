import { describe, it, expect } from 'vitest'
import { isMermaidLang, isPreviewableHtml, extractCodeText } from '../src/renderer/utils/richCode'
import { hasMathSyntax, normalizeMathDelimiters } from '../src/renderer/chat/useMathPlugins'

// 富代码块判定：错判 mermaid/html 会把普通文本当图表/页面渲染，
// 漏判则高端特性不生效。公式语法探测控制 katex 是否值得加载。

describe('isMermaidLang', () => {
  it('mermaid 命中，大小写与空白宽容', () => {
    expect(isMermaidLang('mermaid')).toBe(true)
    expect(isMermaidLang(' Mermaid ')).toBe(true)
  })
  it('其他语言不命中', () => {
    expect(isMermaidLang('js')).toBe(false)
    expect(isMermaidLang('')).toBe(false)
    expect(isMermaidLang(undefined as any)).toBe(false)
  })
})

describe('isPreviewableHtml', () => {
  const doc = '<!DOCTYPE html><html><head><title>t</title></head><body><p>' + 'x'.repeat(300) + '</p></body></html>'
  it('完整文档命中', () => {
    expect(isPreviewableHtml('html', doc)).toBe(true)
  })
  it('<html 标签开头也可', () => {
    const d2 = '<html lang="zh">' + '<div>'.repeat(60) + '</div></html>'
    expect(isPreviewableHtml('html', d2)).toBe(true)
  })
  it('HTML 片段不给预览（无 doctype/html 标签）', () => {
    expect(isPreviewableHtml('html', '<div>' + 'x'.repeat(400) + '</div>')).toBe(false)
  })
  it('太短不给预览', () => {
    expect(isPreviewableHtml('html', '<!DOCTYPE html><html></html>')).toBe(false)
  })
  it('非 html 语言不命中', () => {
    expect(isPreviewableHtml('js', doc)).toBe(false)
  })
})

describe('hasMathSyntax', () => {
  it('块级公式 $$..$$ 命中', () => {
    expect(hasMathSyntax('质能方程 $$E = mc^2$$')).toBe(true)
  })
  it('\\(..\\) 与 \\[..\\] 命中', () => {
    expect(hasMathSyntax('行内 \\(a^2+b^2\\) 公式')).toBe(true)
    expect(hasMathSyntax('\\[\nE=mc^2\n\\]')).toBe(true)
  })
  it('单个 $ 价格符号不误判', () => {
    expect(hasMathSyntax('这件商品价格 $19.9，今天打折')).toBe(false)
  })
  it('普通文本不命中', () => {
    expect(hasMathSyntax('完全没有公式的普通中文消息')).toBe(false)
    expect(hasMathSyntax('')).toBe(false)
  })
})

describe('normalizeMathDelimiters', () => {
  it('\\(..\\) 转成 $..$', () => {
    expect(normalizeMathDelimiters('勾股 \\(a^2+b^2\\) 定理')).toBe('勾股 $a^2+b^2$ 定理')
  })
  it('\\[..\\] 转成 $$..$$', () => {
    expect(normalizeMathDelimiters('方程 \\[E=mc^2\\] 完')).toBe('方程 \n$$E=mc^2$$\n 完')
  })
  it('fence 内的 \\( 不转换（是代码）', () => {
    const src = '文字 \\(x^2\\) 然后\n```js\nconst s = "not math \\(keep\\)"\n```\n尾 \\(y^2\\)'
    const out = normalizeMathDelimiters(src)
    expect(out).toContain('const s = "not math \\(keep\\)"')
    expect(out).toContain('$x^2$')
    expect(out).toContain('$y^2$')
  })
  it('没有定界符时原样返回', () => {
    const src = '普通文本'
    expect(normalizeMathDelimiters(src)).toBe(src)
  })
})

describe('extractCodeText', () => {
  it('从 rehype-highlight 的嵌套元素树提取真文本', () => {
    const tree = { props: { children: [
      '<!DOCTYPE ',
      { props: { children: 'html' } },
      '><html>',
      { props: { children: ['<body>', { props: { children: 'hi' } }, '</body>'] } },
    ] } }
    expect(extractCodeText(tree)).toBe('<!DOCTYPE html><html><body>hi</body>')
  })
  it('纯字符串与空值安全', () => {
    expect(extractCodeText('plain')).toBe('plain')
    expect(extractCodeText(null)).toBe('')
    expect(extractCodeText(undefined)).toBe('')
    expect(extractCodeText(42)).toBe('42')
  })
})
