/**
 * 巨天agent 品牌标识（v16.5.0 与新应用图标同源）
 * 穹弧 =「天」（巨天），四芒星 = AI 智能体（sparkle 语言）。
 * 弧线以 currentColor 绘制（浅色主题为近黑、深色主题为白）；
 * 未传 color 时星点用品牌绿渐变，传 color 则整体单色。
 */
interface Props {
  size?: number
  className?: string
  title?: string
  /** 描边颜色；不传则继承 currentColor（星点走品牌色），传入则整体单色 */
  color?: string
}

export default function BrandMark({ size = 32, className, title, color }: Props) {
  const ink = color || 'currentColor'
  const starFill = color ? ink : 'var(--brand, #10a37f)'
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{ flexShrink: 0, display: 'block' }}>
      {title ? <title>{title}</title> : null}
      {/* 主穹弧 + 副弧（弱化一层） */}
      <path d="M4 16.6 Q12 10.1 20 16.6" stroke={ink} strokeWidth={1.9} strokeLinecap="round" />
      <path d="M7.6 19.5 Q12 16.5 16.4 19.5" stroke={ink} opacity={0.38} strokeWidth={1.5} strokeLinecap="round" />
      {/* 四芒星：嵌在弧顶正上方 */}
      <path
        d="M12 2.7c.42 2.3 1.08 2.96 3.38 3.38-2.3.42-2.96 1.08-3.38 3.38-.42-2.3-1.08-2.96-3.38-3.38 2.3-.42 2.96-1.08 3.38-3.38z"
        fill={starFill}
      />
    </svg>
  )
}
