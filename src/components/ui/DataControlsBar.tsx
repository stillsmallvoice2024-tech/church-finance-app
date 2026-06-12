import { Search, X, ArrowUpDown, ChevronDown, Layers } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import type { SortField, SortDirection, AdvancedSortLevel } from '../../utils/sortUtils'
import { directionLabel, defaultDirForType } from '../../utils/sortUtils'
import type { DataViewMode } from '../../hooks/useDataViewState'
import { AdvancedSortModal } from './AdvancedSortModal'
import type { TableColumnDef } from '../../utils/tableColumns'
import { deriveSortFields, deriveSearchCols } from '../../utils/tableColumns'

export interface SearchColumn {
  key: string
  label: string
}

interface DataControlsBarProps {
  /** Unified column definitions — auto-derives both sortFields and searchColumns. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns?: TableColumnDef<any>[]
  /** Explicit sort fields. Ignored when `columns` is provided. */
  sortFields?: SortField[]
  sortKey: string
  sortDir: SortDirection
  onSort: (key: string, dir: SortDirection) => void
  view?: DataViewMode
  onViewChange?: (v: DataViewMode) => void
  search: string
  onSearchChange: (s: string) => void
  searchPlaceholder?: string
  /** Explicit search column list. Ignored when `columns` is provided. */
  searchColumns?: SearchColumn[]
  searchCol?: string
  onSearchColChange?: (col: string) => void
  // advanced multi-sort
  advancedSort?: AdvancedSortLevel[]
  onAdvancedSort?: (levels: AdvancedSortLevel[]) => void
  // clear sort
  defaultSortKey?: string
  defaultSortDir?: SortDirection
  // page size
  pageSize?: number
  onPageSizeChange?: (s: number) => void
  pageSizeOptions?: number[]
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

export function DataControlsBar({
  columns,
  sortFields: sortFieldsProp = [],
  sortKey, sortDir, onSort,
  view, onViewChange,
  search, onSearchChange, searchPlaceholder = 'Search…',
  searchColumns: searchColumnsProp, searchCol = 'all', onSearchColChange,
  advancedSort = [], onAdvancedSort,
  defaultSortKey, defaultSortDir,
  pageSize, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: DataControlsBarProps) {
  const sortFields = useMemo(
    () => (columns && columns.length > 0 ? deriveSortFields(columns) : sortFieldsProp),
    [columns, sortFieldsProp],
  )

  const searchColumns = useMemo(() => {
    if (columns && columns.length > 0) {
      return deriveSearchCols(columns)
    }
    return searchColumnsProp
  }, [columns, searchColumnsProp])
  const [sortOpen,       setSortOpen]       = useState(false)
  const [moreOpen,       setMoreOpen]       = useState(false)
  const [searchColOpen,  setSearchColOpen]  = useState(false)
  const [advModalOpen,   setAdvModalOpen]   = useState(false)

  const dropdownRef    = useRef<HTMLDivElement>(null)
  const searchColRef   = useRef<HTMLDivElement>(null)

  // outside-click for sort dropdown
  useEffect(() => {
    if (!sortOpen) return
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setSortOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey) }
  }, [sortOpen])

