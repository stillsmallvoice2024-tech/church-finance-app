import { supabase } from '../lib/supabase'

export const BACKUP_VERSION = '1'
export const APP_VERSION = '1.0.0'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BackupMeta {
  backupVersion: string
  appVersion: string
  createdAt: string
  userId: string
  userEmail: string
}

export interface BackupFile {
  _meta: BackupMeta
  data: Record<string, Record<string, unknown>[]>
}

export interface TableProgress {
  key: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  count?: number
}

export interface RestoreSummary {
  backupDate: string
  appVersion: string
  backupVersion: string
  userEmail: string
  tables: { key: string; label: string; count: number }[]
  totalRecords: number
  modules: string[]
}

export interface RestoreResult {
  success: boolean
  tablesRestored: string[]
  errors: { table: string; message: string }[]
}

// ── Table definitions ─────────────────────────────────────────────────────────

export interface BackupTableDef {
  key: string
  label: string
  module: string
}

/** Ordered for restore (parents before children) */
export const BACKUP_TABLES: BackupTableDef[] = [
  { key: 'currencies',                      label: 'Currencies',                     module: 'Configuration' },
  { key: 'category_groups',                 label: 'Category Groups',                module: 'Configuration' },
  { key: 'categories',                      label: 'Categories',                     module: 'Configuration' },
  { key: 'category_opening_balances',       label: 'Category Opening Balances',      module: 'Configuration' },
  { key: 'banks',                           label: 'Banks',                          module: 'Configuration' },
  { key: 'special_config_groups',           label: 'Special Config Groups',          module: 'Allocation' },
  { key: 'allocation_configs',              label: 'Allocation Configs',             module: 'Allocation' },
  { key: 'income_types',                    label: 'Income Types',                   module: 'Allocation' },
  { key: 'income_type_rules',               label: 'Income Type Rules',              module: 'Allocation' },
  { key: 'inflow_transactions',             label: 'Inflow Transactions',            module: 'Transactions' },
  { key: 'outflow_transactions',            label: 'Outflow Transactions',           module: 'Transactions' },
  { key: 'intra_flows',                     label: 'Intra-Account Flows',            module: 'Transactions' },
  { key: 'bank_deposits',                   label: 'Bank Deposits',                  module: 'Transactions' },
  { key: 'intrabank_transfers',             label: 'Intrabank Transfers',            module: 'Transactions' },
  { key: 'fx_transactions',                 label: 'FX Transactions',                module: 'Transactions' },
  { key: 'fx_conversions',                  label: 'FX Conversions',                 module: 'Transactions' },
  { key: 'transaction_allocation_snapshots',label: 'Allocation Snapshots',           module: 'Allocation' },
  { key: 'recalculation_logs',              label: 'Recalculation Logs',             module: 'Allocation' },
  { key: 'special_projects',               label: 'Special Projects',               module: 'Projects' },
  { key: 'project_entries',                label: 'Project Entries',                module: 'Projects' },
  { key: 'report_templates',               label: 'Report Templates',               module: 'Reports' },
]

/** Delete order for replace mode (children before parents — reverse of BACKUP_TABLES) */
const DELETE_TABLES = [
  'report_templates',
  'project_entries',
  'special_projects',
  'recalculation_logs',
  'transaction_allocation_snapshots',
  'fx_conversions',
  'fx_transactions',
  'intrabank_transfers',
  'bank_deposits',
  'intra_flows',
  'outflow_transactions',
  'inflow_transactions',
  'income_type_rules',
  'income_types',
  'allocation_configs',
  'special_config_groups',
  'category_opening_balances',
  'categories',
  'category_groups',
  'banks',
  'currencies',
]

// ── Backup creation ────────────────────────────────────────────────────────────

export async function fetchTableData(
  tableKey: string,
  onProgress?: (status: 'running' | 'done' | 'error', count?: number) => void,
): Promise<Record<string, unknown>[]> {
  onProgress?.('running')
  const { data, error } = await supabase
    .from(tableKey)
    .select('*')
    .limit(100_000)
  if (error) {
    onProgress?.('error')
    return []
  }
  const rows = (data ?? []) as Record<string, unknown>[]
  onProgress?.('done', rows.length)
  return rows
}

export async function createBackup(
  userId: string,
  userEmail: string,
  onProgress?: (key: string, status: 'running' | 'done' | 'error', count?: number) => void,
): Promise<BackupFile> {
  const tableData: Record<string, Record<string, unknown>[]> = {}

  for (const def of BACKUP_TABLES) {
    const rows = await fetchTableData(
      def.key,
      (status, count) => onProgress?.(def.key, status, count),
    )
    tableData[def.key] = rows
  }

  return {
    _meta: {
      backupVersion: BACKUP_VERSION,
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      userId,
      userEmail,
    },
    data: tableData,
  }
}

// ── Download ───────────────────────────────────────────────────────────────────

