import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

export interface Department {
  id:          string
  name:        string
  code:        string | null
  description: string | null
  active:      boolean
  created_at:  string
}

export interface DepartmentInput {
  name:         string
  code?:        string | null
  description?: string | null
  active:       boolean
}

const DEPT_SELECT = 'id, name, code, description, active, created_at'

// ── useDepartments ─────────────────────────────────────────────────────────────

export function useDepartments() {
  const orgId = useOrgStore((s) => s.orgId)

  const [departments, setDepartments] = useState<Department[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('departments')
      .select(DEPT_SELECT)
      .eq('org_id', orgId)
      .order('name')
    if (err) {
      if (/relation.*does not exist/i.test(err.message)) {
        setDepartments([])
      } else {
        setError(err.message)
      }
    } else {
      setDepartments((data ?? []) as Department[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { departments, loading, error, refetch: fetch }
}

// ── Lightweight option list (active only) ──────────────────────────────────────

export function useDepartmentOptions() {
  const orgId = useOrgStore((s) => s.orgId)

  const [options,  setOptions]  = useState<Department[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    supabase
      .from('departments')
      .select(DEPT_SELECT)
      .eq('org_id', orgId)
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as Department[])
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function saveDepartment(
  input: DepartmentInput,
  existingId?: string
): Promise<string> {
  const payload: Record<string, unknown> = {
    name:        input.name.trim(),
    code:        input.code?.trim() || null,
    description: input.description?.trim() || null,
    active:      input.active,
  }
  if (existingId) {
    const { error } = await supabase
      .from('departments')
      .update(payload)
      .eq('id', existingId)
    if (error) throw new Error(error.message)
    return existingId
  } else {
    const { orgId } = useOrgStore.getState()
    if (!orgId) throw new Error('No active organisation.')
    const { data, error } = await supabase
      .from('departments')
      .insert({ ...payload, org_id: orgId })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await supabase.from('departments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
