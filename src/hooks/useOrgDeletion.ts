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
  step:              DeletionStep
  error:             string | null
  backupReady:       boolean
  backupObject:      BackupFileV2 | null
  purgeAt:           string | null
  deletedAt:         string | null
  reAuthenticate:    (password: string) => Promise<boolean>
  generateAndSubmit: (orgName: string) => Promise<void>
  downloadBackupNow: () => void
  restoreOrg:        () => Promise<void>
  reset:             () => void
}

export function useOrgDeletion(): UseOrgDeletionReturn {
  const { user }  = useAuthStore()
  const orgStore  = useOrgStore()

  const [step,         setStep]         = useState<DeletionStep>('idle')
  const [error,        setError]        = useState<string | null>(null)
  const [backupObject, setBackupObject] = useState<BackupFileV2 | null>(null)
  const [purgeAt,      setPurgeAt]      = useState<string | null>(null)
  const [deletedAt,    setDeletedAt]    = useState<string | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setBackupObject(null)
    setPurgeAt(null)
    setDeletedAt(null)
  }, [])

  // Step 1: verify password (re-authentication)
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

  // Step 2: generate backup + call request_org_deletion RPC
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
    } catch (e) {
      setError(`Backup generation failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setStep('error')
      return
    }

    // Upload backup to deletion-backups storage bucket
    setStep('backup_ready')
    try {
      const json      = JSON.stringify(backup)
      const blob      = new Blob([json], { type: 'application/json' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path      = `${orgId}/${timestamp}.json`

      const { error: uploadErr } = await supabase.storage
        .from('deletion-backups')
        .upload(path, blob, { contentType: 'application/json', upsert: false })

      if (uploadErr) {
        // Non-fatal: continue without server-side storage if bucket unavailable
        console.warn('[org-deletion] Storage upload failed:', uploadErr.message)
      } else {
        // Record backup metadata in org_deletion_backups table
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

    // Update local store so the UI reflects the locked state immediately
    orgStore.setOrgStatus('pending_deletion', result.deleted_at ?? null, result.purge_at ?? null)

    setStep('done')
  }, [user, orgStore])

  const downloadBackupNow = useCallback(() => {
    if (backupObject) downloadBackup(backupObject)
  }, [backupObject])

  const restoreOrg = useCallback(async () => {
    const orgId = orgStore.orgId
    if (!orgId) { setError('No active organisation.'); return }

    setError(null)
    const { data, error: rpcErr } = await supabase.rpc('restore_org', { p_org_id: orgId })

    if (rpcErr) { setError(rpcErr.message); return }

    const result = data as { ok: boolean; error?: string }
    if (!result?.ok) { setError(result?.error ?? 'Restore failed.'); return }

    // Revert local store
    orgStore.setOrgStatus('active', null, null)
  }, [orgStore])

  return {
    step,
    error,
    backupReady:       backupObject !== null,
    backupObject,
    purgeAt,
    deletedAt,
    reAuthenticate,
    generateAndSubmit,
    downloadBackupNow,
    restoreOrg,
    reset,
  }
}