  // outside-click for search col dropdown
  useEffect(() => {
    if (!searchColOpen) return
    function onOutside(e: MouseEvent) {
      if (searchColRef.current && !searchColRef.current.contains(e.target as Node)) setSearchColOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setSearchColOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey) }
  }, [searchColOpen])

  // reset moreOpen when sort dropdown closes
  useEffect(() => { if (!sortOpen) setMoreOpen(false) }, [sortOpen])

  const activeField    = sortFields.find(f => f.key === sortKey)
  const activeSearchCol = searchColumns?.find(c => c.key === searchCol)
  const isAdvanced     = advancedSort.length > 0

  // primary vs more-fields split
  const hasPrimary   = sortFields.some(f => f.primary === true)
  const primaryFields = hasPrimary ? sortFields.filter(f => f.primary === true) : sortFields
  const moreFields   = hasPrimary ? sortFields.filter(f => !f.primary) : []

  const isSortActive = defaultSortKey != null && (
    sortKey !== defaultSortKey || sortDir !== defaultSortDir || isAdvanced
  )

  function handleClearSort() {
    if (defaultSortKey && defaultSortDir) onSort(defaultSortKey, defaultSortDir)
    onAdvancedSort?.([])
    setSortOpen(false)
  }

  function renderSortField(f: SortField) {
    const isSelected = !isAdvanced && sortKey === f.key
    return (
      <button
        key={f.key}
        type="button"
        onClick={() => { if (!isSelected) { onSort(f.key, defaultDirForType(f.type)); setMoreOpen(false) } }}
        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors ${
          isSelected
            ? 'bg-primary/5 text-primary font-medium cursor-default'
            : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span>{f.label}</span>
        {isSelected && (
          <span className="text-xs text-primary/60 ml-3 shrink-0">{directionLabel(f.type, sortDir)}</span>
        )}
      </button>
    )
  }

  const sortButtonLabel = isAdvanced
    ? `Multi-Sort · ${advancedSort.length}`
    : activeField
      ? `${activeField.label} · ${directionLabel(activeField.type, sortDir)}`
      : 'Sort'

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">

      {/* Search row */}
      <div className="flex flex-1 min-w-0 items-stretch gap-0">

        {/* Column selector (optional) */}
        {searchColumns && searchColumns.length > 0 && (
          <div className="relative shrink-0" ref={searchColRef}>
            <button
              type="button"
              onClick={() => setSearchColOpen(o => !o)}
              className={`h-full flex items-center gap-1 px-2 py-1.5 text-xs border border-r-0 rounded-l-lg transition-colors whitespace-nowrap ${
                searchColOpen
                  ? 'border-primary/40 bg-primary/5 text-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{activeSearchCol?.key === 'all' || !activeSearchCol ? 'All' : activeSearchCol.label}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${searchColOpen ? 'rotate-180' : ''}`} />
            </button>

            {searchColOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-36 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden py-1">
                {searchColumns.map(col => (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => { onSearchColChange?.(col.key); setSearchColOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left ${
                      searchCol === col.key
                        ? 'bg-primary/5 text-primary font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {searchCol === col.key && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                    {searchCol !== col.key && <span className="w-1.5 h-1.5 shrink-0" />}
                    {col.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search input */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={
              searchColumns && searchColumns.length > 0
                ? (searchCol === 'all' || !activeSearchCol
                    ? 'Search all'
                    : `Search ${activeSearchCol.label.toLowerCase()}`)
                : searchPlaceholder
            }
            className={`w-full pl-8 pr-7 py-1 text-sm border border-gray-200 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors ${
              searchColumns && searchColumns.length > 0 ? 'rounded-r-lg' : 'rounded-lg'
            }`}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Controls cluster */}
      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">

        {/* Sort dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setSortOpen(o => !o)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 min-h-[40px] text-sm border rounded-lg transition-colors whitespace-nowrap ${
              sortOpen || isAdvanced
                ? 'border-primary/40 bg-primary/5 text-primary'
                : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {isAdvanced
              ? <Layers className="w-3.5 h-3.5 shrink-0" />
              : <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
            }
            <span className="hidden sm:inline text-xs">{sortButtonLabel}</span>
            <span className="sm:hidden text-xs">{isAdvanced ? 'Multi-Sort' : 'Sort'}</span>
          </button>

          {sortOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">

              {/* Clear sort (when active) */}
              {isSortActive && (
                <div className="px-3 pt-2.5 pb-1">
                  <button
                    type="button"
                    onClick={handleClearSort}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-danger transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Clear sort
                  </button>
                </div>
              )}

              {/* Multi-sort active banner */}
              {isAdvanced && (
                <div className="mx-3 mt-2 mb-1 px-2.5 py-1.5 bg-primary/5 rounded-lg">
                  <p className="text-xs text-primary font-medium">Multi-sort active · {advancedSort.length} levels</p>
                  <p className="text-xs text-primary/60 mt-0.5">
                    {advancedSort.map(l => sortFields.find(f => f.key === l.key)?.label ?? l.key).join(' → ')}
                  </p>
                </div>
              )}

              {/* Field selection */}
              {!isAdvanced && (
                <>
                  <div className="px-3 pt-2.5 pb-1">
                    <p className="text-xs font-semibold text-gray-500">Sort By</p>
                  </div>
                  <div className="pb-1">
                    {primaryFields.map(renderSortField)}
                  </div>

                  {/* More fields expandable */}
                  {moreFields.length > 0 && (
                    <div className="border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setMoreOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <span>More fields</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {moreOpen && (
                        <div className="pb-1">
                          {moreFields.map(renderSortField)}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Direction */}
              {!isAdvanced && activeField && (
                <div className="border-t border-gray-100 px-3 py-2.5">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Direction</p>
                  <div className="flex flex-col gap-0.5">
                    {(['desc', 'asc'] as SortDirection[]).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => { onSort(sortKey, d); setSortOpen(false) }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-left ${
                          sortDir === d
                            ? 'bg-primary/5 text-primary font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${sortDir === d ? 'bg-primary' : 'bg-gray-300'}`} />
                        {directionLabel(activeField.type, d)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Advanced sort (when callback provided) */}
              {onAdvancedSort && (
                <div className="border-t border-gray-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { setSortOpen(false); setAdvModalOpen(true) }}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {isAdvanced ? 'Edit advanced sort…' : 'Advanced sort…'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Page size selector */}
        {onPageSizeChange != null && pageSize != null && (
          <>
            <div className="h-4 w-px bg-gray-200 mx-0.5" aria-hidden="true" />
            <div className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
              <span className="hidden sm:inline">Rows:</span>
              <select
                value={pageSize}
                onChange={e => onPageSizeChange(parseInt(e.target.value, 10))}
                className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 min-h-[36px] bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {pageSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Subtle divider */}
        {view !== undefined && onViewChange && (
          <div className="h-4 w-px bg-gray-200 mx-0.5" aria-hidden="true" />
        )}

        {/* View toggle */}
        {view !== undefined && onViewChange && (
          <div role="group" aria-label="View mode" className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden">
            {(['table', 'cards'] as DataViewMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => onViewChange(mode)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  view === mode
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}
              >
                {mode === 'table' ? 'Table' : 'Cards'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Advanced Sort Modal */}
      {onAdvancedSort && (
        <AdvancedSortModal
          open={advModalOpen}
          onClose={() => setAdvModalOpen(false)}
          sortFields={sortFields}
          levels={advancedSort}
          onApply={levels => { onAdvancedSort(levels); if (levels.length > 0 && defaultSortKey) onSort(defaultSortKey, defaultSortDir ?? 'desc') }}
        />
      )}
    </div>
  )
}
