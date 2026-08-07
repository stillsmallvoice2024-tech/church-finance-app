/**
 * Org-scoping invariant tests.
 *
 * RLS on every tenant table is `is_org_member(org_id)` / `is_org_finance_user(org_id)`,
 * which permits EVERY org the caller belongs to — not just the active one.  A query
 * that omits an explicit `.eq('org_id', orgId)` therefore reads (or writes) across
 * all of a multi-org user's organisations.
 *
 * The first test below is a standing invariant rather than a fixed list of
 * assertions: it re-derives the set of org-scoped tables from schema.sql and
 * fails when ANY new unscoped multi-row read appears.  Add to ALLOWLIST only
 * with a justification.
 *
 * Pure-logic / structural tests — no DB connection required.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative } from 'path'

const ROOT = resolve(__dirname, '../../..')
const src  = (rel: string) => readFileSync(resolve(ROOT, 'src', rel), 'utf-8')

/** Sites proven safe by inspection — each needs a reason. */
const ALLOWLIST: Record<string, string> = {
  // `.limit(0)` schema probes: verify a column exists / PostgREST cache freshness.
  // They request zero rows, so they cannot return another org's data.
  'src/hooks/useBanks.ts:banks:limit0': 'schema probe, .limit(0) returns no rows',
  // `.insert(...).select('id')` — a write echoing back its own inserted ids.
  'src/pages/BulkReallocation.tsx:intra_flows:insert': 'insert echo, not a read',
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full) && !full.includes('__tests__')) out.push(full)
  }
  return out
}

/** Tables carrying an org_id column, derived from the canonical schema. */
function orgScopedTables(): Set<string> {
  const schema = readFileSync(resolve(ROOT, 'supabase/schema.sql'), 'utf-8')
  const tables = new Set<string>()
  const re = /create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(schema)) !== null) {
    if (/\borg_id\b/.test(m[2])) tables.add(m[1])
  }
  return tables
}

interface Finding { file: string; line: number; table: string; snippet: string }

