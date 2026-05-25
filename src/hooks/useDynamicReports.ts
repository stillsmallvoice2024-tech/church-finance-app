import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { DynamicReport, DynamicReportBlock, DynamicReportSnapshot, SnapshotData } from '../types'

export function useDynamicReports() {
  const [reports, setReports] = useState<DynamicReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dynamic_reports')
      .select('*')
      .order('updated_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    setReports((data ?? []) as DynamicReport[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { reports, loading, error, refetch: fetch }
}

export function useAddDynamicReport() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (title: string): Promise<DynamicReport | null> => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dynamic_reports')
      .insert({ title })
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

  const mutate = useCallback(async (id: string, title: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase
      .from('dynamic_reports')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', id)
    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
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

  const mutate = useCallback(async (
    reportId: string,
    blocks: Array<{ block_type: string; position: number; config_json: Record<string, unknown> }>,
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const { error: delErr } = await supabase
      .from('dynamic_report_blocks')
      .delete()
      .eq('report_id', reportId)

    if (delErr) { setError(delErr.message); setLoading(false); return false }

    if (blocks.length > 0) {
      const rows = blocks.map((b, i) => ({
        report_id:   reportId,
        block_type:  b.block_type,
        position:    i,
        config_json: b.config_json,
      }))
      const { error: insErr } = await supabase.from('dynamic_report_blocks').insert(rows)
      if (insErr) { setError(insErr.message); setLoading(false); return false }
    }

    setLoading(false)
    return true
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
