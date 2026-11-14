/**
 * 短 ID 生成 —— 全站唯一实现
 *
 * 此前仓库里有 6 份一模一样的 uid()：时间戳 36 进制 + 随机尾，
 * 只有前缀与随机段长度不同。统一为 uid(prefix)，随机段固定 8 位，
 * 足以防撞（时间戳同毫秒内 36^8 ≈ 2.8 万亿种）。
 */
export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
