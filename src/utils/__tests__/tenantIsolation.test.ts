/**
 * Tenant isolation regression tests.
 *
 * These tests verify that:
 * 1. All data-fetching hooks require an active org_id before querying
 * 2. All mutations include org_id in inserts
 * 3. Audit log writes include org_id
 * 4. ResetDataModal scopes all operations to the current org
 * 5. Org-switching clears cached state
 *
 * These are pure-logic / structural tests — no DB connection required.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
const src  = (rel: string) => readFileSync(resolve(ROOT, 'src', rel), 'utf-8')

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('useAuditLog tenant isolation', () => {
  const code = src('hooks/useAuditLog.ts')

  it('imports useOrgStore', () => {
    expect(code).toContain("from '../store/orgStore'")
  })

  it('reads orgId from store', () => {
    expect(code).toContain('useOrgStore')
    expect(code).toContain('orgId')
  })

  it('guards fetch on orgId presence', () => {
    expect(code).toContain('if (!orgId)')
  })

  it('filters audit_log query by org_id', () => {
    expect(code).toContain(".eq('org_id', orgId)")
  })

  it('includes orgId in useCallback deps', () => {
    expect(code).toMatch(/useCallback\(.*orgId.*\[orgId/s)
  })
})

// ── Field changes ─────────────────────────────────────────────────────────────

describe('useFieldChanges tenant isolation', () => {
  const code = src('hooks/useFieldChanges.ts')

  it('imports useOrgStore', () => {
    expect(code).toContain("from '../store/orgStore'")
  })

  it('reads orgId from store', () => {
    expect(code).toContain('useOrgStore')
    expect(code).toContain('orgId')
  })

  it('guards fetch on orgId presence', () => {
    expect(code).toContain('if (!orgId)')
  })

  it('filters field_changes query by org_id', () => {
    expect(code).toContain(".eq('org_id', orgId)")
  })

  it('includes orgId in useCallback deps', () => {
    expect(code).toContain('[orgId,')
  })
})

// ── Mutations: audit + field-change writes ────────────────────────────────────

describe('useMutations audit org_id inclusion', () => {
  const code = src('hooks/useMutations.ts')

  it('logAudit reads orgId from store', () => {
    expect(code).toContain('useOrgStore.getState().orgId')
  })

  it('logAudit includes org_id in insert payload', () => {
    const logAuditSection = code.slice(
      code.indexOf('async function logAudit'),
      code.indexOf('async function batchLogAudit'),
    )
    expect(logAuditSection).toContain('org_id')
  })

  it('logFieldChanges includes org_id in insert rows', () => {
    const logFCSection = code.slice(
      code.indexOf('async function logFieldChanges'),
      code.indexOf('async function logAudit'),
    )
    expect(logFCSection).toContain('org_id')
  })

  it('batchLogAudit tags rows with org_id', () => {
    const batchSection = code.slice(
      code.indexOf('async function batchLogAudit'),
      code.indexOf('async function batchLogFieldChanges'),
    )
    expect(batchSection).toContain('org_id')
  })

  it('batchLogFieldChanges tags rows with org_id', () => {
    const batchFCSection = code.slice(
      code.indexOf('async function batchLogFieldChanges'),
      code.indexOf('// ── Input types'),
    )
    expect(batchFCSection).toContain('org_id')
  })
})

// ── ResetDataModal: export and delete scoping ─────────────────────────────────

describe('ResetDataModal tenant isolation', () => {
  const code = src('components/modals/ResetDataModal.tsx')

  it('imports useOrgStore', () => {
    expect(code).toContain("from '../../store/orgStore'")
  })

  it('Q helper includes org_id filter', () => {
    expect(code).toContain('.eq(\'org_id\', orgId)')
  })

  it('runExport accepts orgId parameter', () => {
    expect(code).toContain('async function runExport(key: string, sym: string, orgId: string)')
  })

  it('deleteAllData accepts orgId parameter', () => {
    expect(code).toContain('async function deleteAllData(orgId: string)')
  })

  it('deleteAllData scopes receipts select by org_id', () => {
    const deleteSection = code.slice(
      code.indexOf('async function deleteAllData'),
      code.indexOf('// ── Component'),
    )
    expect(deleteSection).toContain('.eq(\'org_id\', orgId)')
  })

  it('deleteAllData scopes table deletes by org_id', () => {
    const deleteSection = code.slice(
      code.indexOf('async function deleteAllData'),
      code.indexOf('// ── Component'),
    )
    expect(deleteSection).toContain('.delete().eq(\'org_id\', orgId)')
  })

  it('handleDelete guards on orgId', () => {
    expect(code).toContain('if (!orgId) return')
  })

  it('audit-log export filters by org_id', () => {
    const auditSection = code.slice(
      code.indexOf("key === 'audit-log'"),
      code.indexOf("key === 'audit-log'") + 400,
    )
    expect(auditSection).toContain(".eq('org_id', orgId)")
  })
})

// ── All data hooks guard on orgId ─────────────────────────────────────────────

describe('all data hooks guard before querying', () => {
  const hooks = [
    'hooks/useBanks.ts',
    'hooks/useCategories.ts',
    'hooks/useDashboard.ts',
    'hooks/useDepartments.ts',
    'hooks/useDynamicReports.ts',
    'hooks/useFX.ts',
    'hooks/useFXConversions.ts',
    'hooks/useIncomeTypes.ts',
    'hooks/useLedger.ts',
    'hooks/useOutflowTypes.ts',
    'hooks/useReportEngine.ts',
    'hooks/useReportTemplates.ts',
    'hooks/useAuditLog.ts',
    'hooks/useFieldChanges.ts',
  ]

  hooks.forEach(hook => {
    it(`${hook} checks orgId before fetching`, () => {
      const code = src(hook)
      expect(code).toContain('orgId')
      // Guard pattern: `if (!orgId)` or combined `if (!x || !orgId)` or `if (!orgId ||`
      expect(code).toMatch(/if \(!orgId\)|if \(![^)]+\|\|\s*!orgId\)|if \(!orgId\s*\|\|/)
    })
  })
})

// ── Org-switching clears all caches ──────────────────────────────────────────

describe('org switching cache invalidation', () => {
  const authCode = src('hooks/useAuth.ts')

  it('switchOrg resets allocation store', () => {
    const switchSection = authCode.slice(
      authCode.indexOf('const switchOrg'),
      authCode.indexOf('return { switchOrg }'),
    )
    expect(switchSection).toContain('useAllocationStore.getState().reset()')
  })

  it('switchOrg resets account codes store', () => {
    const switchSection = authCode.slice(
      authCode.indexOf('const switchOrg'),
      authCode.indexOf('return { switchOrg }'),
    )
    expect(switchSection).toContain('useAccountCodesStore.getState().reset()')
  })

  it('signOut clears org state', () => {
    const signOutSection = authCode.slice(
      authCode.indexOf('const signOut'),
      authCode.indexOf('return {') + 200,
    )
    expect(signOutSection).toContain('useOrgStore.getState().clearOrg()')
  })
})

// ── Migration: audit_log and field_changes get org_id ────────────────────────

describe('security migration: audit log org isolation', () => {
  const migration = readFileSync(
    resolve(ROOT, 'supabase/migrations/20260602000002_audit_log_org_isolation.sql'),
    'utf-8',
  )

  it('adds org_id to audit_log', () => {
    expect(migration).toContain('ALTER TABLE public.audit_log')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS org_id')
  })

  it('adds org_id to field_changes', () => {
    expect(migration).toContain('ALTER TABLE public.field_changes')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS org_id')
  })

  it('drops old cross-org is_admin() SELECT policy', () => {
    expect(migration).toContain("DROP POLICY IF EXISTS \"audit_admin_read\"")
  })

  it('replaces audit_log SELECT with org-scoped policy', () => {
    expect(migration).toContain('CREATE POLICY "audit_select" ON public.audit_log')
    expect(migration).toContain('is_org_member(org_id)')
  })

  it('replaces field_changes SELECT with org-scoped policy', () => {
    expect(migration).toContain('CREATE POLICY "field_changes_select" ON public.field_changes')
    expect(migration).toContain('is_org_member(org_id)')
  })

  it('adds DELETE policy so org admins can clear own logs', () => {
    expect(migration).toContain('CREATE POLICY "audit_delete" ON public.audit_log')
    expect(migration).toContain('CREATE POLICY "field_changes_delete" ON public.field_changes')
  })

  it('fixes profiles_update_admin cross-org leak', () => {
    expect(migration).toContain("DROP POLICY IF EXISTS \"profiles_update_admin\"")
    expect(migration).toContain('CREATE POLICY "profiles_update_admin" ON public.profiles')
    // New policy must use org-scoped join, not the global is_admin()
    expect(migration).toContain('org_members caller')
    expect(migration).toContain('JOIN   public.org_members target')
  })

  it('fixes profiles_delete cross-org leak', () => {
    expect(migration).toContain("DROP POLICY IF EXISTS \"profiles_delete\"")
    expect(migration).toContain('CREATE POLICY "profiles_delete" ON public.profiles')
  })

  it('backfills audit_log org_id for existing rows', () => {
    expect(migration).toContain('UPDATE public.audit_log')
    expect(migration).toContain('SET    org_id = COALESCE')
  })

  it('backfills field_changes org_id for existing rows', () => {
    expect(migration).toContain('UPDATE public.field_changes')
    expect(migration).toContain('SET    org_id = COALESCE')
  })
})
