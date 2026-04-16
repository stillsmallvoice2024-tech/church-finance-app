import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── DB row types ───────────────────────────────────────────────────────────────

export interface DbSpecialProject {
  id: string
  name: string
  code: string | null
  opening_balance: number
  is_active: boolean
  created_at: string
}

export interface ProjectEntry {
  id: string
  project_id: string
  date: string
  description: string | null
  inflow: number
  percentage_inflow: number
  refund_intraflow: number
  outflow: number
  balance: number
  created_by: string | null
  created_at: string
}

// ── useSpecialProjects ─────────────────────────────────────────────────────────

export interface SpecialProjectsResult {
  projects: DbSpecialProject[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useSpecialProjects(): SpecialProjectsResult {
  const [projects, setProjects] = useState<DbSpecialProject[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('special_projects')
      .select('*')
      .order('created_at', { ascending: true })

    if (err) setError(err.message)
    else     setProjects((data ?? []) as DbSpecialProject[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { projects, loading, error, refetch: fetch }
}

// ── useProjectEntries ──────────────────────────────────────────────────────────

export interface ProjectEntriesResult {
  entries: ProjectEntry[]
  runningBalance: number
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useProjectEntries(projectId: string): ProjectEntriesResult {
  const [entries,  setEntries]  = useState<ProjectEntry[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!projectId) {
      setEntries([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('project_entries')
      .select('*')
      .eq('project_id', projectId)
      .order('date',       { ascending: true })
      .order('created_at', { ascending: true })

    if (err) setError(err.message)
    else     setEntries((data ?? []) as ProjectEntry[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetch() }, [fetch])

  const runningBalance = entries.length > 0 ? entries[entries.length - 1].balance : 0

  return { entries, runningBalance, loading, error, refetch: fetch }
}
