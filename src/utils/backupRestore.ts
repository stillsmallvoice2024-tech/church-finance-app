import { supabase } from '../lib/supabase'
import { fetchAllRows } from './fetchAllRows'

export const BACKUP_VERSION = '2'
export const APP_VERSION    = '1.0.0'

// ── Managed table registry ─────────────────────────────────────────────────────

export type RestoreMode = 'replace' | 'merge' | 'append'

export interface ManagedTableConfig {
  /** Table name — doubles as the registry key */
  key: string
  label: string
  module: string
  /** Lower index = restored first (array order is authoritative) */
  restorePriority: number
  backupEnabled: boolean
  /**
   * replace — full delete-then-insert in replace mode
   * merge   — upsert on conflict; never delete-first
   * append  — insert-only skip conflicts; never deleted even in replace mode
   */
  restoreMode: RestoreMode
  /** PK column used for upsert conflict resolution (default: 'id') */
  conflictColumn: string
  requiresMigration: boolean
  sensitive: boolean
  optional: boolean
  dependencies: string[]
  notes?: string
  /** True when table has org_id — backup scopes fetch to the active org. */
  orgScoped?: boolean
}

/** Ordered for restore: parents before children */
export const MANAGED_TABLES: ManagedTableConfig[] = [
  {
    key: 'organizations', label: 'Organisations', module: 'Configuration',
    restorePriority: 0, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: false,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
    notes: 'Must be restored before org_members and all business tables',
  },
  {
    key: 'currencies', label: 'Currencies', module: 'Configuration',
    restorePriority: 1, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'code', orgScoped: false,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: [],
    notes: 'PK is code, not id',
  },
  {
    key: 'category_groups', label: 'Fund Groups', module: 'Configuration',
    restorePriority: 2, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'categories', label: 'Funds', module: 'Configuration',
    restorePriority: 3, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: ['category_groups'],
  },
  {
    key: 'category_opening_balances', label: 'Fund Opening Balances', module: 'Configuration',
    restorePriority: 4, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: ['categories'],
  },
  {
    key: 'banks', label: 'Banks', module: 'Configuration',
    restorePriority: 5, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'special_config_groups', label: 'Special Config Groups', module: 'Allocation',
    restorePriority: 6, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: [],
  },
  {
    key: 'allocation_configs', label: 'Allocation Configs', module: 'Allocation',
    restorePriority: 7, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: ['special_config_groups'],
  },
  {
    key: 'income_types', label: 'Income Types', module: 'Allocation',
    restorePriority: 8, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: ['special_config_groups'],
  },
  {
    key: 'outflow_types', label: 'Outflow Types', module: 'Allocation',
    restorePriority: 9, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: [],
    notes: 'reporting classification layer for outflows',
  },
  {
    key: 'income_type_rules', label: 'Income Type Rules', module: 'Allocation',
    restorePriority: 10, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: ['income_types'],
  },
  {
    key: 'inflow_transactions', label: 'Inflow Transactions', module: 'Transactions',
    restorePriority: 11, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: ['income_types', 'allocation_configs'],
  },
  {
    key: 'outflow_transactions', label: 'Outflow Transactions', module: 'Transactions',
    restorePriority: 12, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: ['outflow_types'],
  },
  {
    key: 'intra_flows', label: 'Fund-to-Fund Transfer', module: 'Transactions',
    restorePriority: 13, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'bank_deposits', label: 'Bank Deposits', module: 'Transactions',
    restorePriority: 13, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'intrabank_transfers', label: 'Intrabank Transfers', module: 'Transactions',
    restorePriority: 14, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'fx_transactions', label: 'FX Transactions', module: 'Transactions',
    restorePriority: 15, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: false,
    dependencies: [],
  },
  {
    key: 'fx_conversions', label: 'FX Conversions', module: 'Transactions',
    restorePriority: 16, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: ['fx_transactions', 'inflow_transactions'],
  },
  {
    key: 'transaction_allocation_snapshots', label: 'Allocation Snapshots', module: 'Allocation',
    restorePriority: 17, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: ['inflow_transactions', 'allocation_configs'],
    notes: 'append-only: never deleted in replace mode; requires snapshot migration',
  },
  {
    key: 'recalculation_logs', label: 'Recalculation Logs', module: 'Allocation',
    restorePriority: 18, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: ['special_config_groups', 'allocation_configs'],
    notes: 'audit trail — append-only, never deleted',
  },
  {
    key: 'special_projects', label: 'Special Projects', module: 'Projects',
    restorePriority: 19, backupEnabled: true, restoreMode: 'replace',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: [],
  },
  {
    key: 'project_entries', label: 'Project Entries', module: 'Projects',
    restorePriority: 20, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: ['special_projects'],
  },
  {
    key: 'report_templates', label: 'Report Templates', module: 'Reports',
    restorePriority: 21, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: [],
  },
  {
    key: 'dynamic_reports', label: 'Dynamic Reports', module: 'Reports',
    restorePriority: 22, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: [],
  },
  {
    key: 'dynamic_report_blocks', label: 'Dynamic Report Blocks', module: 'Reports',
    restorePriority: 23, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: ['dynamic_reports'],
  },
  {
    key: 'dynamic_report_snapshots', label: 'Report Snapshots', module: 'Reports',
    restorePriority: 24, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: ['dynamic_reports'],
  },
  {
    key: 'org_members', label: 'Org Members', module: 'Configuration',
    restorePriority: 25, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: true, optional: false,
    dependencies: ['organizations'],
    notes: 'Contains user roles — restore with care; sensitive',
  },
  {
    key: 'bank_statement_balances', label: 'Statement Reference Balances', module: 'Reconciliation',
    restorePriority: 80, backupEnabled: true, restoreMode: 'merge',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: ['banks'],
  },
  {
    key: 'reconciliation_runs', label: 'Reconciliation History', module: 'Reconciliation',
    restorePriority: 81, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: true, sensitive: false, optional: true,
    dependencies: [],
  },
  // ── Audit trail ─────────────────────────────────────────────────────────────
  // These three were previously unregistered: never backed up, yet hard-deleted
  // by replace mode.  Registering them as `append` both captures them in the
  // backup and excludes them from DELETE_TABLES, so a restore can never destroy
  // the record of what the data used to be.
  {
    key: 'receipts', label: 'Receipts', module: 'Audit',
    restorePriority: 90, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: false, optional: true,
    dependencies: [],
    notes: 'metadata rows only — the stored files live in the `backups`/receipt buckets and are not part of this backup',
  },
  {
    key: 'audit_log', label: 'Audit Log', module: 'Audit',
    restorePriority: 91, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: true, optional: true,
    dependencies: [],
    notes: 'append-only: never deleted in replace mode',
  },
  {
    key: 'field_changes', label: 'Field Change Log', module: 'Audit',
    restorePriority: 92, backupEnabled: true, restoreMode: 'append',
    conflictColumn: 'id', orgScoped: true,
    requiresMigration: false, sensitive: true, optional: true,
    dependencies: [],
    notes: 'append-only: never deleted in replace mode',
  },
]

