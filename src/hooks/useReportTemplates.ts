import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'
import type { ReportLayout, ReportTemplate } from '../types'

export function useReportTemplates(): {
  templates: ReportTemplate[]
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const orgId = useOrgStore((s) => s.orgId)

  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('report_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('name')
    if (err) { setError(err.message) } else { setTemplates((data ?? []) as ReportTemplate[]) }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { templates, loading, error, refetch: fetch }
}

interface AddInput {
  name: string
  description?: string
  layout: ReportLayout
}

export function useAddReportTemplate(): {
  mutate: (input: AddInput) => Promise<ReportTemplate>
  loading: boolean
  error: string | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const mutate = async (input: AddInput): Promise<ReportTemplate> => {
    setLoading(true)
    setError(null)
    const user = useAuthStore.getState().user
    const { orgId } = useOrgStore.getState()
    if (!orgId) { setLoading(false); throw new Error('No active organisation.') }
    const { data, error: err } = await supabase
      .from('report_templates')
      .insert({ ...input, created_by: user?.id ?? null, org_id: orgId })
      .select()
      .single()
    setLoading(false)
    if (err) { setError(err.message); throw new Error(err.message) }
    return data as ReportTemplate
  }

  return { mutate, loading, error }
}

interface UpdateInput {
  id: string
  name?: string
  description?: string
  layout?: ReportLayout
}

export function useUpdateReportTemplate(): {
  mutate: (input: UpdateInput) => Promise<void>
  loading: boolean
  error: string | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const mutate = async (input: UpdateInput): Promise<void> => {
    setLoading(true)
    setError(null)
    const { id, ...rest } = input
    const { error: err } = await supabase
      .from('report_templates')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
    setLoading(false)
    if (err) { setError(err.message); throw new Error(err.message) }
  }

  return { mutate, loading, error }
}

export function useDeleteReportTemplate(): {
  mutate: (id: string) => Promise<void>
  loading: boolean
  error: string | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const mutate = async (id: string): Promise<void> => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase
      .from('report_templates')
      .delete()
      .eq('id', id)
    setLoading(false)
    if (err) { setError(err.message); throw new Error(err.message) }
  }

  return { mutate, loading, error }
}
