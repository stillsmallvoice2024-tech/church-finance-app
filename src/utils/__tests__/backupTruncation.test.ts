import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Fake PostgREST ────────────────────────────────────────────────────────────
// Models the behaviour that caused the bug: the server caps every response at
// `max_rows` (1000 by default) regardless of any client-side .limit().

interface FakeTable {
  rows: Record<string, unknown>[]
  /** Server row cap per response — mirrors supabase/config.toml `max_rows`. */
  maxRows: number
  /** Column that does not exist on this table; ordering by it errors. */
  missingColumn?: string
  /** When set, every request to this table fails with this message. */
  error?: string
  /** Counting works but the row export fails — a readable table, broken mid-export. */
  selectError?: string
  /** Pages after the first come back empty — simulates a short/flaky export. */
  truncateAfterFirstPage?: boolean
  /** Deletes against this table fail with this message. */
  deleteError?: string
}

const db: Record<string, FakeTable> = {}
const calls = {
  orders:  [] as { table: string; column: string }[],
  deletes: [] as string[],
  upserts: [] as { table: string; count: number }[],
}

/** Whether the atomic-restore migration is installed in this fake instance. */
let atomicInstalled = true

function table(name: string, rows: Record<string, unknown>[], extra: Partial<FakeTable> = {}): void {
  db[name] = { rows, maxRows: 1000, ...extra }
}

function makeBuilder(name: string) {
  const state = {
    head: false, org: undefined as string | undefined,
    orderCol: undefined as string | undefined,
    from: 0, to: Number.POSITIVE_INFINITY,
    op: 'select' as 'select' | 'delete' | 'upsert' | 'insert' | 'update',
    payload: [] as Record<string, unknown>[],
    idFilter: undefined as string | undefined,
  }

  async function exec(): Promise<{ data: unknown; count: number | null; error: { message: string } | null }> {
    const t = db[name]
    if (!t)       return { data: null, count: null, error: { message: `relation "public.${name}" does not exist` } }
    if (t.error)  return { data: null, count: null, error: { message: t.error } }

    if (state.op === 'insert') {
      const inserted = state.payload.map((r, i) => ({ id: r.id ?? `${name}-${t.rows.length + i}`, ...r }))
      t.rows.push(...inserted)
      return { data: inserted, count: null, error: null }
    }
    if (state.op === 'update') {
      for (const r of t.rows) {
        if (state.idFilter === undefined || r.id === state.idFilter) Object.assign(r, state.payload[0])
      }
      return { data: null, count: null, error: null }
    }
    if (state.op === 'delete') {
      if (t.deleteError) return { data: null, count: null, error: { message: t.deleteError } }
      calls.deletes.push(name)
      t.rows = state.org ? t.rows.filter(r => r.org_id !== state.org) : []
      return { data: null, count: null, error: null }
    }
    if (state.op === 'upsert') return { data: null, count: null, error: null }

    if (state.orderCol && t.missingColumn === state.orderCol) {
      return { data: null, count: null, error: { message: `column ${name}.${state.orderCol} does not exist` } }
    }

    const visible = state.org ? t.rows.filter(r => r.org_id === state.org) : t.rows
    if (state.head) return { data: null, count: visible.length, error: null }
    if (t.selectError) return { data: null, count: null, error: { message: t.selectError } }

    if (t.truncateAfterFirstPage && state.from > 0) return { data: [], count: null, error: null }

    const end = Math.min(state.to + 1, state.from + t.maxRows)
    return { data: visible.slice(state.from, end), count: null, error: null }
  }

  const b = {
    select(_sel: string, opts?: { count?: string; head?: boolean }) { state.head = !!opts?.head; return b },
    eq(col: string, val: string) {
      if (col === 'org_id') state.org = val
      if (col === 'id')     state.idFilter = val
      return b
    },
    not() { return b },
    limit() { return b },
    order(column: string) { state.orderCol = column; calls.orders.push({ table: name, column }); return b },
    range(from: number, to: number) { state.from = from; state.to = to; return exec() },
    delete() { state.op = 'delete'; return b },
    insert(rows: unknown) {
      state.op = 'insert'
      state.payload = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
      return b
    },
    update(patch: unknown) { state.op = 'update'; state.payload = [patch as Record<string, unknown>]; return b },
    single() {
      return exec().then(r => ({
        data:  Array.isArray(r.data) ? r.data[0] : r.data,
        error: r.error,
      }))
    },
    upsert(rows: unknown[]) {
      state.op = 'upsert'
      calls.upserts.push({ table: name, count: rows.length })
      return b
    },
    then<A, B>(res: (v: Awaited<ReturnType<typeof exec>>) => A, rej?: (e: unknown) => B) {
      return exec().then(res, rej)
    },
  }
  return b as never
}

