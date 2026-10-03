/**
 * ErrorBoundary —— 渲染错误兜底：任何组件崩溃不再白屏
 */
import React from 'react'

interface State { error: Error | null; stack?: string; componentStack?: string }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  state2: State = { error: null, stack: '', componentStack: '' }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.setState({ stack: (error && error.stack) || '', componentStack: info.componentStack || '' })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#ffffff', color: '#0d0d0d', fontFamily: '-apple-system, sans-serif' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>界面出现了一点问题</div>
          <div style={{ fontSize: 12, color: '#8e8e93', maxWidth: 420, textAlign: 'center', lineHeight: 1.6, wordBreak: 'break-all' }}>
            {this.state.error.message || String(this.state.error)}
          </div>
          <details style={{ maxWidth: 560, width: '90%' }}>
            <summary style={{ fontSize: 11, color: '#b0b0b6', cursor: 'pointer', textAlign: 'center', padding: '4px 0' }}>堆栈详情（请复制给开发者）</summary>
            <pre style={{ fontSize: 10, color: '#8e8e93', background: '#f5f5f7', borderRadius: 8, padding: 10, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', textAlign: 'left' }}>{this.state.stack || '(无堆栈)'}</pre>
            {this.state.componentStack && <pre style={{ fontSize: 9, color: '#b0b0b6', background: '#fafafa', borderRadius: 8, padding: 8, maxHeight: 100, overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'left' }}>{this.state.componentStack}</pre>}
          </details>
          <button onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{ padding: '8px 24px', borderRadius: 10, border: '1px solid #e5e5e5', background: '#0d0d0d', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
