/**
 * ErrorBoundary —— 渲染错误兜底：任何组件崩溃不再白屏
 *
 * 两种用法：
 *  - 根级（App 外壳）：inline=false，占满视口，提供「重新加载」整页恢复
 *  - tab 级（PageShell 面板体）：inline=true，只占面板区域，
 *    提供「重试」局部恢复，单个面板崩掉不影响侧栏与其他标签页
 * 颜色全部走 index.css 的主题变量，暗色主题下不会变成刺眼的白屏。
 */
import React from 'react'
import { fetchCompat } from '../api'

interface State { error: Error | null; stack?: string; componentStack?: string }

interface Props {
  children: React.ReactNode
  /** 面板内嵌模式：占满父容器而非整个视口 */
  inline?: boolean
  /** 变化时自动清除错误状态（例如切换标签页后重进同一面板应恢复） */
  resetKey?: string
  /** 局部兜底说明，缺省用通用文案 */
  label?: string
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }
  /** 同一挂载周期内的重试次数：崩溃原因未消失时重试会立刻再崩，需要引导用户换出路 */
  private retryCount = 0

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    // resetKey 变化（典型：切换到别的标签页）时清掉错误，让面板恢复正常渲染
    if (this.props.resetKey !== prev.resetKey && this.state.error) {
      this.retryCount = 0
      this.setState({ error: null, stack: '', componentStack: '' })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.setState({ stack: (error && error.stack) || '', componentStack: info.componentStack || '' })
    // 上报到服务端（诊断页可见）：用户报障时只写 console 等于没有线索
    try {
      fetchCompat('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || String(error),
          stack: error?.stack || '',
          componentStack: info.componentStack || '',
          url: location.href,
        }),
      }).catch(() => { /* 上报失败不影响兜底 UI */ })
    } catch { /* ignore */ }
  }

  private retry = () => {
    // 局部重试：只清错误状态，不动页面其他部分。
    // 若崩溃原因未消失（如某条消息数据损坏），重试会立刻再崩——
    // 界面看起来"点了没反应"。计数到 2 次后提示改用重新加载。
    this.retryCount++
    this.setState({ error: null, stack: '', componentStack: '' })
  }

  render() {
    if (this.state.error) {
      const { inline, label } = this.props
      return (
        <div style={{
          height: inline ? '100%' : '100vh',
          minHeight: inline ? 200 : undefined,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, padding: inline ? 24 : 0,
          background: 'var(--surface-alt, #f9f9f9)', color: 'var(--text, #0d0d0d)',
          fontFamily: '-apple-system, sans-serif',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-head, #0d0d0d)' }}>
            {label || '这个面板出现了一点问题'}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-secondary, #5d5d5d)', maxWidth: 420, textAlign: 'center',
            lineHeight: 1.6, wordBreak: 'break-all',
          }}>
            {this.state.error.message || String(this.state.error)}
          </div>
          <details style={{ maxWidth: 560, width: '90%' }}>
            <summary style={{
              fontSize: 11, color: 'var(--text-muted, #b4b4b4)', cursor: 'pointer',
              textAlign: 'center', padding: '4px 0',
            }}>堆栈详情（请复制给开发者）</summary>
            <pre style={{
              fontSize: 10, color: 'var(--text-secondary, #5d5d5d)', background: 'var(--surface-input, #f4f4f4)',
              borderRadius: 8, padding: 10, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all', textAlign: 'left',
            }}>{this.state.stack || '(无堆栈)'}</pre>
            {this.state.componentStack && (
              <pre style={{
                fontSize: 9, color: 'var(--text-muted, #b4b4b4)', background: 'var(--surface-input, #f4f4f4)',
                borderRadius: 8, padding: 8, maxHeight: 100, overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'left',
              }}>{this.state.componentStack}</pre>
            )}
          </details>
          {this.retryCount >= 2 && (
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #5d5d5d)', maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
              重试后仍出现同样问题，说明不是临时故障。建议「重新加载」；
              若仍无法恢复，可在设置 → 关于 → 环境诊断中复制报告反馈。
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={this.retry}
              style={{
                padding: '8px 20px', borderRadius: 10, border: '1px solid var(--border, #e5e5e5)',
                background: 'var(--surface, #ffffff)', color: 'var(--text, #0d0d0d)', fontSize: 13, cursor: 'pointer',
              }}>
              重试
            </button>
            <button onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px', borderRadius: 10, border: 'none',
                background: 'var(--text, #0d0d0d)', color: 'var(--surface, #ffffff)', fontSize: 13, cursor: 'pointer',
              }}>
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
