import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export type ReceiptEntityType = 'outflow' | 'inflow' | 'bank_deposit'

export interface Receipt {
  id:          string
  entity_type: ReceiptEntityType
  entity_id:   string
  file_name:   string
  file_path:   string
  file_size:   number | null
  mime_type:   string | null
  uploaded_by: string | null
  created_at:  string
}

export function useReceipts(entityType: ReceiptEntityType, entityId: string) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!entityId) return
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('receipts')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setReceipts((data ?? []) as Receipt[])
    setLoading(false)
  }, [entityType, entityId])

  useEffect(() => { fetch() }, [fetch])

  const upload = useCallback(async (file: File): Promise<void> => {
    const { user } = useAuthStore.getState()
    const ext  = file.name.split('.').pop() ?? 'bin'
    const path = `${entityType}/${entityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: storageErr } = await supabase.storage
      .from('receipts').upload(path, file)
    if (storageErr) throw new Error(storageErr.message)

    const { error: dbErr } = await supabase.from('receipts').insert({
      entity_type: entityType,
      entity_id:   entityId,
      file_name:   file.name,
      file_path:   path,
      file_size:   file.size,
      mime_type:   file.type || null,
      uploaded_by: user?.id ?? null,
    })
    if (dbErr) throw new Error(dbErr.message)
    await fetch()
  }, [entityType, entityId, fetch])

  const remove = useCallback(async (receipt: Receipt): Promise<void> => {
    await supabase.storage.from('receipts').remove([receipt.file_path])
    const { error: dbErr } = await supabase.from('receipts').delete().eq('id', receipt.id)
    if (dbErr) throw new Error(dbErr.message)
    await fetch()
  }, [fetch])

  const getDownloadUrl = useCallback(async (filePath: string): Promise<string> => {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(filePath, 3600)
    return data?.signedUrl ?? ''
  }, [])

  return { receipts, loading, error, refetch: fetch, upload, remove, getDownloadUrl }
}

export function useAllReceipts(entityType?: ReceiptEntityType) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true); setError(null)
    let q = supabase.from('receipts').select('*').order('created_at', { ascending: false })
    if (entityType) q = q.eq('entity_type', entityType)
    const { data, error: err } = await q
    if (err) setError(err.message)
    else setReceipts((data ?? []) as Receipt[])
    setLoading(false)
  }, [entityType])

  useEffect(() => { fetch() }, [fetch])

  const remove = useCallback(async (receipt: Receipt): Promise<void> => {
    await supabase.storage.from('receipts').remove([receipt.file_path])
    await supabase.from('receipts').delete().eq('id', receipt.id)
    await fetch()
  }, [fetch])

  const getDownloadUrl = useCallback(async (filePath: string): Promise<string> => {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(filePath, 3600)
    return data?.signedUrl ?? ''
  }, [])

  return { receipts, loading, error, refetch: fetch, remove, getDownloadUrl }
}