/** Backward compat alias */
export const BACKUP_TABLES = MANAGED_TABLES

/** Delete order for replace mode — derived from registry, never stale.
 *  Excludes append-mode tables (they are never deleted) and non-org-scoped
 *  tables: `deleteFull` can only scope a DELETE by `org_id`, so a table without
 *  that column (`currencies`, `organizations`) would be wiped instance-wide for
 *  every tenant. Both are restored by upsert instead. */
const DELETE_TABLES: string[] = [...MANAGED_TABLES]
  .reverse()
  .filter(t => t.restoreMode !== 'append' && t.backupEnabled && t.orgScoped !== false)
  .map(t => t.key)

/** Tables known to exist in the public schema but that are not application data */
const SYSTEM_TABLE_BLACKLIST = new Set([
  'schema_migrations',
  'schema_discovery_view', // it's a view but guard anyway
  'bank_schema_check',
])

export const SCHEMA_DISCOVERY_MIGRATION_SQL = `-- Enable automatic unmanaged table detection in backup system
CREATE OR REPLACE VIEW public.schema_discovery_view
  WITH (security_invoker = true) AS
  SELECT table_name::text
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE';
GRANT SELECT ON public.schema_discovery_view TO anon, authenticated;
NOTIFY pgrst, 'reload schema';`

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BackupManifest {
  backupVersion: string
  appVersion: string
  createdAt: string
  userId: string
  userEmail: string
  /** Tables successfully exported to managed section */
  managedTables: string[]
  /** Unregistered tables discovered and exported */
  unmanagedTables: string[]
  /** Managed tables skipped (backupEnabled: false or sensitive) */
  skippedTables: string[]
  warnings: string[]
  schemaDiscoveryAvailable: boolean
  strictMode: boolean
}

export interface BackupFileV2 {
  _meta: BackupManifest
  /** Officially supported tables in registry order */
  managed: Record<string, Record<string, unknown>[]>
  /** Unregistered tables — raw export, unverified */
  unmanaged: Record<string, Record<string, unknown>[]>
}

/** Backward compat alias */
export type BackupFile = BackupFileV2

export interface TableProgress {
  key: string
  label: string
  section: 'managed' | 'unmanaged'
  status: 'pending' | 'running' | 'done' | 'error'
  count?: number
}

export interface BackupOptions {
  /** Fail backup if unmanaged tables are detected */
  strictMode?: boolean
}