function findUnscopedReads(): Finding[] {
  const tables = orgScopedTables()
  const findings: Finding[] = []

  for (const file of walk(resolve(ROOT, 'src'))) {
    const txt = readFileSync(file, 'utf-8')
    const re = /\.from\('(\w+)'\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(txt)) !== null) {
      const table = m[1]
      if (!tables.has(table)) continue

      // Isolate this query chain: stop at a blank line or the next statement.
      let seg = txt.slice(m.index + m[0].length, m.index + m[0].length + 700)
      seg = seg.split(/\n\s*\n|\n\s*(?:const|let|await|if|return|})\s/)[0]

      if (seg.includes('org_id')) continue          // scoped
      if (!/\.select\(/.test(seg)) continue          // not a read
      // Single-row lookups keyed by a primary/foreign key are inherently scoped:
      // the id can only have been obtained from an already-scoped query.
      if (/\.eq\('id',|\.in\('id',|\.eq\('\w*_id',|\.single\(\)|\.maybeSingle\(\)/.test(seg)) continue
      if (/\.limit\(0\)/.test(seg)) continue         // schema probe
      if (/\.insert\(/.test(seg)) continue           // insert echo

      findings.push({
        file: relative(ROOT, file),
        line: txt.slice(0, m.index).split('\n').length,
        table,
        snippet: seg.trim().slice(0, 80),
      })
    }
  }
  return findings
}

describe('org-scoping invariant', () => {
  it('derives the org-scoped table set from schema.sql', () => {
    const tables = orgScopedTables()
    expect(tables.size).toBeGreaterThan(20)
    // Spot-check the tables behind the reported leaks.
    for (const t of ['inflow_transactions', 'outflow_transactions', 'departments', 'field_changes']) {
      expect(tables.has(t)).toBe(true)
    }
  })

  it('has no unscoped multi-row reads of org-scoped tables', () => {
    const findings = findUnscopedReads()
    const unexplained = findings.filter(f => {
      const keys = Object.keys(ALLOWLIST)
      return !keys.some(k => k.startsWith(f.file + ':' + f.table))
    })
    // Readable failure: list offenders rather than just a count mismatch.
    const report = unexplained.map(f => `${f.file}:${f.line} [${f.table}] ${f.snippet}`)
    expect(report).toEqual([])
  })
})

// ── Cross-org writes: the destructive cases ──────────────────────────────────

describe('bankOpeningBalance cross-org writes', () => {
  const code = src('utils/bankOpeningBalance.ts')

  it('rename-purge delete is org-scoped', () => {
    // bank_name is plain text, not an FK — an unscoped delete removes the
    // identically-named bank's B/F row in the user's other orgs.
    const section = code.slice(code.indexOf('On bank rename'), code.indexOf('Fetch at most 2 rows'))
    expect(section).toContain(".eq('org_id', orgId)")
  })

  it('duplicate-detection select is org-scoped', () => {
    const section = code.slice(code.indexOf('Fetch at most 2 rows'), code.indexOf('Inline cleanup'))
    expect(section).toContain(".eq('org_id', orgId)")
  })

  it('every delete and update in the file is org-scoped', () => {
    const writes = code.split(/\.(?:delete|update)\(/).slice(1)
    for (const w of writes) {
      expect(w.slice(0, 200)).toContain(".eq('org_id', orgId)")
    }
  })

  it('guards on orgId before any write', () => {
    expect(code).toContain("if (!orgId) throw new Error('No active organisation.')")
  })
})

describe('backupRestore replace-mode delete is org-scoped', () => {
  const code = src('utils/backupRestore.ts')

  it('deleteFull requires an orgId parameter', () => {
    expect(code).toContain('async function deleteFull(table: string, orgId: string)')
  })

  it('deleteFull filters org-scoped tables by org_id', () => {
    const fn = code.slice(code.indexOf('async function deleteFull'), code.indexOf('export type RestoreProgressCallback'))
    expect(fn).toContain(".eq('org_id', orgId)")
  })

  it('restoreFromBackup takes orgId and passes it to deleteFull', () => {
    expect(code).toContain('deleteFull(tableKey, orgId)')
  })

  it('adjacent audit-data wipe is org-scoped', () => {
    // receipts / audit_log / field_changes were deleted wholesale.
    const idx = code.indexOf("for (const extra of ['receipts', 'audit_log', 'field_changes'])")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(code.slice(idx, idx + 260)).toContain(".eq('org_id', orgId)")
  })
})

describe('RestoreModal passes orgId', () => {
  const code = src('components/modals/RestoreModal.tsx')

  it('reads orgId from the store', () => {
    expect(code).toContain('useOrgStore(s => s.orgId)')
  })

  it('blocks restore when there is no active org', () => {
    expect(code).toContain('if (!orgId)')
  })
})

// ── Cross-org duplicate detection ────────────────────────────────────────────

describe('import duplicate checks are org-scoped', () => {
  it('fetchExistingTransactionIds requires orgId and filters on it', () => {
    const code = src('utils/dedupQuery.ts')
    expect(code).toContain('orgId: string,')
    expect(code).toContain(".eq('org_id', orgId)")
  })

  it('all callers pass an orgId', () => {
    for (const f of ['components/modals/ImportModal.tsx', 'pages/Import.tsx']) {
      const code = src(f)
      // Two dedup entry points: the Import page pre-stage still checks by
      // reference, ImportModal checks by full row identity. Both must be
      // org-scoped — an unscoped check skips a legitimate transaction whose
      // reference happens to exist in another org.
      const calls = code.match(/fetchExisting(?:TransactionIds|RowCounts)\([^)]*\)/gs) ?? []
      expect(calls.length).toBeGreaterThan(0)
      for (const c of calls) expect(c).toMatch(/,\s*\w*[Oo]rgId\s*\)/)
    }
  })

  it('single-record duplicate checks are org-scoped', () => {
    for (const [f, table] of [
      ['components/modals/AddFXModal.tsx',   'fx_transactions'],
      ['components/modals/AddInflowModal.tsx', 'inflow_transactions'],
    ] as const) {
      const code = src(f)
      const idx = code.indexOf(`supabase.from('${table}').select('id')`)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(code.slice(idx, idx + 160)).toContain(".eq('org_id', orgId)")
    }
  })
})

// ── Export paths ─────────────────────────────────────────────────────────────

describe('ExportCSVsModal scopes every export', () => {
  const code = src('components/modals/ExportCSVsModal.tsx')

  it('the shared Q() helper filters by org_id', () => {
    expect(code).toContain("const Q = (table: string, orgId: string) =>")
    expect(code).toContain(".eq('org_id', orgId)")
  })

  it('runExport takes orgId', () => {
    expect(code).toContain('async function runExport(key: string, sym: string, orgId: string)')
  })

  it('no Q() call site omits orgId', () => {
    const calls = code.match(/Q\('(\w+)'[^)]*\)/g) ?? []
    expect(calls.length).toBeGreaterThan(5)
    for (const c of calls) expect(c).toContain('orgId')
  })

  it('component guards on orgId before running exports', () => {
    expect(code).toContain('if (!open || !orgId) return')
  })
})

describe('per-page "export all" paths are org-scoped', () => {
  it('ChangeLog field_changes export filters by org_id', () => {
    const code = src('pages/ChangeLog.tsx')
    const fn = code.slice(code.indexOf('const handleExportAll'), code.indexOf('const handleExportAll') + 900)
    expect(fn).toContain("if (!orgId) return")
    expect(fn).toContain(".eq('org_id', orgId)")
  })

  it('IntraFlow intra_flows export filters by org_id', () => {
    const code = src('pages/IntraFlow.tsx')
    const fn = code.slice(code.indexOf('const handleExportAll'), code.indexOf('const handleExportAll') + 600)
    expect(fn).toContain("if (!orgId) return")
    expect(fn).toContain(".eq('org_id', orgId)")
  })
})

// ── Reads that drive displayed figures ───────────────────────────────────────

describe('BankLedger is org-scoped', () => {
  const code = src('pages/BankLedger.tsx')

  it('all four transaction queries filter by org_id', () => {
    const start = code.indexOf('const load = useCallback')
    const fn = code.slice(start, code.indexOf('useEffect', start))
    expect(start).toBeGreaterThanOrEqual(0)
    expect((fn.match(/\.eq\('org_id', orgId\)/g) ?? []).length).toBe(4)
  })

  it('guards when no org is active', () => {
    expect(code).toContain('if (!bankId || !bankName || !orgId)')
  })
})

describe('useRecordConfidence counts only the active org', () => {
  const code = src('hooks/useRecordConfidence.ts')

  it('all four count queries filter by org_id', () => {
    expect((code.match(/\.eq\('org_id', orgId\)/g) ?? []).length).toBe(4)
  })

  it('guards and lists orgId as a dependency', () => {
    expect(code).toContain('if (!orgId)')
    expect(code).toContain('}, [orgId])')
  })
})

describe('useCategoryOpeningBalances is org-scoped', () => {
  const code = src('hooks/useCategories.ts')

  it('filters by org_id and guards', () => {
    const fn = code.slice(code.indexOf('export function useCategoryOpeningBalances'))
    expect(fn).toContain(".eq('org_id', orgId)")
    expect(fn).toContain('if (!orgId)')
    expect(fn).toContain('[categoryId, orgId]')
  })
})

describe('migrateReceiptPaths requires an explicit org', () => {
  const code = src('utils/migrateReceiptPaths.ts')

  it('both entry points take a required orgId', () => {
    expect(code).toContain('export async function auditLegacyReceiptPaths(orgId: string)')
    expect(code).toContain('orgId:       string,')
  })

  it('the receipts read and the path rewrite are scoped', () => {
    expect((code.match(/\.eq\('org_id', orgId\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
