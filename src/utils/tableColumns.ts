import type { SortField, SortFieldType } from './sortUtils'
import type { SearchColumn } from '../components/ui/DataControlsBar'

export interface TableColumnDef<T = unknown> {
  key: string
  label: string
  /** Custom value extractor. Falls back to row[key]. */
  accessor?: (row: T) => unknown
  /** If set, column participates in sort. */
  sortType?: SortFieldType
  /** Shows in primary sort list vs "More fields". */
  primary?: boolean
  /** Exclude from search dropdown and 'all' search. */
  noSearch?: boolean
}

export function deriveSortFields<T>(cols: TableColumnDef<T>[]): SortField[] {
  return cols
    .filter(c => c.sortType != null)
    .map(c => ({ key: c.key, label: c.label, type: c.sortType!, primary: c.primary }))
}

export function deriveSearchCols<T>(cols: TableColumnDef<T>[]): SearchColumn[] {
  const searchable = cols.filter(c => !c.noSearch)
  return [
    { key: 'all', label: 'All Columns' },
    ...searchable.map(c => ({ key: c.key, label: c.label })),
  ]
}

export function getColSearchVal<T>(row: T, col: TableColumnDef<T>): string {
  try {
    const raw = col.accessor
      ? col.accessor(row)
      : (row as Record<string, unknown>)[col.key]
    if (raw == null) return ''
    return String(raw)
  } catch {
    return ''
  }
}

export function searchRows<T>(
  data: T[],
  cols: TableColumnDef<T>[],
  query: string,
  searchCol: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return data
  const searchableCols = cols.filter(c => !c.noSearch)
  if (searchCol === 'all') {
    return data.filter(row =>
      searchableCols.some(col => getColSearchVal(row, col).toLowerCase().includes(q))
    )
  }
  const col = searchableCols.find(c => c.key === searchCol)
  if (!col) return data
  return data.filter(row => getColSearchVal(row, col).toLowerCase().includes(q))
}