/**
 * Stands in for commit_restore(). The point under test is transactional
 * behaviour, so this applies every delete and every insert against a copy and
 * only publishes it if the whole replay succeeds.
 */
async function fakeRpc(
  fn: string,
  args: { p_batch_id: string; p_mode: string; p_acknowledge_data_loss: boolean },
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  if (fn !== 'commit_restore' || !atomicInstalled) {
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.commit_restore in the schema cache' } }
  }

  const staged = (db.restore_staging?.rows ?? []).filter(r => r.batch_id === args.p_batch_id) as
    { table_key: string; rows: Record<string, unknown>[] }[]
  const batch = (db.restore_batches?.rows ?? []).find(r => r.id === args.p_batch_id)
  const orgId = batch?.org_id as string

  // Snapshot: the rollback the real function gets from its transaction.
  const before = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, [...v.rows]]))
  const restore = () => { for (const [k, rows] of Object.entries(before)) db[k].rows = rows }

  const deletable = MANAGED_TABLES
    .filter(t => t.restoreMode !== 'append' && t.backupEnabled && t.orgScoped !== false)
    .map(t => t.key).reverse()

  try {
    if (args.p_mode === 'replace') {
      for (const key of deletable) {
        const t = db[key]
        if (!t) continue
        if (t.deleteError) throw new Error(t.deleteError)
        calls.deletes.push(key)
        t.rows = t.rows.filter(r => r.org_id !== orgId)
      }
    }
    for (const def of MANAGED_TABLES) {
      const rows = staged.filter(s => s.table_key === def.key).flatMap(s => s.rows)
      if (rows.length === 0) continue
      const t = db[def.key]
      if (!t) throw new Error(`relation "public.${def.key}" does not exist`)
      if (t.error) throw new Error(t.error)
      calls.upserts.push({ table: def.key, count: rows.length })
      t.rows.push(...rows.map(r => ({ ...r, org_id: def.orgScoped === false ? r.org_id : orgId })))
    }
  } catch (e) {
    restore()
    return { data: null, error: { message: e instanceof Error ? e.message : 'commit failed' } }
  }

  db.restore_staging.rows = db.restore_staging.rows.filter(r => r.batch_id !== args.p_batch_id)
  return { data: { counts: {} }, error: null }
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (name: string) => makeBuilder(name),
    rpc:  (fn: string, args: never) => fakeRpc(fn, args),
  },
}))

const {
  fetchTableData, preflightReplace, restoreFromBackup,
  BackupIntegrityError, MANAGED_TABLES,
} = await import('../backupRestore')
const { BACKUP_VERSION } = await import('../backupRestore')

const ORG = 'org-1'
const rowsFor = (n: number, org = ORG) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, code: `c${i}`, org_id: org }))

function emptyDb(): void {
  for (const k of Object.keys(db)) delete db[k]
  for (const def of MANAGED_TABLES) table(def.key, [])
  // Installed by the atomic-restore migration.
  table('restore_allowed_tables', [])
  table('restore_batches', [])
  table('restore_staging', [])
  atomicInstalled = true
  calls.orders = []; calls.deletes = []; calls.upserts = []
}