export interface SchemaCheckResult {
  discoveryAvailable: boolean
  managedTables: string[]
  unmanagedTables: string[]
  warnings: string[]
}

export interface RestoreSummaryV2 {
  backupDate: string
  appVersion: string
  backupVersion: string
  userEmail: string
  managedTables: { key: string; label: string; count: number; restoreMode: RestoreMode }[]
  unmanagedTables: { key: string; count: number }[]
  totalManagedRecords: number
  totalUnmanagedRecords: number
  modules: string[]
  warnings: string[]
}

/** Backward compat alias */
export type RestoreSummary = RestoreSummaryV2

export interface RestoreOptions {
  mode: 'merge' | 'replace'
  restoreUnmanaged: boolean
  /**
   * Required to proceed with a `replace` whose preflight reports a shortfall.
   * The caller must have shown the user exactly how many rows will be lost.
   */
  acknowledgeDataLoss?: boolean
}

export interface ReplacePreflightTable {
  key: string
  label: string
  liveRows: number
  backupRows: number
  /** Rows that exist live but are absent from the backup (0 when the backup is a superset). */
  shortfall: number
}

export interface ReplacePreflight {
  /** True when every table to be deleted is fully represented in the backup. */
  safe: boolean
  /** Only tables with shortfall > 0, worst first. */
  shortfalls: ReplacePreflightTable[]
  totalShortfall: number
  /** Tables whose live count could not be read — treated as unsafe. */
  unreadable: string[]
}

export interface RestoreResultV2 {
  success: boolean
  managedRestored: string[]
  unmanagedRestored: string[]
  errors: { table: string; section: 'managed' | 'unmanaged'; message: string }[]
  /**
   * 'atomic'  — replayed by commit_restore(); delete+insert committed together,
   *             so a failure left the ledger exactly as it was.
   * 'staged'  — the legacy per-table path; a failure may have left the org
   *             partially restored. Only reachable when the RPC is not installed.
   */
  path?: 'atomic' | 'staged'
  /** Only set on the staged path when a failure aborted the run mid-flight. */
  partiallyApplied?: boolean
}

/** Backward compat alias */
export type RestoreResult = RestoreResultV2

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ── Schema discovery ───────────────────────────────────────────────────────────

async function discoverSchemaTables(): Promise<{ tables: string[]; available: boolean }> {
  const { data, error } = await supabase
    .from('schema_discovery_view')
    .select('table_name')
    .limit(500)

  if (error) return { tables: [], available: false }

  const all = (data as { table_name: string }[]).map(r => r.table_name)
  const filtered = all.filter(t => !SYSTEM_TABLE_BLACKLIST.has(t))
  return { tables: filtered, available: true }
}

/** Developer utility: compare DB schema against managed registry */
export async function compareRegistryToSchema(): Promise<SchemaCheckResult> {
  const { tables, available } = await discoverSchemaTables()
  const managedNames = MANAGED_TABLES.map(t => t.key)

  if (!available) {
    return {
      discoveryAvailable: false,
      managedTables: managedNames,
      unmanagedTables: [],
      warnings: [
        'Schema discovery view not installed. Run the SCHEMA_DISCOVERY_MIGRATION_SQL in your Supabase SQL editor to enable automatic unmanaged table detection.',
      ],
    }
  }

  const managedSet = new Set(managedNames)
  const unmanaged  = tables.filter(t => !managedSet.has(t))
  const warnings   = unmanaged.length > 0
    ? [`${unmanaged.length} table(s) not in managed registry: ${unmanaged.join(', ')}`]
    : []

  return { discoveryAvailable: true, managedTables: managedNames, unmanagedTables: unmanaged, warnings }
}

// ── Backup creation ────────────────────────────────────────────────────────────

/**
 * Thrown when a table export cannot be proven complete.  Never swallow this —
 * an unprovable backup that is later restored in `replace` mode destroys the
 * rows it failed to capture.
 */
export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupIntegrityError'
  }
}

export interface TableFetchResult {
  rows: Record<string, unknown>[]
  warnings: string[]
}

/** PostgREST error for ordering/filtering on a column the table doesn't have. */
const MISSING_COLUMN_RE = /does not exist|42703|column .* of relation/i

/** Server-side row count for the same scope the export uses. `null` = unreachable. */
async function countTableRows(tableKey: string, orgId?: string): Promise<number | null> {
  let q = supabase.from(tableKey).select('*', { count: 'exact', head: true })
  if (orgId) q = q.eq('org_id', orgId)
  const { count, error } = await q
  if (error) return null
  return count ?? 0
}

/**
 * Exports one table in full.
 *
 * Paged through `fetchAllRows` because PostgREST enforces a server-side
 * db-max-rows cap (default 1000, see supabase/config.toml) that silently
 * overrides any client `.limit()` — a single `.select('*')` returns the first
 * 1000 rows with no error and no indication that anything was dropped.
 *
 * Every export is then asserted against an exact server-side count and the
 * whole backup is aborted on a shortfall.
 */
