import { supabase } from '../lib/supabase'

export interface MigrationStats {
  total:    number
  migrated: number
  skipped:  number
  failed:   number
  errors:   string[]
}

export type MigrationProgressCallback = (
  current: number,
  total:   number,
  message: string,
) => void

const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i

interface ReceiptRow {
  id:          string
  org_id:      string | null
  entity_type: string
  entity_id:   string
  file_path:   string
  file_name:   string
}

export async function auditLegacyReceiptPaths(): Promise<number> {
  const { data, error, count } = await supabase
    .from('receipts')
    .select('file_path', { count: 'exact' })

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as { file_path: string }[]
  return rows.filter(r => !UUID_PREFIX_RE.test(r.file_path)).length ?? count ?? 0
}

export async function migrateReceiptPaths(
  onProgress?: MigrationProgressCallback,
): Promise<MigrationStats> {
  const stats: MigrationStats = { total: 0, migrated: 0, skipped: 0, failed: 0, errors: [] }

  const { data, error } = await supabase
    .from('receipts')
    .select('id, org_id, entity_type, entity_id, file_path, file_name')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch receipts: ${error.message}`)

  const legacy = (data as ReceiptRow[]).filter(r => !UUID_PREFIX_RE.test(r.file_path))
  stats.total = legacy.length

  if (stats.total === 0) return stats

  for (let i = 0; i < legacy.length; i++) {
    const r = legacy[i]
    onProgress?.(i + 1, legacy.length, r.file_name)

    if (!r.org_id) {
      stats.skipped++
      stats.errors.push(`[${r.id}] skipped — no org_id on record`)
      continue
    }

    const oldPath = r.file_path
    // Old format: {entityType}/{entityId}/{filename...}
    const parts    = oldPath.split('/')
    const filename = parts.length >= 3 ? parts.slice(2).join('/') : parts[parts.length - 1]
    const newPath  = `${r.org_id}/${r.entity_type}/${r.entity_id}/${filename}`

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from('receipts')
        .download(oldPath)
      if (dlErr) throw new Error(`download failed: ${dlErr.message}`)

      const { error: upErr } = await supabase.storage
        .from('receipts')
        .upload(newPath, blob, { upsert: false })
      if (upErr) throw new Error(`upload failed: ${upErr.message}`)

      const { error: dbErr } = await supabase
        .from('receipts')
        .update({ file_path: newPath })
        .eq('id', r.id)
      if (dbErr) {
        await supabase.storage.from('receipts').remove([newPath]).catch(() => {})
        throw new Error(`db update failed: ${dbErr.message}`)
      }

      // Best-effort delete — non-fatal; signed URLs for old paths still work during transition
      const { error: rmErr } = await supabase.storage.from('receipts').remove([oldPath])
      if (rmErr) {
        stats.errors.push(`[${r.id}] old file not deleted (${oldPath}): ${rmErr.message}`)
      }

      stats.migrated++
    } catch (err) {
      stats.failed++
      stats.errors.push(`[${r.id}] ${oldPath}: ${String(err)}`)
    }
  }

  return stats
}
