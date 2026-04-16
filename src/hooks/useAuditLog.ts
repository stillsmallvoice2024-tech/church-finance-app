import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// ── DB row type (with joined profile) ─────────────────────────────────────────

export interface AuditLogEntry {
  id: string
  user_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE' | string
  table_name: string | null
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
  // Joined from profiles via the user_id FK
  profiles: {
    full_name: string
    email: string
  } | null
}

// ── useAuditLog ────────────────────────────────────────────────────────────────

export interface AuditLogResult {
  entries: AuditLogEntry[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAuditLog(limit = 100): AuditLogResult {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    // Read role at call-time so we don't need it as a dep
    const { role } = useAuthStore.getState()

    if (role !== 'admin') {
      setError('Access denied: admin role required to view the audit log.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('audit_log')
      .select(`
        id,
        user_id,
        action,
        table_name,
        record_id,
        old_data,
        new_data,
        created_at,
        profiles:user_id (
          full_name,
          email
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as unknown as AuditLogEntry[])
    }
    setLoading(false)
  }, [limit])  // role is read from store at call-time, not a dep

  useEffect(() => { fetch() }, [fetch])

  return { entries, loading, error, refetch: fetch }
}