export async function fetchTableData(
  tableKey: string,
  onProgress?: (status: 'running' | 'done' | 'error', count?: number) => void,
  orgId?: string,
  opts?: { stableKey?: string },
): Promise<TableFetchResult> {
  onProgress?.('running')
  const warnings: string[] = []
  const stableKey = opts?.stableKey ?? 'id'

  const build = () => {
    let q = supabase.from(tableKey).select('*')
    if (orgId) q = q.eq('org_id', orgId)
    return q
  }

  // Probe first: distinguishes "table absent / not readable" (skip, warn) from
  // "table readable but export came back short" (hard fail).
  const expected = await countTableRows(tableKey, orgId)
  if (expected === null) {
    warnings.push(`${tableKey}: not readable (missing table or denied by RLS) — exported as empty.`)
    onProgress?.('done', 0)
    return { rows: [], warnings }
  }

  let { data, error } = await fetchAllRows<Record<string, unknown>>(build, stableKey)

  // Unmanaged tables discovered at runtime may have no `id` column at all; an
  // ORDER BY on a missing column errors and would otherwise export as empty.
  // Fall back to one unordered page — the count assertion below still refuses
  // to let a >1-page table through on that path.
  if (error && MISSING_COLUMN_RE.test(error.message)) {
    warnings.push(
      `${tableKey}: no '${stableKey}' column — paged export unavailable, fell back to a single unordered page.`,
    )
    const single = await build()
    data  = (single.data ?? []) as Record<string, unknown>[]
    error = single.error
  }

  if (error) {
    onProgress?.('error')
    throw new BackupIntegrityError(`${tableKey}: export failed — ${error.message}`)
  }

  const rows = data ?? []

  if (rows.length < expected) {
    // Re-count before failing: a concurrent delete between probe and export is
    // a legitimate reason for a shortfall, truncation is not.
    const recount = await countTableRows(tableKey, orgId)
    if (recount === null || rows.length < recount) {
      onProgress?.('error')
      throw new BackupIntegrityError(
        `${tableKey}: exported ${rows.length} of ${recount ?? expected} rows. ` +
        'Backup aborted — an incomplete backup restored in replace mode would delete the missing rows.',
      )
    }
  }

  onProgress?.('done', rows.length)
  return { rows, warnings }
}

export type BackupProgressCallback = (
  section: 'managed' | 'unmanaged',
  key: string,
  status: 'running' | 'done' | 'error',
  count?: number,
) => void

export async function createBackup(
  userId: string,
  userEmail: string,
  options?: BackupOptions,
  onProgress?: BackupProgressCallback,
  orgId?: string,
): Promise<BackupFileV2> {
  // 1. Discover schema to find unmanaged tables
  const { tables: schemaTables, available: discoveryAvailable } = await discoverSchemaTables()
  const managedNames  = new Set(MANAGED_TABLES.filter(t => t.backupEnabled).map(t => t.key))
  const skippedTables = MANAGED_TABLES.filter(t => !t.backupEnabled).map(t => t.key)
  const unmanagedKeys = discoveryAvailable
    ? schemaTables.filter(t => !managedNames.has(t))
    : []

  const warnings: string[] = []
  if (!discoveryAvailable) {
    warnings.push('Schema discovery view not installed — unmanaged tables could not be detected. Run SCHEMA_DISCOVERY_MIGRATION_SQL to enable.')
  } else if (unmanagedKeys.length > 0) {
    warnings.push(
      `${unmanagedKeys.length} unmanaged table(s) detected and exported as raw backups: ${unmanagedKeys.join(', ')}`,
    )
  }

  if (options?.strictMode && unmanagedKeys.length > 0) {
    throw new Error(
      `Strict mode: ${unmanagedKeys.length} unmanaged table(s) detected (${unmanagedKeys.join(', ')}). Register them in MANAGED_TABLES before backing up.`,
    )
  }

  // 2. Export managed tables (org-scoped tables filtered to active org)
  const managed: Record<string, Record<string, unknown>[]> = {}
  for (const def of MANAGED_TABLES.filter(t => t.backupEnabled)) {
    const tableOrgId = (def.orgScoped && orgId) ? orgId : undefined
    // Page on the table's own PK — `currencies` keys on `code`, not `id`.
    const res = await fetchTableData(def.key, (status, count) => {
      onProgress?.('managed', def.key, status, count)
    }, tableOrgId, { stableKey: def.conflictColumn })
    managed[def.key] = res.rows
    warnings.push(...res.warnings)
  }

  // 3. Export unmanaged tables (raw, unverified — no org filter, rely on RLS)
  const unmanaged: Record<string, Record<string, unknown>[]> = {}
  for (const tableKey of unmanagedKeys) {
    const res = await fetchTableData(tableKey, (status, count) => {
      onProgress?.('unmanaged', tableKey, status, count)
    })
    unmanaged[tableKey] = res.rows
    warnings.push(...res.warnings)
  }

  return {
    _meta: {
      backupVersion: BACKUP_VERSION,
      appVersion:    APP_VERSION,
      createdAt:     new Date().toISOString(),
      userId,
      userEmail,
      managedTables:             Object.keys(managed),
      unmanagedTables:           Object.keys(unmanaged),
      skippedTables,
      warnings,
      schemaDiscoveryAvailable:  discoveryAvailable,
      strictMode:                options?.strictMode ?? false,
    },
    managed,
    unmanaged,
  }
}

