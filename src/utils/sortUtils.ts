export type SortFieldType = 'date' | 'numeric' | 'text'
export type SortDirection = 'asc' | 'desc'

export interface SortField<K extends string = string> {
  key: K
  label: string
  type: SortFieldType
}

export function directionLabel(type: SortFieldType, dir: SortDirection): string {
  if (type === 'date') return dir === 'desc' ? 'Newest First' : 'Oldest First'
  if (type === 'numeric') return dir === 'desc' ? 'Highest First' : 'Lowest First'
  return dir === 'asc' ? 'A → Z' : 'Z → A'
}

export function defaultDirForType(type: SortFieldType): SortDirection {
  return type === 'text' ? 'asc' : 'desc'
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

  return [...data].sort((a, b) => {
    const aVal = getValue(a, sortKey)
    const bVal = getValue(b, sortKey)

    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1

    let cmp: number
    if (field.type === 'text') {
      cmp = String(aVal).localeCompare(String(bVal))
    } else if (field.type === 'date') {
      cmp = String(aVal).localeCompare(String(bVal))
    } else {
      cmp = Number(aVal) - Number(bVal)
    }

    return sortDir === 'asc' ? cmp : -cmp
  })
}
