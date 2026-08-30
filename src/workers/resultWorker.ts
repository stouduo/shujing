/// <reference lib="webworker" />
// 结果二次加工 Worker:关键词筛选 + 列排序(纯函数 processRows 可被主线程/测试复用)
// 返回保留行号(indices),避免大数据拷贝

export interface ProcessRequest {
  id: number
  rows: (string | null)[][]
  /** 筛选关键词(空 = 不过滤) */
  keyword?: string
  /** 排序列索引(未指定 = 不排序) */
  sortCol?: number
  sortDir?: 'asc' | 'desc'
}

export interface ProcessResponse {
  id: number
  indices: number[]
}

/** 筛选 + 排序,返回保留行的原始下标(升序筛选,按需重排) */
export function processRows(
  rows: (string | null)[][],
  keyword: string,
  sortCol: number,
  sortDir: 'asc' | 'desc',
): number[] {
  const q = keyword.trim().toLowerCase()
  let indices: number[]
  if (q) {
    indices = []
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        const v = row[c]
        if (v !== null && v.toLowerCase().includes(q)) {
          indices.push(r)
          break
        }
      }
    }
  } else {
    indices = new Array(rows.length)
    for (let r = 0; r < rows.length; r++) indices[r] = r
  }
  if (sortCol >= 0 && indices.length > 1) {
    const dir = sortDir === 'desc' ? -1 : 1
    indices.sort((a, b) => {
      const x = rows[a][sortCol] ?? ''
      const y = rows[b][sortCol] ?? ''
      const nx = Number(x)
      const ny = Number(y)
      const cmp =
        x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)
          ? nx - ny
          : String(x).localeCompare(String(y), undefined, { numeric: true })
      return cmp * dir
    })
  }
  return indices
}

addEventListener('message', (e: MessageEvent) => {
  const d = e.data as ProcessRequest
  const indices = processRows(d.rows ?? [], d.keyword ?? '', d.sortCol ?? -1, d.sortDir ?? 'asc')
  ;(self as unknown as Worker).postMessage({ id: d.id, indices } satisfies ProcessResponse)
})
export {}
