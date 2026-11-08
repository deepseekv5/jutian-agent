import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

/**
 * 新手引导（v14.15.0）：聚光灯式分步引导，首次启动自动出现。
 * 步骤高亮真实 DOM（box-shadow 挖洞），完成/跳过落 localStorage。
 * 再看入口：设置 → 关于「重看新手引导」。
 */

export const TOUR_KEY = 'lyclaw_tour_done'

interface Step {
  /** 目标元素选择器；为空则居中展示 */
  selector?: string
  title: string
  titleEn: string
  text: string
  textEn: string
}

const STEPS: Step[] = [
  {
    title: '欢迎使用巨天agent',
    titleEn: 'Welcome to Jutian Agent',
    text: '本地优先的 AI 工作台：对话、写作、编程、调研、公文，数据不出本机。30 秒看完关键入口。',
    textEn: 'A local-first AI workbench: chat, writing, coding, research and official docs. 30 seconds to the key spots.',
  },
  {
    selector: '[title*="推理"]',
    title: '第一步：配置模型',
    titleEn: 'Step 1 · Configure a model',
    text: '设置 → 推理：填任意 OpenAI 兼容服务（DeepSeek/Kimi/GLM/本地 Ollama 都行），或一键启用免费模型。',
    textEn: 'Settings → Inference: any OpenAI-compatible service, or one-click free models.',
  },
  {
    selector: '[aria-label="工具 · 模式 · 模型"]',
    title: '第二步：输入框的秘密',
    titleEn: 'Step 2 · The composer',
    text: '+ 菜单里集中了目标/调研/计划/权限与联网/公文/画画/集群等全部能力；直接输入 / 也能唤起命令。',
    textEn: 'The + menu holds goals, research, plan, permissions, web, official-doc, painting, swarm… or type / for commands.',
  },
  {
    selector: '[title*="搜索标题"]',
    title: '第三步：找得到历史',
    titleEn: 'Step 3 · Find anything',
    text: '侧栏搜索覆盖全部会话标题与消息正文，命中可直接跳转高亮。',
    textEn: 'Sidebar search covers every title and message, with jump-to-highlight.',
  },
  {
    selector: '[title*="知识库：文档索引"]',
    title: '第四步：更多工作台',
    titleEn: 'Step 4 · Workbenches',
    text: '通话、AI 角色、集群指挥室、代码模式、知识库、免费模型都在侧栏；终端里还有 jtcode（Claude Code 式 CLI）。',
    textEn: 'Voice, personas, swarm, code, knowledge base and free models live in the sidebar; jtcode brings it to your terminal.',
  },
]

export function shouldShowTour(): boolean {
  try { return localStorage.getItem(TOUR_KEY) !== '1' } catch { return false }
}
export function markTourDone(): void {
  try { localStorage.setItem(TOUR_KEY, '1') } catch {}
}

export default function OnboardingTour({ onDone }: { onDone: () => void }) {
  const { c } = useTheme()
  const { t, lang } = useLanguage()
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const step = STEPS[idx]

  const measure = useCallback(() => {
    if (!step.selector) { setRect(null); return }
    try {
      const el = document.querySelector(step.selector) as HTMLElement | null
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ x: r.x, y: r.y, w: r.width, h: r.height })
    } catch { setRect(null) }
  }, [step])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const finish = () => { markTourDone(); onDone() }
  const next = () => { idx + 1 >= STEPS.length ? finish() : setIdx(idx + 1) }

  // 弹层位置：目标下方优先，放不下放上方；无目标居中
  const boxW = 380
  let bx = Math.max(16, Math.min((window.innerWidth - boxW) / 2, window.innerWidth - boxW - 16))
  let by = window.innerHeight / 2 - 130
  if (rect) {
    const below = rect.y + rect.h + 12
    by = below + 300 < window.innerHeight ? below : Math.max(12, rect.y - 312)
    bx = Math.max(16, Math.min(rect.x + rect.w / 2 - boxW / 2, window.innerWidth - boxW - 16))
  }

  return (
    <div className="fixed inset-0 z-[90]" style={{ pointerEvents: 'auto' }}>
      {/* 聚光灯：四块遮罩挖出目标区域 */}
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0" style={{ height: rect.y, background: 'rgba(15,12,8,.55)', pointerEvents: 'none' }} />
          <div className="absolute inset-x-0" style={{ top: rect.y + rect.h, bottom: 0, background: 'rgba(15,12,8,.55)', pointerEvents: 'none' }} />
          <div className="absolute left-0" style={{ top: rect.y, height: rect.h, width: rect.x, background: 'rgba(15,12,8,.55)', pointerEvents: 'none' }} />
          <div className="absolute" style={{ top: rect.y, left: rect.x + rect.w, height: rect.h, right: 0, background: 'rgba(15,12,8,.55)', pointerEvents: 'none' }} />
          <div className="absolute rounded-xl pointer-events-none" style={{ top: rect.y - 6, left: rect.x - 6, width: rect.w + 12, height: rect.h + 12, boxShadow: `0 0 0 2.5px ${c.accent}, 0 8px 40px rgba(0,0,0,.3)`, transition: 'all .25s ease' }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: 'rgba(15,12,8,.55)' }} />
      )}

      {/* 说明卡 */}
      <div className="absolute rounded-2xl border glass-strong p-4 animate-fade-in"
        style={{ top: by, left: bx, width: boxW, borderColor: c.border, pointerEvents: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.accentBg, color: c.accent }}>
            {idx + 1} / {STEPS.length}
          </span>
          <button onClick={finish} className="text-[11px] px-2 py-0.5 rounded-lg" style={{ color: c.textTertiary }}>
            {t('跳过', 'Skip')}
          </button>
        </div>
        <div className="text-[15px] font-semibold mb-1" style={{ color: c.textHead }}>{lang === 'en' ? step.titleEn : step.title}</div>
        <div className="text-[12.5px] leading-relaxed mb-3" style={{ color: c.textSecondary }}>{lang === 'en' ? step.textEn : step.text}</div>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === idx ? c.accent : c.border }} />
            ))}
          </div>
          <div className="flex gap-1.5">
            {idx > 0 && (
              <button onClick={() => setIdx(idx - 1)} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textSecondary, border: `1px solid ${c.border}` }}>
                {t('上一步', 'Back')}
              </button>
            )}
            <button onClick={next} className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>
              {idx + 1 >= STEPS.length ? t('开始使用', 'Get started') : t('下一步', 'Next')}
            </button>
          </div>
        </div>
      </div>

      {/* 点击遮罩不关闭（防误触跳过），Esc 跳过 */}
      <EscSkip onSkip={finish} />
    </div>
  )
}

function EscSkip({ onSkip }: { onSkip: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkip() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onSkip])
  return null
}