/** Removes the atomic-restore migration — the pre-RPC deployment. */
function uninstallAtomic(): void {
  delete db.restore_allowed_tables
  delete db.restore_batches
  delete db.restore_staging
  atomicInstalled = false
}

function backupOf(managed: Record<string, Record<string, unknown>[]>) {
  return {
    _meta: {
      backupVersion: BACKUP_VERSION, appVersion: '1.0.0', createdAt: new Date().toISOString(),
      userId: 'u1', userEmail: 'u@example.com', managedTables: Object.keys(managed),
      unmanagedTables: [], skippedTables: [], warnings: [],
      schemaDiscoveryAvailable: true, strictMode: false,
    },
    managed,
    unmanaged: {},
  }
}

beforeEach(emptyDb)

// ── 1. The truncation bug ─────────────────────────────────────────────────────

describe('fetchTableData paging (regression: silent 1,000-row truncation)', () => {
  it('exports every row of a table far larger than the server max_rows cap', async () => {
    table('inflow_transactions', rowsFor(2500))
    const { rows } = await fetchTableData('inflow_transactions', undefined, ORG)
    expect(rows).toHaveLength(2500)
  })

  it('reports the true row count to the progress callback, not the capped one', async () => {
    table('inflow_transactions', rowsFor(2500))
    const seen: (number | undefined)[] = []
    await fetchTableData('inflow_transactions', (_s, c) => seen.push(c), ORG)
    expect(seen[seen.length - 1]).toBe(2500)
  })

  it('only returns rows belonging to the requested org', async () => {
    table('inflow_transactions', [...rowsFor(1500), ...rowsFor(1200, 'other-org')])
    const { rows } = await fetchTableData('inflow_transactions', undefined, ORG)
    expect(rows).toHaveLength(1500)
    expect(rows.every(r => r.org_id === ORG)).toBe(true)
  })
})

// ── 2 & 3. Completeness assertion ─────────────────────────────────────────────

describe('fetchTableData completeness assertion', () => {
  it('hard-fails when the export comes back short of the server count', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    await expect(fetchTableData('inflow_transactions', undefined, ORG))
      .rejects.toBeInstanceOf(BackupIntegrityError)
  })

  it('names the shortfall in the error so it cannot be mistaken for success', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    await expect(fetchTableData('inflow_transactions', undefined, ORG))
      .rejects.toThrow(/exported 1000 of 2500 rows/)
  })

  it('signals error — never done — to the progress callback on a shortfall', async () => {
    table('inflow_transactions', rowsFor(2500), { truncateAfterFirstPage: true })
    const seen: string[] = []
    await fetchTableData('inflow_transactions', s => seen.push(s), ORG).catch(() => {})
    expect(seen).toContain('error')
    expect(seen).not.toContain('done')
  })

  it('throws rather than exporting empty when a readable table errors mid-export', async () => {
    table('inflow_transactions', rowsFor(10), { selectError: 'connection reset' })
    await expect(fetchTableData('inflow_transactions', undefined, ORG)).rejects.toThrow(/connection reset/)
  })

  it('skips an unreachable table with a warning instead of failing the backup', async () => {
    const { rows, warnings } = await fetchTableData('table_that_does_not_exist', undefined, ORG)
    expect(rows).toEqual([])
    expect(warnings.join(' ')).toMatch(/not readable/)
  })
})

// ── 4. Non-`id` primary keys ──────────────────────────────────────────────────

