import { useState } from 'react'

const MISSING_COL_RE = /Could not find (?:the ')?(\w+)'? column/

export function useBulkDeleteAction(deleteFn: (id: string) => Promise<void>) {
  const [loading, setLoading] = useState(false)

  const execute = async (ids: string[]): Promise<{ failed: number; total: number }> => {
    setLoading(true)
    let failed = 0
    for (const id of ids) {
      try { await deleteFn(id) } catch { failed++ }
    }
    setLoading(false)
    return { failed, total: ids.length }
  }

  return { execute, loading }
}

export function useBulkUpdateAction(
  updateFn: (params: { id: string; updates: Record<string, unknown> }) => Promise<void>,
) {
  const [loading, setLoading] = useState(false)

  const execute = async (
    ids: string[],
    baseUpdates: Record<string, unknown>,
  ): Promise<{ failed: number; total: number; strippedCols: string[] }> => {
    setLoading(true)
    let failed = 0
    const strippedCols: string[] = []
    for (const id of ids) {
      const rowUpdates = Object.fromEntries(
        Object.entries(baseUpdates).filter(([k]) => !strippedCols.includes(k))
      )
      try {
        await updateFn({ id, updates: rowUpdates })
      } catch (err: unknown) {
        const col = (err instanceof Error ? err.message : '').match(MISSING_COL_RE)?.[1]
        if (col && col in rowUpdates) {
          if (!strippedCols.includes(col)) strippedCols.push(col)
          const retryUpdates = Object.fromEntries(
            Object.entries(rowUpdates).filter(([k]) => k !== col)
          )
          try { await updateFn({ id, updates: retryUpdates }) } catch { failed++ }
        } else {
          failed++
        }
      }
    }
    setLoading(false)
    return { failed, total: ids.length, strippedCols }
  }

  return { execute, loading }
}