// ── v1 → v2 normalization ──────────────────────────────────────────────────────

/** Converts a v1 backup (flat `data:{}`) to v2 shape. v2 files pass through unchanged. */
export function normalizeToV2(raw: unknown): BackupFileV2 {
  const obj  = raw as Record<string, unknown>
  const meta = (obj._meta ?? {}) as Record<string, unknown>

  const isV1 = meta.backupVersion === '1' || ('data' in obj && !('managed' in obj))
  if (!isV1) return raw as BackupFileV2

  const data        = (obj.data ?? {}) as Record<string, Record<string, unknown>[]>
  const managedSet  = new Set(MANAGED_TABLES.map(t => t.key))
  const managed:   Record<string, Record<string, unknown>[]> = {}
  const unmanaged: Record<string, Record<string, unknown>[]> = {}

  for (const [key, rows] of Object.entries(data)) {
    if (managedSet.has(key)) managed[key]   = rows
    else                      unmanaged[key] = rows
  }

  return {
    _meta: {
      backupVersion:            BACKUP_VERSION,
      appVersion:               (meta.appVersion as string)   ?? 'unknown',
      createdAt:                (meta.createdAt  as string)   ?? '',
      userId:                   (meta.userId     as string)   ?? '',
      userEmail:                (meta.userEmail  as string)   ?? 'unknown',
      managedTables:            Object.keys(managed),
      unmanagedTables:          Object.keys(unmanaged),
      skippedTables:            [],
      warnings:                 ['Imported from v1 backup — schema discovery was not available at backup time'],
      schemaDiscoveryAvailable: false,
      strictMode:               false,
    },
    managed,
    unmanaged,
  }
}

// ── Download ───────────────────────────────────────────────────────────────────

