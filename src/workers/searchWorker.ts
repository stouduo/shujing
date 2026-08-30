/// <reference lib="webworker" />
// 结果内搜索 Worker:大结果集的全表扫描移出主线程,避免输入卡顿
addEventListener('message', (e: MessageEvent) => {
  const { id, rows, keyword } = e.data as {
    id: number
    rows: (string | null)[][]
    keyword: string
  }
  const q = keyword.trim().toLowerCase()
  const matches: number[] = []
  if (q) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        const v = row[c]
        if (v !== null && v.toLowerCase().includes(q)) {
          matches.push(r)
          break
        }
      }
    }
  }
  ;(self as unknown as Worker).postMessage({ id, matches })
})
export {}
