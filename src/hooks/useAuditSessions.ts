import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useAuthStore } from '../store/authStore'

export interface AuditSession {
  id:           string
  org_id:       string
  period_start: string
  period_end:   string
  auditor_id:   string | null
  status:       'draft' | 'complete'
  notes:        string | null
  created_at:   string
  profiles:     { full_name: string; email: string } | null
}

export function useAuditSessions() {
  const orgId = useOrgStore(s => s.orgId)
  const [sessions, setSessions] = useState<AuditSession[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('audit_sessions')
      .select('*, profiles:auditor_id ( full_name, email )')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setSessions((data ?? []) as unknown as AuditSession[])
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  const create = useCallback(async (input: {
    period_start: string
    period_end:   string
    notes?:       string
  }): Promise<AuditSession> => {
    const { user }  = useAuthStore.getState()
    const { orgId: id } = useOrgStore.getState()
    if (!id || !user) throw new Error('Not authenticated')
    const { data, error: err } = await supabase
      .from('audit_sessions')
      .insert({ ...input, org_id: id, auditor_id: user.id, status: 'draft' })
      .select('*, profiles:auditor_id ( full_name, email )')
      .single()
    if (err) throw new Error(err.message)
    await fetch()
    return data as unknown as AuditSession
  }, [fetch])

  const complete = useCallback(async (sessionId: string): Promise<void> => {
    const { error: err } = await supabase
      .from('audit_sessions')
      .update({ status: 'complete' })
      .eq('id', sessionId)
      .select('id')
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  const reopen = useCallback(async (sessionId: string): Promise<void> => {
    const { error: err } = await supabase
      .from('audit_sessions')
      .update({ status: 'draft' })
      .eq('id', sessionId)
      .select('id')
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  const updateNotes = useCallback(async (sessionId: string, notes: string): Promise<void> => {
    const { error: err } = await supabase
      .from('audit_sessions')
      .update({ notes })
      .eq('id', sessionId)
      .select('id')
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  const remove = useCallback(async (sessionId: string): Promise<void> => {
    const { error: err } = await supabase
      .from('audit_sessions')
      .delete()
      .eq('id', sessionId)
    if (err) throw new Error(err.message)
    await fetch()
  }, [fetch])

  return { sessions, loading, error, refetch: fetch, create, complete, reopen, updateNotes, remove }
}