export function downloadBackup(backup: BackupFileV2): void {
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const date = backup._meta.createdAt.slice(0, 10)
  a.href     = url
  a.download = `organisation-finance-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Cloud link ─────────────────────────────────────────────────────────────────

export async function uploadBackupForLink(backup: BackupFileV2, userId: string, orgId?: string): Promise<string> {
  const json = JSON.stringify(backup)
  const blob = new Blob([json], { type: 'application/json' })
  const date = backup._meta.createdAt.slice(0, 10)
  // Path: {userId}/{orgId}/backup-{date}-{ts}.json — org segment scopes storage policy
  const orgSegment = orgId ?? 'unscoped'
  const path = `${userId}/${orgSegment}/backup-${date}-${Date.now()}.json`

  const { error: uploadError } = await supabase.storage
    .from('backups')
    .upload(path, blob, { contentType: 'application/json', upsert: true })

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { data, error: urlError } = await supabase.storage
    .from('backups')
    .createSignedUrl(path, 60 * 60 * 24 * 7)

  if (urlError || !data?.signedUrl) {
    throw new Error(`Could not generate signed URL: ${urlError?.message ?? 'unknown'}`)
  }

  return data.signedUrl
}

// ── Validation ─────────────────────────────────────────────────────────────────

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

  // Accept v1 (data:{}) or v2 (managed:{})
  const hasV1Data    = 'data'    in b && typeof b.data    === 'object'
  const hasV2Managed = 'managed' in b && typeof b.managed === 'object'

  if (!hasV1Data && !hasV2Managed) {
    errors.push('Missing data section (expected data: or managed: key)')
  } else {
    const payload = (hasV2Managed ? b.managed : b.data) as Record<string, unknown>
    const corePresent = ['inflow_transactions', 'outflow_transactions', 'categories', 'banks'].some(
      t => Array.isArray(payload[t]),
    )
    if (!corePresent) errors.push('Backup appears empty or corrupt — no core tables found')
  }

  return { valid: errors.length === 0, errors }
}

// ── Restore summary ────────────────────────────────────────────────────────────

export function getRestoreSummary(backup: BackupFileV2): RestoreSummaryV2 {
  const managedDefs = MANAGED_TABLES.filter(def => Array.isArray(backup.managed[def.key]))
  const managedTables = managedDefs.map(def => ({
    key:         def.key,
    label:       def.label,
    count:       (backup.managed[def.key] ?? []).length,
    restoreMode: def.restoreMode,
  }))

  const unmanagedTables = Object.entries(backup.unmanaged ?? {}).map(([key, rows]) => ({
    key,
    count: Array.isArray(rows) ? rows.length : 0,
  }))

  const totalManagedRecords   = managedTables.reduce((s, t) => s + t.count, 0)
  const totalUnmanagedRecords = unmanagedTables.reduce((s, t) => s + t.count, 0)
  const moduleSet             = new Set(managedDefs.map(d => d.module))

  return {
    backupDate:          backup._meta.createdAt,
    appVersion:          backup._meta.appVersion   ?? 'unknown',
    backupVersion:       backup._meta.backupVersion,
    userEmail:           backup._meta.userEmail    ?? 'unknown',
    managedTables,
    unmanagedTables,
    totalManagedRecords,
    totalUnmanagedRecords,
    modules:             Array.from(moduleSet),
    warnings:            backup._meta.warnings ?? [],
  }
}

// ── Restore execution ──────────────────────────────────────────────────────────

const BATCH_SIZE = 500

async function insertBatch(
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from(table)
      .upsert(batch as never, { onConflict: conflictColumn })
    if (error) throw new Error(error.message)
  }
}

// orgId is required: RLS grants delete on every org the caller is a finance
// user of, so an unscoped "replace" restore wipes the user's *other* orgs
// along with this one.
async function deleteFull(table: string, orgId: string): Promise<void> {
  const def = MANAGED_TABLES.find(t => t.key === table)
  const pk  = def?.conflictColumn ?? 'id'
  let q = supabase.from(table).delete().not(pk, 'is', null)
  if (def?.orgScoped !== false) q = q.eq('org_id', orgId)
  const { error } = await q
  if (error) throw new Error(error.message)
}

/**
 * Server-side snapshot taken before a `replace` restore deletes anything:
 * compares each to-be-deleted table's live row count against what the backup
 * actually carries.  A backup that is short — truncated, stale, or taken from
 * a different org — is the one input that turns `replace` into data loss.
 */
export async function preflightReplace(
  backup: BackupFileV2,
  orgId: string,
): Promise<ReplacePreflight> {
  const shortfalls: ReplacePreflightTable[] = []
  const unreadable: string[] = []

  for (const tableKey of DELETE_TABLES) {
    const def = MANAGED_TABLES.find(t => t.key === tableKey)
    const liveRows = await countTableRows(tableKey, def?.orgScoped !== false ? orgId : undefined)
    if (liveRows === null) { unreadable.push(tableKey); continue }
    const backupRows = (backup.managed[tableKey] ?? []).length
    if (backupRows < liveRows) {
      shortfalls.push({
        key: tableKey,
        label: def?.label ?? tableKey,
        liveRows,
        backupRows,
        shortfall: liveRows - backupRows,
      })
    }
  }

  shortfalls.sort((a, b) => b.shortfall - a.shortfall)

  return {
    safe: shortfalls.length === 0 && unreadable.length === 0,
    shortfalls,
    totalShortfall: shortfalls.reduce((s, t) => s + t.shortfall, 0),
    unreadable,
  }
}

export type RestoreProgressCallback = (
  section: 'managed' | 'unmanaged',
  key: string,
  status: 'running' | 'done' | 'error',
  count?: number,
) => void

// ── Atomic restore (commit_restore RPC) ───────────────────────────────────────

/** Migration that installs the atomic path. Surfaced in operator-facing errors. */
export const ATOMIC_RESTORE_MIGRATION = '20260806000002_atomic_restore_rpc.sql'

/** Rows per staging insert. Chunking the *upload* is safe — only the commit
 *  has to be atomic, and that is one RPC call regardless of payload size. */
const STAGE_CHUNK_SIZE = 500

/** PostgREST/Postgres signatures for "this migration has not been run". */
function isNotInstalled(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  // PGRST202/PGRST205: function or table absent from the schema cache.
  // 42883 undefined_function, 42P01 undefined_table.
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(err.code ?? '')) return true
  return /schema cache|does not exist/i.test(err.message ?? '')
}

/**
 * True when `commit_restore` and its staging tables are present, i.e. restore
 * can run as a single transaction. False means the deployment is still on the
 * legacy per-table path and `replace` mode is unsafe.
 */
export async function isAtomicRestoreAvailable(): Promise<boolean> {
  const { error } = await supabase
    .from('restore_allowed_tables')
    .select('table_key', { head: true, count: 'exact' })
    .limit(1)
  return !error
}

/**
 * Stages the whole payload, then replays it in one server-side transaction.
 * Returns `null` (having touched nothing) when the migration is not installed,
 * so the caller can decide what to do rather than silently degrading.
 */
async function restoreAtomic(
  backup: BackupFileV2,
  options: RestoreOptions,
  orgId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResultV2 | null> {
  const active = MANAGED_TABLES.filter(def => {
    const rows = backup.managed[def.key]
    return def.backupEnabled && Array.isArray(rows) && rows.length > 0
  })

  const { data: batch, error: batchErr } = await supabase
    .from('restore_batches')
    .insert({ org_id: orgId } as never)
    .select('id')
    .single()

  if (batchErr) {
    if (isNotInstalled(batchErr)) return null
    throw new Error(`Could not open a restore batch: ${batchErr.message}`)
  }
  const batchId = (batch as { id: string }).id

  const abandon = async () => {
    // Best-effort: staged rows are inert, and purge_stale_restore_batches()
    // sweeps anything left behind.
    await supabase.from('restore_batches').update({ status: 'aborted' } as never).eq('id', batchId)
  }

  try {
    for (const def of active) {
      const rows = backup.managed[def.key] as Record<string, unknown>[]
      onProgress?.('managed', def.key, 'running')

      for (let i = 0; i < rows.length; i += STAGE_CHUNK_SIZE) {
        const { error } = await supabase
          .from('restore_staging')
          .insert({ batch_id: batchId, table_key: def.key, rows: rows.slice(i, i + STAGE_CHUNK_SIZE) } as never)
        if (error) {
          if (isNotInstalled(error)) { await abandon(); return null }
          throw new Error(`${def.key}: staging failed — ${error.message}`)
        }
      }
    }

    const { error: commitErr } = await supabase.rpc('commit_restore', {
      p_batch_id:              batchId,
      p_mode:                  options.mode,
      p_acknowledge_data_loss: options.acknowledgeDataLoss ?? false,
    })

    if (commitErr) {
      if (isNotInstalled(commitErr)) { await abandon(); return null }
      throw new Error(commitErr.message)
    }
  } catch (e) {
    // Nothing was applied: the delete and the insert both live inside
    // commit_restore's transaction, so a throw here means the ledger is
    // untouched. Report per-table so the modal can stop showing spinners.
    for (const def of active) onProgress?.('managed', def.key, 'error')
    await abandon()
    throw e instanceof Error ? e : new Error('Restore failed')
  }

  for (const def of active) {
    onProgress?.('managed', def.key, 'done', (backup.managed[def.key] ?? []).length)
  }

  return {
    success: true,
    managedRestored: active.map(d => d.key),
    unmanagedRestored: [],
    errors: [],
    path: 'atomic',
  }
}

// ── Legacy path ───────────────────────────────────────────────────────────────

/**
 * Pre-RPC restore: each delete and each 500-row upsert is its own commit, so a
 * failure anywhere leaves the org partially restored with no rollback. Retained
 * only for deployments that have not run {@link ATOMIC_RESTORE_MIGRATION}, and
 * it now fails fast — the first error aborts rather than pressing on. A
 * half-restored ledger is worse than an aborted one: it looks valid.
 */
async function restoreStaged(
  backup: BackupFileV2,
  options: RestoreOptions,
  orgId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResultV2> {
  const managedRestored:   string[] = []
  const unmanagedRestored: string[] = []
  const errors: RestoreResultV2['errors'] = []
  let destructiveStarted = false

  // ── Replace: delete in reverse dependency order ──────────────────────────────
  // receipts / audit_log / field_changes are not wiped here — they are
  // registered as append-mode tables, so DELETE_TABLES excludes them and the
  // audit trail survives every restore.
  if (options.mode === 'replace') {
    for (const tableKey of DELETE_TABLES) {
      try {
        destructiveStarted = true
        await deleteFull(tableKey, orgId)
      } catch (e) {
        // Abort before a single row is inserted. Continuing would delete the
        // remaining tables and then insert on top of a partial wipe.
        errors.push({
          table: tableKey,
          section: 'managed',
          message: `Replace-mode delete failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        })
        onProgress?.('managed', tableKey, 'error')
        return {
          success: false,
          managedRestored,
          unmanagedRestored,
          errors,
          path: 'staged',
          partiallyApplied: true,
        }
      }
    }
  }

  // ── Managed tables: registry order ──────────────────────────────────────────
  for (const def of MANAGED_TABLES.filter(t => t.backupEnabled)) {
    const rows = backup.managed[def.key]
    if (!Array.isArray(rows) || rows.length === 0) continue

    onProgress?.('managed', def.key, 'running')
    try {
      // In replace mode, append-mode tables skip delete (already excluded from
      // DELETE_TABLES) and are always upserted
      await insertBatch(def.key, rows, def.conflictColumn)
      managedRestored.push(def.key)
      destructiveStarted = true
      onProgress?.('managed', def.key, 'done', rows.length)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      errors.push({ table: def.key, section: 'managed', message: msg })
      onProgress?.('managed', def.key, 'error')
      // Stop here: later tables reference this one, and every table restored
      // after a failure widens the inconsistency.
      return {
        success: false,
        managedRestored,
        unmanagedRestored,
        errors,
        path: 'staged',
        partiallyApplied: destructiveStarted,
      }
    }
  }

  // ── Unmanaged tables: always merge, always after managed, fully isolated ─────
  if (options.restoreUnmanaged) {
    for (const [tableKey, rows] of Object.entries(backup.unmanaged ?? {})) {
      if (!Array.isArray(rows) || rows.length === 0) continue

      onProgress?.('unmanaged', tableKey, 'running')
      try {
        // Unmanaged tables: use 'id' as default conflict column; if table has no id
        // the upsert degrades to insert — acceptable for unknown tables
        await insertBatch(tableKey, rows, 'id')
        unmanagedRestored.push(tableKey)
        onProgress?.('unmanaged', tableKey, 'done', rows.length)
      } catch (e) {
        // Fully isolated — unmanaged failure never propagates
        const msg = e instanceof Error ? e.message : 'Unknown error'
        errors.push({ table: tableKey, section: 'unmanaged', message: msg })
        onProgress?.('unmanaged', tableKey, 'error')
      }
    }
  }

  const managedErrors = errors.filter(e => e.section === 'managed')
  return {
    success: managedErrors.length === 0,
    managedRestored,
    unmanagedRestored,
    errors,
    path: 'staged',
  }
}