export function downloadBackup(backup: BackupFile): void {
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const date = backup._meta.createdAt.slice(0, 10)
  a.href     = url
  a.download = `church-finance-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Cloud link (Supabase Storage signed URL) ───────────────────────────────────

export async function uploadBackupForLink(
  backup: BackupFile,
  userId: string,
): Promise<string> {
  const json  = JSON.stringify(backup)
  const blob  = new Blob([json], { type: 'application/json' })
  const date  = backup._meta.createdAt.slice(0, 10)
  const path  = `${userId}/backup-${date}-${Date.now()}.json`

  const { error: uploadError } = await supabase.storage
    .from('backups')
    .upload(path, blob, { contentType: 'application/json', upsert: true })

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { data, error: urlError } = await supabase.storage
    .from('backups')
    .createSignedUrl(path, 60 * 60 * 24 * 7) // 7 days

  if (urlError || !data?.signedUrl) {
    throw new Error(`Could not generate signed URL: ${urlError?.message ?? 'unknown'}`)
  }

  return data.signedUrl
}

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateBackup(obj: unknown): ValidationResult {
  const errors: string[] = []

  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['File is not a valid JSON object'] }
  }

  const b = obj as Record<string, unknown>

  if (!b._meta || typeof b._meta !== 'object') {
    errors.push('Missing _meta section')
  } else {
    const m = b._meta as Record<string, unknown>
    if (!m.backupVersion) errors.push('Missing backupVersion')
    if (!m.createdAt)     errors.push('Missing createdAt timestamp')
    if (!m.userId)        errors.push('Missing userId')
  }

  if (!b.data || typeof b.data !== 'object') {
    errors.push('Missing data section')
  } else {
    const d = b.data as Record<string, unknown>
    // At least one core table must be present
    const corePresent = ['inflow_transactions', 'outflow_transactions', 'categories', 'banks'].some(
      t => Array.isArray(d[t]),
    )
    if (!corePresent) errors.push('Backup appears to be empty or corrupt — no core tables found')
  }

  return { valid: errors.length === 0, errors }
}

// ── Restore summary ────────────────────────────────────────────────────────────

export function getRestoreSummary(backup: BackupFile): RestoreSummary {
  const tableDefs = BACKUP_TABLES.filter(def => Array.isArray(backup.data[def.key]))
  const tables = tableDefs.map(def => ({
    key:   def.key,
    label: def.label,
    count: (backup.data[def.key] ?? []).length,
  }))

  const totalRecords = tables.reduce((s, t) => s + t.count, 0)
  const moduleSet = new Set(tableDefs.map(d => d.module))

  return {
    backupDate:    backup._meta.createdAt,
    appVersion:    backup._meta.appVersion ?? 'unknown',
    backupVersion: backup._meta.backupVersion,
    userEmail:     backup._meta.userEmail ?? 'unknown',
    tables,
    totalRecords,
    modules: Array.from(moduleSet),
  }
}

// ── Restore execution ──────────────────────────────────────────────────────────

const BATCH_SIZE = 500

async function insertBatch(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(batch as never, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}

async function deleteFull(table: string): Promise<void> {
  const { error } = await supabase.from(table).delete().not('id', 'is', null)
  if (error) throw new Error(error.message)
}

export async function restoreFromBackup(
  backup: BackupFile,
  mode: 'merge' | 'replace',
  onProgress?: (key: string, status: 'running' | 'done' | 'error', count?: number) => void,
): Promise<RestoreResult> {
  const tablesRestored: string[] = []
  const errors: { table: string; message: string }[] = []

  if (mode === 'replace') {
    // Delete existing data in reverse dependency order
    for (const tableKey of DELETE_TABLES) {
      try {
        await deleteFull(tableKey)
      } catch {
        // Non-fatal: table may not exist or may be empty
      }
    }
    // Also clear transaction-adjacent audit data
    for (const extra of ['receipts', 'audit_log', 'field_changes']) {
      try {
        await supabase.from(extra).delete().not('id', 'is', null)
      } catch {
        // Non-fatal
      }
    }
  }

  // Insert in forward dependency order
  for (const def of BACKUP_TABLES) {
    const rows = backup.data[def.key]
    if (!Array.isArray(rows) || rows.length === 0) continue

    onProgress?.(def.key, 'running')
    try {
      await insertBatch(def.key, rows)
      tablesRestored.push(def.key)
      onProgress?.(def.key, 'done', rows.length)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      errors.push({ table: def.key, message: msg })
      onProgress?.(def.key, 'error')
      // Continue with remaining tables so partial restore is possible
    }
  }

  return {
    success: errors.length === 0,
    tablesRestored,
    errors,
  }
}

// ── File parsing ───────────────────────────────────────────────────────────────

export async function parseBackupFile(file: File): Promise<BackupFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        resolve(parsed as BackupFile)
      } catch {
        reject(new Error('Invalid JSON file — the backup may be corrupted'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
