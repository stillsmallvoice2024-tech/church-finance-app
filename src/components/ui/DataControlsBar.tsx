import { Search, X, ArrowUpDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { SortField, SortDirection } from '../../utils/sortUtils'
import { directionLabel, defaultDirForType } from '../../utils/sortUtils'
import type { DataViewMode } from '../../hooks/useDataViewState'

interface DataControlsBarProps {
  sortFields: SortField[]
  sortKey: string
  sortDir: SortDirection
  onSort: (key: string, dir: SortDirection) => void
  view?: DataViewMode
  onViewChange?: (v: DataViewMode) => void
  search: string
  onSearchChange: (s: string) => void
  searchPlaceholder?: string
}

export function DataControlsBar({
  sortFields, sortKey, sortDir, onSort,
  view, onViewChange,
  search, onSearchChange, searchPlaceholder = 'Search…',
}: DataControlsBarProps) {
  const [sortOpen, setSortOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sortOpen) return
    function onOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [sortOpen])

  const activeField = sortFields.find(f => f.key === sortKey)

  return (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
      {/* Search */}
      <div className="relative flex-1 min-w-0 w-full sm:w-auto">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
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

      <div className="flex items-center gap-2 shrink-0">
        {/* Sort dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setSortOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors whitespace-nowrap ${
              sortOpen
                ? 'border-primary/40 bg-primary/5 text-primary'
                : 'border-gray-200 text-gray-600 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline text-xs">
              {activeField ? `${activeField.label} · ${directionLabel(activeField.type, sortDir)}` : 'Sort'}
            </span>
            <span className="sm:hidden text-xs">Sort</span>
          </button>

          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="px-3 pt-3 pb-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Sort By</p>
              </div>
              <div className="pb-1">
                {sortFields.map(f => {
                  const isSelected = sortKey === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        if (!isSelected) onSort(f.key, defaultDirForType(f.type))
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary/5 text-primary font-medium cursor-default'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>{f.label}</span>
                      {isSelected && (
                        <span className="text-xs text-primary/60">{directionLabel(f.type, sortDir)}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {activeField && (
                <div className="border-t border-gray-100 px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Direction</p>
                  <div className="flex gap-1.5">
                    {(['desc', 'asc'] as SortDirection[]).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => { onSort(sortKey, d); setSortOpen(false) }}
                        className={`flex-1 text-xs py-1.5 px-2 rounded-lg border transition-colors ${
                          sortDir === d
                            ? 'bg-primary text-white border-primary font-medium'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {directionLabel(activeField.type, d)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* View toggle */}
        {view !== undefined && onViewChange && (
          <div
            role="group"
            aria-label="View mode"
            className="inline-flex items-center rounded-lg border border-gray-200 overflow-hidden text-sm font-medium"
          >
            {(['table', 'cards'] as DataViewMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => onViewChange(mode)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  view === mode
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {mode === 'table' ? 'Table' : 'Cards'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