export async function restoreFromBackup(
  backup: BackupFileV2,
  options: RestoreOptions,
  orgId: string,
  onProgress?: RestoreProgressCallback,
): Promise<RestoreResultV2> {
  // Runs on both paths. commit_restore repeats the check server-side, but doing
  // it here keeps the failure cheap and the message specific.
  if (options.mode === 'replace') {
    const preflight = await preflightReplace(backup, orgId)
    if (!preflight.safe && !options.acknowledgeDataLoss) {
      const detail = preflight.shortfalls
        .slice(0, 5)
        .map(t => `${t.label}: ${t.liveRows.toLocaleString()} live vs ${t.backupRows.toLocaleString()} in backup`)
        .join('; ')
      throw new Error(
        'Replace aborted: the backup holds fewer rows than the live data, so replacing would ' +
        `permanently delete ${preflight.totalShortfall.toLocaleString()} row(s). ` +
        (detail ? `${detail}. ` : '') +
        (preflight.unreadable.length > 0 ? `Could not read live counts for: ${preflight.unreadable.join(', ')}. ` : '') +
        'Use merge mode, or re-confirm explicitly to proceed.',
      )
    }
  }

  const atomic = await restoreAtomic(backup, options, orgId, onProgress)

  if (atomic) {
    // Unmanaged tables are outside the allowlist and therefore outside the
    // transaction. They are best-effort by definition and run only after the
    // managed commit has succeeded.
    if (options.restoreUnmanaged) {
      for (const [tableKey, rows] of Object.entries(backup.unmanaged ?? {})) {
        if (!Array.isArray(rows) || rows.length === 0) continue
        onProgress?.('unmanaged', tableKey, 'running')
        try {
          await insertBatch(tableKey, rows, 'id')
          atomic.unmanagedRestored.push(tableKey)
          onProgress?.('unmanaged', tableKey, 'done', rows.length)
        } catch (e) {
          atomic.errors.push({
            table: tableKey,
            section: 'unmanaged',
            message: e instanceof Error ? e.message : 'Unknown error',
          })
          onProgress?.('unmanaged', tableKey, 'error')
        }
      }
    }
    return atomic
  }

  // ── Fallback: migration not installed ───────────────────────────────────────
  // `replace` without a transaction is the exact scenario the audit flagged:
  // the delete can succeed and the insert fail, leaving nothing behind. Refuse
  // it rather than offer a destructive best-effort.
  if (options.mode === 'replace') {
    throw new Error(
      'Replace mode is unavailable: this database has not been migrated to atomic restore, ' +
      `so the delete and the insert cannot be committed together. Run ${ATOMIC_RESTORE_MIGRATION}, ` +
      'or use merge mode, which never deletes.',
    )
  }

  return restoreStaged(backup, options, orgId, onProgress)
}

// ── File parsing ───────────────────────────────────────────────────────────────

export async function parseBackupFile(file: File): Promise<BackupFileV2> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        resolve(normalizeToV2(parsed))
      } catch {
        reject(new Error('Invalid JSON file — the backup may be corrupted'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
