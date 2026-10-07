import PageShell from '../app/PageShell'
import AboutContent from './AboutContent'

/** 独立关于页 = PageShell 外壳 + 共享内容(与设置 → 关于 tab 同一份) */
export default function AboutPage({ onClose }: { onClose: () => void; embedded?: boolean }) {
  return (
    <PageShell onClose={onClose} title="关于" description="版本信息、组件构成与更新日志" icon="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
      <div className="px-6 pb-6 max-w-lg">
        <AboutContent />
      </div>
    </PageShell>
  )
}
