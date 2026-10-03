/**
 * NewProjectDialog —— 新建/导入项目（CODE-SPEC v1.0，居中弹窗）
 */
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { CMPrimaryBtn, CMInput } from './ui'

interface Props {
  onClose: () => void
  onCreateProject: (name: string, rootPath: string, openFile?: string) => void
}

export default function NewProjectDialog({ onClose, onCreateProject }: Props) {
  const { c } = useTheme()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const api = (window as any).electronAPI

  const pickDir = async () => {
    if (!api?.openFolderDialog) return
    const dirs: string[] = await api.openFolderDialog()
    if (dirs?.length) {
      setPath(dirs[0])
      if (!name) setName(dirs[0].split('/').pop() || '新项目')
    }
  }

  const create = () => {
    const p = path.trim()
    if (!p) return
    setBusy(true)
    onCreateProject(name.trim() || p.split('/').pop() || '新项目', p)
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: c.modalOverlay }} onClick={onClose}>
      <div className="w-[420px] rounded-2xl border glass-strong shadow-2xl animate-scale-in" style={{ borderColor: c.border }} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="h-12 flex items-center gap-2.5 px-5 border-b" style={{ borderColor: c.borderLight }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: c.accent }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke={c.accentText} strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          </div>
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: c.textHead }}>新建项目</span>
        </div>
        {/* 表单 */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium block" style={{ color: c.textSecondary }}>项目名称</label>
            <CMInput value={name} onChange={setName} placeholder="例如 my-app" c={c} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium block" style={{ color: c.textSecondary }}>项目目录</label>
            <div className="flex gap-2">
              <CMInput value={path} onChange={setPath} placeholder="/Users/用户名/项目路径" c={c} className="flex-1 font-mono" onKeyDown={e => e.key === 'Enter' && create()} />
              <button onClick={pickDir} className="h-9 px-3 rounded-lg text-[12px] font-medium shrink-0" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>选择…</button>
            </div>
            <p className="text-[10.5px]" style={{ color: c.textMuted }}>AI 的文件操作将限制在该目录及其子目录内。</p>
          </div>
        </div>
        {/* 操作 */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: c.borderLight }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px]" style={{ color: c.textSecondary }}>取消</button>
          <CMPrimaryBtn onClick={create} c={c} disabled={!path.trim() || busy}>{busy ? '创建中…' : '创建项目'}</CMPrimaryBtn>
        </div>
      </div>
    </div>
  )
}
