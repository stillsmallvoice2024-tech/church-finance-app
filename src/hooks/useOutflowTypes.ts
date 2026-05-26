import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutflowType {
  id:         string
  name:       string
  color:      string
  created_at: string
}

export interface OutflowTypeInput {
  name:  string
  color: string
}

// ── useOutflowTypes ────────────────────────────────────────────────────────────

export function useOutflowTypes() {
  const [outflowTypes, setOutflowTypes] = useState<OutflowType[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('outflow_types')
      .select('id, name, color, created_at')
      .order('name')
    if (err) {
      // Table may not exist yet on older installs — surface gracefully
      if (/relation.*does not exist/i.test(err.message)) {
        setOutflowTypes([])
      } else {
        setError(err.message)
      }
    } else {
      setOutflowTypes((data ?? []) as OutflowType[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { outflowTypes, loading, error, refetch: fetch }
}

// ── Lightweight option list ────────────────────────────────────────────────────

export function useOutflowTypeOptions() {
  const [options,  setOptions]  = useState<OutflowType[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    supabase
      .from('outflow_types')
      .select('id, name, color, created_at')
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as OutflowType[])
        setLoading(false)
      })
  }, [])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function saveOutflowType(input: OutflowTypeInput, existingId?: string): Promise<string> {
  if (existingId) {
    const { error } = await supabase
      .from('outflow_types')
      .update({ name: input.name, color: input.color })
      .eq('id', existingId)
    if (error) throw new Error(error.message)
    return existingId
  } else {
    const { data, error } = await supabase
      .from('outflow_types')
      .insert({ name: input.name, color: input.color })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }
}

export async function deleteOutflowType(id: string): Promise<void> {
  const { error } = await supabase.from('outflow_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
