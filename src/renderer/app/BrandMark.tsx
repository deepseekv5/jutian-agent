/**
 * 巨天agent 品牌标识 —— 白色极简
 * 纯字形「巨」，以 currentColor 绘制（浅色主题为近黑、深色主题为白），无渐变、无底板。
 */
interface Props {
  size?: number
  className?: string
  title?: string
  /** 描边颜色；不传则继承 currentColor */
  color?: string
}

export default function BrandMark({ size = 32, className, title, color }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{ flexShrink: 0, display: 'block' }}>
      {title ? <title>{title}</title> : null}
      {/* 宽扁方框（≈1.4:1）+ 中横 —— 构成「巨」 */}
      <path d="M6.4 8h11.2" />
      <path d="M17.6 8v8" />
      <path d="M6.4 16h11.2" />
      <path d="M6.4 8v8" />
      <path d="M6.4 12h11.2" />
    </svg>
  )
}
