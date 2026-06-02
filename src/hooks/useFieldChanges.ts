import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import type { AdvancedSortLevel } from '../utils/sortUtils'

export interface FieldChangeEntry {
  id:         string
  user_id:    string | null
  table_name: string
  record_id:  string
  field_name: string
  old_value:  string | null
  new_value:  string | null
  changed_at: string
  profiles: {
    full_name: string
    email:     string
  } | null
}

const FC_SORT_COLS = new Set(['changed_at', 'field_name', 'table_name'])
const FC_SEARCH_COLS = new Set(['field_name', 'table_name', 'old_value', 'new_value'])

export interface UseFieldChangesOptions {
  tableName?: string
  userId?:    string
  dateFrom?:  string
  dateTo?:    string
  page?:      number
  pageSize?:  number
  search?:    string
  searchCol?: string
  sortColumn?:    string
  sortAscending?: boolean
  advancedSort?:  AdvancedSortLevel[]
}

export function useFieldChanges(opts: UseFieldChangesOptions = {}) {
  const { tableName, userId, dateFrom, dateTo, page = 0, pageSize = 200, search, searchCol, sortColumn, sortAscending, advancedSort } = opts
  const orgId = useOrgStore((s) => s.orgId)

  const [entries, setEntries] = useState<FieldChangeEntry[]>([])
  const [count,   setCount]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('field_changes')
      .select(`
        id, user_id, table_name, record_id, field_name,
        old_value, new_value, changed_at,
        profiles:user_id ( full_name, email )
      `, { count: 'exact' })
      .eq('org_id', orgId)

    // Server-side sort
    if (advancedSort && advancedSort.length > 0) {
      for (const l of advancedSort) {
        if (FC_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (sortColumn && FC_SORT_COLS.has(sortColumn)) {
      query = query.order(sortColumn, { ascending: sortAscending ?? false })
    } else {
      query = query.order('changed_at', { ascending: false })
    }

    query = query.range(page * pageSize, (page + 1) * pageSize - 1)

    if (tableName) query = query.eq('table_name', tableName)
    if (userId)    query = query.eq('user_id', userId)
    if (dateFrom)  query = query.gte('changed_at', dateFrom)
    if (dateTo)    query = query.lte('changed_at', dateTo + 'T23:59:59')

    // Server-side search
    if (search) {
      if (!searchCol || searchCol === 'all') {
        query = query.or(`field_name.ilike.%${search}%,table_name.ilike.%${search}%,old_value.ilike.%${search}%,new_value.ilike.%${search}%`)
      } else if (FC_SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${search}%`)
      }
    }

    const { data, error: err, count: total } = await query

    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as unknown as FieldChangeEntry[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [orgId, tableName, userId, dateFrom, dateTo, page, pageSize, search, searchCol, sortColumn, sortAscending, advancedSort])

  useEffect(() => { fetch() }, [fetch])

  return { entries, count, loading, error, refetch: fetch }
}
