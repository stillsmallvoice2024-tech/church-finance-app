import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'
import { createBackup, downloadBackup } from '../utils/backupRestore'
import type { BackupFileV2 } from '../utils/backupRestore'

export type DeletionStep =
  | 'idle'
  | 'reauth'
  | 'confirm_name'
  | 'generating_backup'
  | 'backup_ready'
  | 'submitting'
  | 'done'
  | 'error'

export interface UseOrgDeletionReturn {
  step:                 DeletionStep
  error:                string | null
  backupReady:          boolean
  backupObject:         BackupFileV2 | null
  purgeAt:              string | null
  deletedAt:            string | null
  signedBackupUrl:      string | null
  reAuthenticate:       (password: string) => Promise<boolean>
  generateAndSubmit:    (orgName: string) => Promise<void>
  downloadBackupNow:    () => void
  applyDeletion:        () => void
  fetchSignedBackupUrl: () => Promise<void>
  restoreOrg:           () => Promise<void>
  reset:                () => void
}

export function useOrgDeletion(): UseOrgDeletionReturn {
  const { user }  = useAuthStore()
  const orgStore  = useOrgStore()

  const [step,            setStep]            = useState<DeletionStep>('idle')
  const [error,           setError]           = useState<string | null>(null)
  const [backupObject,    setBackupObject]    = useState<BackupFileV2 | null>(null)
  const [purgeAt,         setPurgeAt]         = useState<string | null>(null)
  const [deletedAt,       setDeletedAt]       = useState<string | null>(null)
  const [signedBackupUrl, setSignedBackupUrl] = useState<string | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setBackupObject(null)
    setPurgeAt(null)
    setDeletedAt(null)
    setSignedBackupUrl(null)
  }, [])

  const reAuthenticate = useCallback(async (password: string): Promise<boolean> => {
    if (!user?.email) {
      setError('No authenticated user found.')
      return false
    }
    setError(null)
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email:    user.email,
      password,
    })
    if (authErr) {
      setError('Incorrect password. Please try again.')
      return false
    }
    setStep('confirm_name')
    return true
  }, [user])

  const generateAndSubmit = useCallback(async (orgName: string) => {
    const orgId = orgStore.orgId
    if (!orgId || !user) {
      setError('No active organisation.')
      return
    }

    setStep('generating_backup')
    setError(null)

    let backup: BackupFileV2
    try {
      backup = await createBackup(user.id, user.email ?? '')
      setBackupObject(backup)
      // Auto-download immediately so user has the file before any navigation occurs
      downloadBackup(backup)
    } catch (e) {
      setError(`Backup generation failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setStep('error')
      return
    }

    // Upload backup to deletion-backups storage bucket
    setStep('backup_ready')
    let uploadedPath: string | null = null
    try {
      const json      = JSON.stringify(backup)
      const blob      = new Blob([json], { type: 'application/json' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path      = `${orgId}/${timestamp}.json`

      const { error: uploadErr } = await supabase.storage
        .from('deletion-backups')
        .upload(path, blob, { contentType: 'application/json', upsert: false })

      if (uploadErr) {
        console.warn('[org-deletion] Storage upload failed:', uploadErr.message)
      } else {
        uploadedPath = path
        const { error: rpcErr } = await supabase.rpc('record_deletion_backup', {
          p_org_id:    orgId,
          p_path:      path,
          p_file_size: blob.size,
        })
        if (rpcErr) console.warn('[org-deletion] record_deletion_backup failed:', rpcErr.message)
      }
    } catch (e) {
      console.warn('[org-deletion] Backup storage error (non-fatal):', e)
    }

    // Request deletion via RPC
    setStep('submitting')
    const { data, error: rpcErr } = await supabase.rpc('request_org_deletion', {
      p_org_id:           orgId,
      p_org_name_confirm: orgName,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      setStep('error')
      return
    }

    const result = data as { ok: boolean; deleted_at?: string; purge_at?: string; error?: string }
    if (!result?.ok) {
      setError(result?.error ?? 'Deletion request failed.')
      setStep('error')
      return
    }

    setPurgeAt(result.purge_at ?? null)
    setDeletedAt(result.deleted_at ?? null)

    // Generate a 30-day signed URL for re-download
    if (uploadedPath) {
      try {
        const { data: signed } = await supabase.storage
          .from('deletion-backups')
          .createSignedUrl(uploadedPath, 30 * 24 * 3600)
        if (signed?.signedUrl) setSignedBackupUrl(signed.signedUrl)
      } catch { /* non-fatal */ }
    }

    setStep('done')
    // NOTE: orgStore.setOrgStatus is NOT called here.
    // Caller must call applyDeletion() once the user has navigated away from the modal,
    // to avoid OrgLockedGuard unmounting the modal before the user can act.
  }, [user, orgStore])

  // Activates pending_deletion state in the store. Call just before closing the modal.
  const applyDeletion = useCallback(() => {
    const orgId = orgStore.orgId
    orgStore.setOrgStatus('pending_deletion', deletedAt, purgeAt)
    const updated = orgStore.memberships.map(m =>
      m.org_id === orgId
        ? { ...m, org_status: 'pending_deletion' as const, org_deleted_at: deletedAt, org_purge_at: purgeAt }
        : m
    )
    orgStore.setMemberships(updated)
  }, [orgStore, deletedAt, purgeAt])

  const downloadBackupNow = useCallback(() => {
    if (backupObject) downloadBackup(backupObject)
  }, [backupObject])

  // For OrgLockedScreen: resolves a signed URL for the most recent backup in storage.
  const fetchSignedBackupUrl = useCallback(async () => {
    const orgId = orgStore.orgId
    if (!orgId) return
    try {
      const { data: files } = await supabase.storage
        .from('deletion-backups')
        .list(orgId, { sortBy: { column: 'created_at', order: 'desc' }, limit: 1 })
      if (!files?.length) return
      const path = `${orgId}/${files[0].name}`
      const { data: signed } = await supabase.storage
        .from('deletion-backups')
        .createSignedUrl(path, 3600)
      if (signed?.signedUrl) setSignedBackupUrl(signed.signedUrl)
    } catch { /* non-fatal */ }
  }, [orgStore.orgId])

  const restoreOrg = useCallback(async () => {
    const orgId = orgStore.orgId
    if (!orgId) { setError('No active organisation.'); return }

    setError(null)
    const { data, error: rpcErr } = await supabase.rpc('restore_org', { p_org_id: orgId })

    if (rpcErr) { setError(rpcErr.message); return }

    const result = data as { ok: boolean; error?: string }
    if (!result?.ok) { setError(result?.error ?? 'Restore failed.'); return }

    orgStore.setOrgStatus('active', null, null)
    const updated = orgStore.memberships.map(m =>
      m.org_id === orgId
        ? { ...m, org_status: 'active' as const, org_deleted_at: null, org_purge_at: null }
        : m
    )
    orgStore.setMemberships(updated)
  }, [orgStore])

  return {
    step,
    error,
    backupReady:          backupObject !== null,
    backupObject,
    purgeAt,
    deletedAt,
    signedBackupUrl,
    reAuthenticate,
    generateAndSubmit,
    downloadBackupNow,
    applyDeletion,
    fetchSignedBackupUrl,
    restoreOrg,
    reset,
  }
}
