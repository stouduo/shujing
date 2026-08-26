/**
 * 导出文件名统一生成:
 * - 清洗文件系统非法字符(表名/查询名可能来自用户输入)
 * - 追加秒级时间戳,重复导出不静默覆盖
 */
export function exportFileName(base: string | undefined | null, ext: string): string {
  const safe = (base || '').replace(/[/\\:*?"<>|]/g, '_').trim() || 'result'
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ts =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${safe}_${ts}.${ext}`
}
