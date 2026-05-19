import { useState, useCallback } from 'react'
import type { SortDirection, AdvancedSortLevel } from '../utils/sortUtils'

export type DataViewMode = 'table' | 'cards'
export type { AdvancedSortLevel }

interface Options {
  storageKey: string
  defaultSortKey: string
  defaultSortDir: SortDirection
  defaultPageSize?: number
}

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function getDefaultView(storageKey: string): DataViewMode {
  const v = read(`${storageKey}:view`)
  if (v === 'table' || v === 'cards') return v
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    ? 'table' : 'cards'
}

export interface DataViewState {
  view: DataViewMode
  setView: (v: DataViewMode) => void
  sortKey: string
  sortDir: SortDirection
  setSort: (key: string, dir: SortDirection) => void
  page: number
  setPage: (p: number) => void
  pageSize: number
  setPageSize: (s: number) => void
  search: string
  setSearch: (s: string) => void
  searchCol: string
  setSearchCol: (col: string) => void
  advancedSort: AdvancedSortLevel[]
  setAdvancedSort: (levels: AdvancedSortLevel[]) => void
}

export function useDataViewState({
  storageKey,
  defaultSortKey,
  defaultSortDir,
  defaultPageSize = 25,
}: Options): DataViewState {
  const [view, _setView] = useState<DataViewMode>(() => getDefaultView(storageKey))
  const [sortKey, _setSortKey] = useState<string>(() => read(`${storageKey}:sk`) ?? defaultSortKey)
  const [sortDir, _setSortDir] = useState<SortDirection>(() => {
    const v = read(`${storageKey}:sd`)
    return (v === 'asc' || v === 'desc') ? v : defaultSortDir
  })
  const [page, _setPage] = useState(0)
  const [pageSize, _setPageSize] = useState<number>(() => {
    const v = read(`${storageKey}:ps`)
    const n = v ? parseInt(v, 10) : NaN
    return isNaN(n) ? defaultPageSize : n
  })
  const [search, _setSearch] = useState('')
  const [searchCol, _setSearchCol] = useState<string>(() => read(`${storageKey}:sc`) ?? 'all')
  const [advancedSort, _setAdvancedSort] = useState<AdvancedSortLevel[]>(() => {
    const stored = read(`${storageKey}:as`)
    if (!stored) return []
    try { return JSON.parse(stored) as AdvancedSortLevel[] } catch { return [] }
  })

  const setView = useCallback((v: DataViewMode) => {
    _setView(v)
    persist(`${storageKey}:view`, v)
    _setPage(0)
  }, [storageKey])

  const setSort = useCallback((key: string, dir: SortDirection) => {
    _setSortKey(key)
    _setSortDir(dir)
    persist(`${storageKey}:sk`, key)
    persist(`${storageKey}:sd`, dir)
    _setPage(0)
  }, [storageKey])

  const setPage = useCallback((p: number) => { _setPage(p) }, [])

  const setPageSize = useCallback((s: number) => {
    _setPageSize(s)
    persist(`${storageKey}:ps`, String(s))
    _setPage(0)
  }, [storageKey])

  const setSearch = useCallback((s: string) => {
    _setSearch(s)
    _setPage(0)
  }, [])

  const setSearchCol = useCallback((col: string) => {
    _setSearchCol(col)
    persist(`${storageKey}:sc`, col)
    _setPage(0)
  }, [storageKey])

  const setAdvancedSort = useCallback((levels: AdvancedSortLevel[]) => {
    _setAdvancedSort(levels)
    persist(`${storageKey}:as`, JSON.stringify(levels))
    _setPage(0)
  }, [storageKey])

  return {
    view, setView,
    sortKey, sortDir, setSort,
    page, setPage,
    pageSize, setPageSize,
    search, setSearch,
    searchCol, setSearchCol,
    advancedSort, setAdvancedSort,
  }
}
