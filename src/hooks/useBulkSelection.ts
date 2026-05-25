import { useState, useEffect, useRef, useCallback } from 'react'

export function useBulkSelection<T extends { id: string }>(rows: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const headerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!headerRef.current) return
    const all  = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
    const some = rows.some(r => selectedIds.has(r.id))
    headerRef.current.checked       = all
    headerRef.current.indeterminate = some && !all
  }, [selectedIds, rows])

  const toggleRow = useCallback((id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      prev.has(id) ? next.delete(id) : next.add(id)
      return next
    }), [])

  const clearAll      = useCallback(() => setSelectedIds(new Set()), [])
  const selectAllRows = useCallback(() => setSelectedIds(new Set(rows.map(r => r.id))), [rows])
  const allSelected   = rows.length > 0 && rows.every(r => selectedIds.has(r.id))

  return { selectedIds, setSelectedIds, toggleRow, clearAll, selectAllRows, allSelected, headerRef }
}
