export type SortFieldType = 'date' | 'numeric' | 'text'
export type SortDirection = 'asc' | 'desc'

export interface SortField<K extends string = string> {
  key: K
  label: string
  type: SortFieldType
  /** When true, shown in the main sort list. Non-primary fields go under "More Fields". */
  primary?: boolean
}

export interface AdvancedSortLevel {
  key: string
  dir: SortDirection
}

export function directionLabel(type: SortFieldType, dir: SortDirection): string {
  if (type === 'date') return dir === 'desc' ? 'Newest First' : 'Oldest First'
  if (type === 'numeric') return dir === 'desc' ? 'Highest First' : 'Lowest First'
  return dir === 'asc' ? 'A → Z' : 'Z → A'
}

export function defaultDirForType(type: SortFieldType): SortDirection {
  return type === 'text' ? 'asc' : 'desc'
}

function compareValues(
  aVal: string | number | null | undefined,
  bVal: string | number | null | undefined,
  type: SortFieldType,
  dir: SortDirection,
): number {
  if (aVal == null && bVal == null) return 0
  if (aVal == null) return 1
  if (bVal == null) return -1
  let cmp: number
  if (type === 'text') {
    cmp = String(aVal).localeCompare(String(bVal))
  } else if (type === 'date') {
    cmp = String(aVal).localeCompare(String(bVal))
  } else {
    cmp = Number(aVal) - Number(bVal)
  }
  return dir === 'asc' ? cmp : -cmp
}

export function sortRows<T>(
  data: T[],
  getValue: (item: T, key: string) => string | number | null | undefined,
  sortKey: string,
  sortDir: SortDirection,
  fields: SortField[],
): T[] {
  const field = fields.find(f => f.key === sortKey)
  if (!field) return data
  return [...data].sort((a, b) =>
    compareValues(getValue(a, sortKey), getValue(b, sortKey), field.type, sortDir)
  )
}

export function multiSortRows<T>(
  data: T[],
  getValue: (item: T, key: string) => string | number | null | undefined,
  levels: AdvancedSortLevel[],
  fields: SortField[],
): T[] {
  if (levels.length === 0) return data
  return [...data].sort((a, b) => {
    for (const level of levels) {
      const field = fields.find(f => f.key === level.key)
      if (!field) continue
      const cmp = compareValues(getValue(a, level.key), getValue(b, level.key), field.type, level.dir)
      if (cmp !== 0) return cmp
    }
    return 0
  })
}
