import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useAuthStore } from '../store/authStore'

export type FindingType = 'ok' | 'exception' | 'note'

export interface AuditFinding {
  id:           string
  session_id:   string
  org_id:       string
  entity_type:  string
  entity_id:    string
  finding_type: FindingType
  note:         string | null
  created_by:   string | null
  created_at:   string
}

export function useAuditFindings(sessionId: string | null) {
  const orgId = useOrgStore(s => s.orgId)
  const [findings, setFindings] = useState<AuditFinding[]>([])
  const [loading,  setLoading]  = useState(false)

  const fetch = useCallback(async () => {
    if (!sessionId || !orgId) { setFindings([]); return }
    setLoading(true)
    const { data } = await supabase
      .from('audit_findings')
      .select('*')
      .eq('session_id', sessionId)
      .eq('org_id', orgId)
    setFindings((data ?? []) as AuditFinding[])
    setLoading(false)
  }, [sessionId, orgId])

  useEffect(() => { fetch() }, [fetch])

  const upsert = useCallback(async (input: {
    entity_type:  string
    entity_id:    string
    finding_type: FindingType
    note?:        string
  }): Promise<void> => {
    const { user }      = useAuthStore.getState()
    const { orgId: id } = useOrgStore.getState()
    if (!sessionId || !id || !user) throw new Error('Not authenticated')
    const { error: err } = await supabase
      .from('audit_findings')
      .upsert(
        {
          session_id:   sessionId,
          org_id:       id,
          entity_type:  input.entity_type,
          entity_id:    input.entity_id,
          finding_type: input.finding_type,
          note:         input.note ?? null,
          created_by:   user.id,
        },
        { onConflict: 'session_id,entity_type,entity_id' },
      )
    if (err) throw new Error(err.message)
    await fetch()
  }, [sessionId, fetch])

  const removeFinding = useCallback(async (findingId: string): Promise<void> => {
    await supabase.from('audit_findings').delete().eq('id', findingId)
    await fetch()
  }, [fetch])

  const findingMap = new Map(findings.map(f => [`${f.entity_type}:${f.entity_id}`, f]))

  return { findings, loading, findingMap, refetch: fetch, upsert, removeFinding }
}
