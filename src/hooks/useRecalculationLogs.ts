import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface RecalculationLog {
  id:                string
  config_group_id:   string | null
  config_version_id: string | null
  performed_by:      string | null
  performed_at:      string
  affected_count:    number
  reason:            string | null
  action_summary:    string
  performer_name:    string | null
}

export function useRecalculationLogs(groupId: string) {
  const [logs,    setLogs]    = useState<RecalculationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!groupId) { setLogs([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('recalculation_logs')
      .select(`
        id, config_group_id, config_version_id, performed_by,
        performed_at, affected_count, reason, action_summary,
        profiles ( full_name )
      `)
      .eq('config_group_id', groupId)
      .order('performed_at', { ascending: false })
      .limit(50)
    if (err) { setError(err.message); setLoading(false); return }
    const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
      id:                r.id as string,
      config_group_id:   r.config_group_id as string | null,
      config_version_id: r.config_version_id as string | null,
      performed_by:      r.performed_by as string | null,
      performed_at:      r.performed_at as string,
      affected_count:    r.affected_count as number,
      reason:            r.reason as string | null,
      action_summary:    r.action_summary as string,
      performer_name:    (r.profiles as { full_name: string } | null)?.full_name ?? null,
    }))
    setLogs(mapped)
    setLoading(false)
  }, [groupId])

  useEffect(() => { load() }, [load])

  return { logs, loading, error, refetch: load }
}