describe('fetchTableData stable key', () => {
  it('pages currencies by its real PK (code), not id', async () => {
    table('currencies', rowsFor(1200).map(r => ({ code: r.code })), { missingColumn: 'id' })
    const { rows } = await fetchTableData('currencies', undefined, undefined, { stableKey: 'code' })
    expect(rows).toHaveLength(1200)
    expect(calls.orders.filter(o => o.table === 'currencies').every(o => o.column === 'code')).toBe(true)
  })

  it('falls back to one unordered page when the table has no stable key', async () => {
    table('legacy_table', rowsFor(400), { missingColumn: 'id' })
    const { rows, warnings } = await fetchTableData('legacy_table', undefined, ORG)
    expect(rows).toHaveLength(400)
    expect(warnings.join(' ')).toMatch(/single unordered page/)
  })

  it('still refuses a keyless table too large for one page', async () => {
    table('legacy_table', rowsFor(2500), { missingColumn: 'id' })
    await expect(fetchTableData('legacy_table', undefined, ORG))
      .rejects.toBeInstanceOf(BackupIntegrityError)
  })
})

// ── 5. Audit tables are registered and never deleted ──────────────────────────

describe('audit trail survives replace mode', () => {
  it('registers receipts, audit_log and field_changes as append-mode', () => {
    for (const key of ['receipts', 'audit_log', 'field_changes']) {
      const def = MANAGED_TABLES.find(t => t.key === key)
      expect(def, `${key} must be in the managed registry`).toBeDefined()
      expect(def?.restoreMode).toBe('append')
      expect(def?.backupEnabled).toBe(true)
    }
  })

  it('does not delete them during a replace restore', async () => {
    table('inflow_transactions', rowsFor(5))
    table('receipts', rowsFor(3)); table('audit_log', rowsFor(3)); table('field_changes', rowsFor(3))
    await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(calls.deletes).not.toContain('receipts')
    expect(calls.deletes).not.toContain('audit_log')
    expect(calls.deletes).not.toContain('field_changes')
    expect(db.audit_log.rows).toHaveLength(3)
  })
})

// ── 6. Replace-mode preflight ─────────────────────────────────────────────────

describe('preflightReplace', () => {
  it('flags a backup that holds fewer rows than the live table', async () => {
    table('inflow_transactions', rowsFor(2500))
    const pf = await preflightReplace(backupOf({ inflow_transactions: rowsFor(1000) }), ORG)
    expect(pf.safe).toBe(false)
    expect(pf.totalShortfall).toBe(1500)
    expect(pf.shortfalls[0]).toMatchObject({ key: 'inflow_transactions', liveRows: 2500, backupRows: 1000 })
  })

  it('passes a backup that covers every live row', async () => {
    table('inflow_transactions', rowsFor(40))
    const pf = await preflightReplace(backupOf({ inflow_transactions: rowsFor(40) }), ORG)
    expect(pf.safe).toBe(true)
    expect(pf.totalShortfall).toBe(0)
  })

  it('treats an unreadable table as unsafe rather than assuming zero', async () => {
    delete db.inflow_transactions
    const pf = await preflightReplace(backupOf({}), ORG)
    expect(pf.safe).toBe(false)
    expect(pf.unreadable).toContain('inflow_transactions')
  })
})

describe('restoreFromBackup replace guard', () => {
  it('aborts before deleting anything when the backup is short', async () => {
    table('inflow_transactions', rowsFor(2500))
    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1000) }),
      { mode: 'replace', restoreUnmanaged: false },
      ORG,
    )).rejects.toThrow(/Replace aborted/)
    expect(calls.deletes).toEqual([])
    expect(db.inflow_transactions.rows).toHaveLength(2500)
  })

  it('proceeds when the data loss is explicitly acknowledged', async () => {
    table('inflow_transactions', rowsFor(2500))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1000) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(calls.deletes).toContain('inflow_transactions')
    expect(res.success).toBe(true)
  })

  it('never blocks merge mode', async () => {
    table('inflow_transactions', rowsFor(2500))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(1) }),
      { mode: 'merge', restoreUnmanaged: false },
      ORG,
    )
    expect(res.success).toBe(true)
    expect(calls.deletes).toEqual([])
  })
})

// ── 7. Failed deletes never leave a half-applied replace ──────────────────────

