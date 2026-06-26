import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

export type ActivityEventType = 'field_change' | 'record_created' | 'record_deleted'

export interface ActivityLogEntry {
  id:             string
  event_type:     ActivityEventType
  user_id:        string | null
  org_id:         string
  table_name:     string | null
  record_id:      string | null
  event_at:       string
  field_name:     string | null
  old_value:      string | null
  new_value:      string | null
  action:         string | null
  snapshot_data:  Record<string, unknown> | null
  user_full_name: string | null
  user_email:     string | null
}

export interface UseActivityLogOptions {
  tableName?:    string
  dateFrom?:     string
  dateTo?:       string
  eventTypes?:   ActivityEventType[]
  page?:         number
  pageSize?:     number
  search?:       string
  searchCol?:    string
  sortAscending?: boolean
}

const SEARCH_COLS = new Set(['field_name', 'table_name', 'old_value', 'new_value'])

export function useActivityLog(opts: UseActivityLogOptions = {}) {
  const {
    tableName, dateFrom, dateTo, eventTypes,
    page = 0, pageSize = 50, search, searchCol, sortAscending = false,
  } = opts
  const orgId = useOrgStore(s => s.orgId)

  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [count,   setCount]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('activity_log_view')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('event_at', { ascending: sortAscending })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (tableName)          query = query.eq('table_name', tableName)
    if (dateFrom)           query = query.gte('event_at', dateFrom)
    if (dateTo)             query = query.lte('event_at', dateTo + 'T23:59:59')
    if (eventTypes?.length) query = query.in('event_type', eventTypes)

    if (search) {
      const s = search.replace(/[%_\\()\[\],{}]/g, '')
      if (!searchCol || searchCol === 'all') {
        query = query.or(
          `field_name.ilike.%${s}%,table_name.ilike.%${s}%,old_value.ilike.%${s}%,new_value.ilike.%${s}%`,
        )
      } else if (SEARCH_COLS.has(searchCol)) {
        query = query.ilike(searchCol, `%${s}%`)
      }
    }

    const { data, error: err, count: total } = await query

    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as unknown as ActivityLogEntry[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [orgId, tableName, dateFrom, dateTo, eventTypes, page, pageSize, search, searchCol, sortAscending])

  useEffect(() => { fetch() }, [fetch])

  return { entries, count, loading, error, refetch: fetch }
}
