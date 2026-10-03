// Markdown Preview Panel — Right panel preview rendering
import { useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'

interface Props {
  content: string
}

/** Lightweight Markdown rendering */
function renderMarkdown(md: string): string {
  let html = md
    // Code block
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="cm-md-pre"><code class="cm-md-code">${escHtml(code.trim())}</code></pre>`
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="cm-md-inline">$1</code>')
    // Heading
    .replace(/^###### (.+)$/gm, '<h6 class="cm-md-h6">$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5 class="cm-md-h5">$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4 class="cm-md-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="cm-md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="cm-md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="cm-md-h1">$1</h1>')
    // Bold/Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Image
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" class="cm-md-img" />')
    // Link
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="cm-md-link">$1</a>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr class="cm-md-hr" />')
    // Unordered list
    .replace(/^[\-\*] (.+)$/gm, '<li class="cm-md-li">$1</li>')
    // Ordered list
    .replace(/^\d+\. (.+)$/gm, '<li class="cm-md-li">$1</li>')
    // Quote
    .replace(/^> (.+)$/gm, '<blockquote class="cm-md-quote">$1</blockquote>')
    // Wrap consecutive <li>
    .replace(/(<\/li>\n<li)/g, '</li><li')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>)/g, (m) => {
      if (!m.includes('</li><li') && m.includes('</li>')) return m
      return '<ul class="cm-md-ul">' + m + '</ul>'
    })
    // Paragraph
    .replace(/^(?!<[a-z]).+/gm, (line) => {
      if (line.trim()) return `<p class="cm-md-p">${line}</p>`
      return ''
    })
    // Merge consecutive blockquotes
    .replace(/<\/blockquote>\s*<blockquote/g, '')
  return html
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function MarkdownPreview({ content }: Props) {
  const { c } = useTheme()
  const html = useMemo(() => renderMarkdown(content), [content])

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: c.bgCard, borderLeft: `1px solid ${c.borderLight}` }}>
      <style>{`
        .cm-md-h1 { font-size: 1.5em; font-weight: 700; margin: 0.8em 0 0.4em; border-bottom: 1px solid ${c.borderLight}; padding-bottom: 0.2em; }
        .cm-md-h2 { font-size: 1.3em; font-weight: 700; margin: 0.7em 0 0.35em; border-bottom: 1px solid ${c.borderLight}; padding-bottom: 0.15em; }
        .cm-md-h3 { font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .cm-md-h4 { font-size: 1.05em; font-weight: 600; margin: 0.5em 0 0.25em; }
        .cm-md-h5 { font-size: 0.95em; font-weight: 600; margin: 0.4em 0 0.2em; }
        .cm-md-h6 { font-size: 0.85em; font-weight: 600; margin: 0.3em 0 0.15em; color: ${c.textMuted}; }
        .cm-md-p { margin: 0.4em 0; font-size: 13px; line-height: 1.7; }
        .cm-md-code { background: ${c.bgInput}; padding: 2px 5px; border-radius: 3px; font-size: 12px; font-family: monospace; }
        .cm-md-pre { background: ${c.bgInput}; padding: 12px 14px; border-radius: 6px; overflow-x: auto; margin: 0.6em 0; }
        .cm-md-pre .cm-md-code { background: none; padding: 0; }
        .cm-md-inline { background: ${c.bgInput}; padding: 1px 4px; border-radius: 3px; font-size: 12px; font-family: monospace; }
        .cm-md-link { color: ${c.accent}; text-decoration: underline; }
        .cm-md-img { max-width: 100%; border-radius: 4px; margin: 0.4em 0; }
        .cm-md-hr { border: none; border-top: 1px solid ${c.borderLight}; margin: 0.8em 0; }
        .cm-md-ul { padding-left: 1.5em; margin: 0.3em 0; }
        .cm-md-li { font-size: 13px; line-height: 1.6; }
        .cm-md-quote { border-left: 3px solid ${c.accent}; padding-left: 12px; margin: 0.4em 0; color: ${c.textSecondary}; }
      `}</style>
      <div className="cm-md-preview" style={{ color: c.text }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