describe('replace-mode delete errors', () => {
  it('rolls the whole restore back rather than leaving the ledger half-wiped', async () => {
    table('inflow_transactions', rowsFor(5), { deleteError: 'permission denied for table inflow_transactions' })
    table('banks', rowsFor(4))

    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5), banks: rowsFor(4) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )).rejects.toThrow(/permission denied/)

    // Both tables are exactly as they were: the delete of `banks` that
    // succeeded before the failure was rolled back with it.
    expect(db.inflow_transactions.rows).toHaveLength(5)
    expect(db.banks.rows).toHaveLength(4)
  })

  it('reports the failure through the staged path when the migration is absent', async () => {
    uninstallAtomic()
    table('inflow_transactions', rowsFor(5), { deleteError: 'permission denied' })
    // Replace is refused outright without a transaction to run it in.
    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )).rejects.toThrow(/Replace mode is unavailable/)
    expect(calls.deletes).toEqual([])
    expect(db.inflow_transactions.rows).toHaveLength(5)
  })
})

// ── 8. Atomicity ──────────────────────────────────────────────────────────────

describe('restore atomicity (regression: non-atomic destructive restore)', () => {
  it('reports the atomic path when commit_restore is installed', async () => {
    table('inflow_transactions', rowsFor(5))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(5) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )
    expect(res.path).toBe('atomic')
    expect(res.success).toBe(true)
  })

  it('leaves live data untouched when an insert fails mid-restore', async () => {
    table('inflow_transactions', rowsFor(10))
    table('banks', rowsFor(6))
    // categories is present in the backup but broken on the server.
    table('categories', [], { error: 'deadlock detected' })

    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(10), banks: rowsFor(6), categories: rowsFor(2) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )).rejects.toThrow(/deadlock detected/)

    expect(db.inflow_transactions.rows).toHaveLength(10)
    expect(db.banks.rows).toHaveLength(6)
  })

  it('refuses replace mode entirely when the migration is not installed', async () => {
    uninstallAtomic()
    table('inflow_transactions', rowsFor(3))
    await expect(restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(3) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )).rejects.toThrow(/Run 20260806000002_atomic_restore_rpc\.sql|Replace mode is unavailable/)
    expect(calls.deletes).toEqual([])
  })

  it('still allows merge on the staged path — it never deletes', async () => {
    uninstallAtomic()
    table('inflow_transactions', rowsFor(3))
    const res = await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(3) }),
      { mode: 'merge', restoreUnmanaged: false },
      ORG,
    )
    expect(res.success).toBe(true)
    expect(res.path).toBe('staged')
    expect(calls.deletes).toEqual([])
  })

  it('stops the staged path at the first failure instead of pressing on', async () => {
    uninstallAtomic()
    table('banks', [], { error: 'connection reset' })
    const res = await restoreFromBackup(
      backupOf({ banks: rowsFor(2), inflow_transactions: rowsFor(2) }),
      { mode: 'merge', restoreUnmanaged: false },
      ORG,
    )
    expect(res.success).toBe(false)
    // banks sorts before inflow_transactions in the registry: the later table
    // must never have been attempted.
    expect(calls.upserts.map(u => u.table)).not.toContain('inflow_transactions')
  })
})

// ── 9. Cross-tenant deletes ───────────────────────────────────────────────────

describe('replace mode never issues an unscoped delete', () => {
  it('excludes tables with no org_id from the delete set', async () => {
    table('currencies', rowsFor(5))
    table('organizations', rowsFor(3))
    table('inflow_transactions', rowsFor(2))

    await restoreFromBackup(
      backupOf({ inflow_transactions: rowsFor(2) }),
      { mode: 'replace', restoreUnmanaged: false, acknowledgeDataLoss: true },
      ORG,
    )

    // Both are global/cross-tenant: an unscoped DELETE would clear them for
    // every organisation on the instance.
    expect(calls.deletes).not.toContain('currencies')
    expect(calls.deletes).not.toContain('organizations')
    expect(db.currencies.rows).toHaveLength(5)
    expect(db.organizations.rows).toHaveLength(3)
  })
})
