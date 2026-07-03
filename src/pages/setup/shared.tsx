import { Search, X } from 'lucide-react'

// ── Compact shared search + sort bar for Setup tabs ──────────────────────────────

export interface SortOpt { value: string; label: string }

export function SetupSearchSort({
  search, onSearch, sort, onSort, sortOptions, placeholder = 'Search…',
}: {
  search: string; onSearch: (s: string) => void
  sort: string;   onSort:   (v: string) => void
  sortOptions: SortOpt[]; placeholder?: string
}) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <select
        value={sort}
        onChange={e => onSort(e.target.value)}
        className="py-1.5 pl-2.5 pr-6 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white text-gray-700 sm:w-auto"
        aria-label="Sort order"
      >
        {sortOptions.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function applySetupSort<T>(data: T[], sort: string): T[] {
  const sep = sort.lastIndexOf('|')
  const key = sort.slice(0, sep)
  const dir = sort.slice(sep + 1)
  return [...data].sort((a, b) => {
    const av = String((a as Record<string, unknown>)[key] ?? '')
    const bv = String((b as Record<string, unknown>)[key] ?? '')
    const cmp = av.localeCompare(bv)
    return dir === 'asc' ? cmp : -cmp
  })
}

export const BANK_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

export const SPECIAL_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

export const TYPE_SORT_OPTS: SortOpt[] = [
  { value: 'name|asc',        label: 'Name A→Z' },
  { value: 'name|desc',       label: 'Name Z→A' },
  { value: 'created_at|desc', label: 'Newest' },
  { value: 'created_at|asc',  label: 'Oldest' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export const portionLabel = (p?: string): string => {
  if (!p || p === 'Percentage' || p === 'Percentage Allocation') return 'Regular Funds'
  return p
}
