import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

export interface UseFieldChangesOptions {
  tableName?: string
  userId?:    string
  dateFrom?:  string
  dateTo?:    string
  page?:      number
  pageSize?:  number
}

export function useFieldChanges(opts: UseFieldChangesOptions = {}) {
  const { tableName, userId, dateFrom, dateTo, page = 0, pageSize = 200 } = opts

  const [entries, setEntries] = useState<FieldChangeEntry[]>([])
  const [count,   setCount]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('field_changes')
      .select(`
        id, user_id, table_name, record_id, field_name,
        old_value, new_value, changed_at,
        profiles:user_id ( full_name, email )
      `, { count: 'exact' })
      .order('changed_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (tableName) query = query.eq('table_name', tableName)
    if (userId)    query = query.eq('user_id', userId)
    if (dateFrom)  query = query.gte('changed_at', dateFrom)
    if (dateTo)    query = query.lte('changed_at', dateTo + 'T23:59:59')

    const { data, error: err, count: total } = await query

    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as unknown as FieldChangeEntry[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [tableName, userId, dateFrom, dateTo, page, pageSize])

  useEffect(() => { fetch() }, [fetch])

  return { entries, count, loading, error, refetch: fetch }
}
