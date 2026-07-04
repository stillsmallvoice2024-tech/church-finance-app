import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import type { DynamicReport, DynamicReportBlock, DynamicReportSnapshot, SnapshotData } from '../types'

// True when an RPC failed because the function isn't installed on this DB
// (migration not yet applied), so callers can fall back to a legacy path.
// PGRST202 = PostgREST "function not found"; 42883 = Postgres undefined_function.
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '42883') return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('could not find the function') ||
    (m.includes('save_dynamic_report_blocks') && m.includes('does not exist'))
}

export function useDynamicReports() {
  const orgId = useOrgStore((s) => s.orgId)

  const [reports, setReports] = useState<DynamicReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dynamic_reports')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    setReports((data ?? []) as DynamicReport[])
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { reports, loading, error, refetch: fetch }
}

export function useAddDynamicReport() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (title: string): Promise<DynamicReport | null> => {
    setLoading(true)
    setError(null)
    const { orgId } = useOrgStore.getState()
    if (!orgId) { setLoading(false); setError('No active organisation.'); return null }
    const { data, error: err } = await supabase
      .from('dynamic_reports')
      .insert({ title, org_id: orgId })
      .select('*')
      .single()
    setLoading(false)
    if (err) { setError(err.message); return null }
    return data as DynamicReport
  }, [])

  return { mutate, loading, error }
}

export function useUpdateDynamicReport() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Returns null on success, or the DB error message on failure.
  const mutate = useCallback(async (id: string, title: string): Promise<string | null> => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase
      .from('dynamic_reports')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', id)
    setLoading(false)
    if (err) { setError(err.message); return err.message }
    return null
  }, [])

  return { mutate, loading, error }
}

export function useDeleteDynamicReport() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const { error: err, count } = await supabase
      .from('dynamic_reports')
      .delete({ count: 'exact' })
      .eq('id', id)
    setLoading(false)
    if (err) { setError(err.message); return false }
    if (count === 0) { setError('Report not found or access denied'); return false }
    return true
  }, [])

  return { mutate, loading, error }
}

export function useDynamicReportBlocks(reportId: string | null) {
  const [blocks,  setBlocks]  = useState<DynamicReportBlock[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!reportId) { setBlocks([]); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dynamic_report_blocks')
      .select('*')
      .eq('report_id', reportId)
      .order('position', { ascending: true })
    if (err) { setError(err.message); setLoading(false); return }
    setBlocks((data ?? []) as DynamicReportBlock[])
    setLoading(false)
  }, [reportId])

  useEffect(() => { fetch() }, [fetch])

  return { blocks, loading, error, refetch: fetch }
}

export function useSaveDynamicReportBlocks() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Returns null on success, or the DB error message on failure.
  const mutate = useCallback(async (
    reportId: string,
    blocks: Array<{ block_type: string; position: number; config_json: Record<string, unknown> }>,
  ): Promise<string | null> => {
    setLoading(true)
    setError(null)

    // Preferred path: replace all blocks in a single transaction so a mid-save
    // failure can never leave the report with its old blocks deleted and the
    // new ones lost.
    const { error: rpcErr } = await supabase.rpc('save_dynamic_report_blocks', {
      p_report_id: reportId,
      p_blocks:    blocks.map(b => ({ block_type: b.block_type, config_json: b.config_json })),
    })

    if (!rpcErr) { setLoading(false); return null }

    // Fallback for databases where the RPC migration hasn't been applied yet:
    // fall back to the legacy delete-then-insert. Any other RPC error is real.
    if (!isMissingFunction(rpcErr)) {
      setError(rpcErr.message); setLoading(false); return rpcErr.message
    }

    const { error: delErr } = await supabase
      .from('dynamic_report_blocks')
      .delete()
      .eq('report_id', reportId)

    if (delErr) { setError(delErr.message); setLoading(false); return delErr.message }

    if (blocks.length > 0) {
      const rows = blocks.map((b, i) => ({
        report_id:   reportId,
        block_type:  b.block_type,
        position:    i,
        config_json: b.config_json,
      }))
      const { error: insErr } = await supabase.from('dynamic_report_blocks').insert(rows)
      if (insErr) { setError(insErr.message); setLoading(false); return insErr.message }
    }

    setLoading(false)
    return null
  }, [])

  return { mutate, loading, error }
}

export function useReportSnapshots(reportId: string | null) {
  const [snapshots, setSnapshots] = useState<DynamicReportSnapshot[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!reportId) { setSnapshots([]); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dynamic_report_snapshots')
      .select('*')
      .eq('report_id', reportId)
      .order('snapshot_at', { ascending: false })
    if (err && !/does not exist/i.test(err.message)) setError(err.message)
    setSnapshots((data ?? []) as DynamicReportSnapshot[])
    setLoading(false)
  }, [reportId])

  useEffect(() => { fetch() }, [fetch])

  return { snapshots, loading, error, refetch: fetch }
}

export function useSaveSnapshot() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (
    reportId: string,
    label: string,
    data: SnapshotData,
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase
      .from('dynamic_report_snapshots')
      .insert({ report_id: reportId, label, data })
    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { mutate, loading, error }
}

export function useDeleteSnapshot() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (snapshotId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase
      .from('dynamic_report_snapshots')
      .delete()
      .eq('id', snapshotId)
    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { mutate, loading, error }
}
