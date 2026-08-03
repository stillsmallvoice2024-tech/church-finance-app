/**
 * Security regression tests — verifies C1-C5, H1-H6, H8 cannot regress.
 * Pure structural tests: reads source files, checks code patterns, no DB needed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
const src  = (rel: string) => readFileSync(resolve(ROOT, 'src', rel), 'utf-8')
const sql  = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8')
const migration = (name: string) => readFileSync(resolve(ROOT, 'supabase/migrations', name), 'utf-8')

// ── C1: No duplicate CREATE POLICY in schema.sql ─────────────────────────────

describe('C1: schema.sql has no duplicate policy definitions', () => {
  const schema = sql('supabase/schema.sql')

  const policyNames = [
    'audit_select', 'field_changes_select',
    'cob_select', 'cob_insert', 'cob_update', 'cob_delete',
    'orgs_select', 'orgs_insert', 'orgs_update', 'orgs_delete',
    'org_members_select', 'org_members_insert', 'org_members_update', 'org_members_delete',
    'dr_select', 'dr_insert', 'dr_update', 'dr_delete',
    'scg_select', 'scg_insert', 'scg_update', 'scg_delete',
  ]

  policyNames.forEach(name => {
    it(`policy "${name}" appears exactly once`, () => {
      const pattern = new RegExp(`create policy "${name}"`, 'gi')
      const matches = schema.match(pattern) ?? []
      expect(matches.length).toBe(1)
    })
  })
})

// ── R1: profiles_select scoped to shared-org membership ───────────────────────

describe('R1: profiles_select does not leak cross-org PII', () => {
  const schema = sql('supabase/schema.sql')

  it('profiles_select no longer uses bare auth.uid() is not null', () => {
    const policySection = schema.slice(
      schema.indexOf('create policy "profiles_select"'),
      schema.indexOf('create policy "profiles_insert"'),
    )
    expect(policySection).not.toContain('using (auth.uid() is not null)')
    expect(policySection).toContain('id = auth.uid()')
    expect(policySection).toContain('org_members caller')
  })

  it('migration scopes profiles_select and invitation_emails_admin_read', () => {
    const fix = migration('20260704000001_scope_profiles_and_global_admin.sql')
    expect(fix).toContain('CREATE POLICY "profiles_select"')
    expect(fix).toContain('target.user_id = profiles.id')
    expect(fix).toContain('CREATE POLICY "invitation_emails_admin_read"')
    expect(fix).toContain('public.is_org_admin(i.org_id)')
  })
})

// ── R2: audit_log + field_changes are client-append-only ──────────────────────

describe('R2: audit trail has no client DELETE policy', () => {
  const schema = sql('supabase/schema.sql')

  it('schema.sql defines no audit_delete or field_changes_delete policy', () => {
    expect(schema).not.toContain('create policy "audit_delete"')
    expect(schema).not.toContain('create policy "field_changes_delete"')
  })

  it('migration drops both client DELETE policies', () => {
    const fix = migration('20260704000002_audit_log_append_only.sql')
    expect(fix).toContain('DROP POLICY IF EXISTS "audit_delete"         ON public.audit_log')
    expect(fix).toContain('DROP POLICY IF EXISTS "field_changes_delete" ON public.field_changes')
  })
})

// ── C2: purge_old_audit_logs scopes deletes by org ────────────────────────────

describe('C2: purge_old_audit_logs scopes deletes to caller org', () => {
  const fix = migration('20260606000003_security_fixes.sql')

  it('checks auth.uid() and resolves caller org', () => {
    expect(fix).toContain('v_caller_org')
    expect(fix).toContain('auth.uid() IS NOT NULL')
  })

  it('org-scoped delete uses AND org_id = v_caller_org', () => {
    expect(fix).toContain('AND org_id = v_caller_org')
  })

  it('service-role path (uid=NULL) still deletes without org filter', () => {
    const fnSection = fix.slice(
      fix.indexOf('CREATE OR REPLACE FUNCTION public.purge_old_audit_logs'),
      fix.indexOf('REVOKE ALL   ON FUNCTION public.purge_old_audit_logs'),
    )
    expect(fnSection).toContain('DELETE FROM public.audit_log WHERE created_at < v_cutoff;')
  })
})

// ── C3: allocation_configs has is_special, allocation_type, total_amount ──────

describe('C3: allocation_configs schema has required columns', () => {
  const schema = sql('supabase/schema.sql')

  it('CREATE TABLE allocation_configs includes is_special', () => {
    const tableSection = schema.slice(
      schema.indexOf('create table public.allocation_configs'),
      schema.indexOf(');', schema.indexOf('create table public.allocation_configs')),
    )
    expect(tableSection).toContain('is_special')
  })

  it('CREATE TABLE allocation_configs includes allocation_type', () => {
    const tableSection = schema.slice(
      schema.indexOf('create table public.allocation_configs'),
      schema.indexOf(');', schema.indexOf('create table public.allocation_configs')),
    )
    expect(tableSection).toContain('allocation_type')
  })

  it('CREATE TABLE allocation_configs includes total_amount', () => {
    const tableSection = schema.slice(
      schema.indexOf('create table public.allocation_configs'),
      schema.indexOf(');', schema.indexOf('create table public.allocation_configs')),
    )
    expect(tableSection).toContain('total_amount')
  })

  it('migration adds columns with ADD COLUMN IF NOT EXISTS', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain('ADD COLUMN IF NOT EXISTS is_special')
    expect(fix).toContain('ADD COLUMN IF NOT EXISTS allocation_type')
    expect(fix).toContain('ADD COLUMN IF NOT EXISTS total_amount')
  })
})

// ── C4: purge_org writes audit before deletions, no EXCEPTION WHEN OTHERS ─────

describe('C4: purge_org is correct', () => {
  const schema = sql('supabase/schema.sql')

  it('purge_org does not DELETE FROM audit_log', () => {
    const fnSection = schema.slice(
      schema.indexOf('create or replace function public.purge_org'),
      schema.indexOf('-- purge_org is NOT granted'),
    )
    expect(fnSection).not.toContain('delete from public.audit_log')
  })

  it('purge_org has no EXCEPTION WHEN OTHERS handler', () => {
    const fnSection = schema.slice(
      schema.indexOf('create or replace function public.purge_org'),
      schema.indexOf('-- purge_org is NOT granted'),
    )
    expect(fnSection).not.toContain('exception when others')
  })

  it('audit INSERT appears before first DELETE in purge_org', () => {
    const fnSection = schema.slice(
      schema.indexOf('create or replace function public.purge_org'),
      schema.indexOf('-- purge_org is NOT granted'),
    )
    const auditIdx  = fnSection.indexOf('insert into public.audit_log')
    const deleteIdx = fnSection.indexOf('delete from public.receipts')
    expect(auditIdx).toBeGreaterThan(0)
    expect(deleteIdx).toBeGreaterThan(auditIdx)
  })

  it('purge_org uses PURGE_INITIATED action (not PURGED after deletion)', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain("'PURGE_INITIATED'")
    expect(fix).not.toContain("'PURGED'")
  })
})

// ── C5: orgs_insert rejects direct client INSERTs ────────────────────────────

describe('C5: orgs_insert policy blocks direct client inserts', () => {
  const schema = sql('supabase/schema.sql')

  it('orgs_insert uses WITH CHECK (false)', () => {
    const policySection = schema.slice(
      schema.indexOf('create policy "orgs_insert"'),
      schema.indexOf('create policy "orgs_insert"') + 120,
    )
    expect(policySection).toContain('with check (false)')
    expect(policySection).not.toContain('is_admin()')
  })

  it('migration drops and recreates orgs_insert with false', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain('DROP POLICY IF EXISTS "orgs_insert"')
    expect(fix).toContain('FOR INSERT WITH CHECK (false)')
  })
})

// ── H1: createNewVersion uses atomic RPC ──────────────────────────────────────

describe('H1: createNewVersion uses atomic RPC, not two separate calls', () => {
  const code = src('hooks/useSpecialConfigGroups.ts')

  it('calls supabase.rpc create_special_config_version', () => {
    const fnSection = code.slice(
      code.indexOf('export async function createNewVersion'),
      code.indexOf('export async function setGroupIncomeTypeLink'),
    )
    expect(fnSection).toContain("supabase.rpc('create_special_config_version'")
  })

  it('does not make two separate allocation_configs inserts', () => {
    const fnSection = code.slice(
      code.indexOf('export async function createNewVersion'),
      code.indexOf('export async function setGroupIncomeTypeLink'),
    )
    expect(fnSection).not.toContain(".from('allocation_configs').insert(")
    expect(fnSection).not.toContain(".from('allocation_configs').update(")
  })

  it('RPC is defined in security fixes migration', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain('CREATE OR REPLACE FUNCTION public.create_special_config_version(')
    expect(fix).toContain('FOR UPDATE')
    expect(fix).toContain('SECURITY DEFINER')
  })
})

// ── H2: ILIKE patterns escape %, _, \ wildcards ───────────────────────────────

describe('H2: ILIKE search escapes wildcard characters', () => {
  it('useTransactions escapes % _ and backslash in safeSearch', () => {
    const code = src('hooks/useTransactions.ts')
    const safeSearchPattern = code.match(/const safeSearch = search\.replace\(([^)]+)\)/)?.[1]
    expect(safeSearchPattern).toBeTruthy()
    expect(safeSearchPattern).toContain('%')
    expect(safeSearchPattern).toContain('_')
    expect(safeSearchPattern).toContain('\\\\')
  })

  it('useTransactions does NOT use old replace that only strips (),', () => {
    const code = src('hooks/useTransactions.ts')
    expect(code).not.toContain("search.replace(/[(),]/g, '')")
  })

  it('useFieldChanges escapes % _ and backslash', () => {
    const code = src('hooks/useFieldChanges.ts')
    expect(code).toContain('safeSearch')
    expect(code).toContain('[%_\\\\')
  })

  it('useFieldChanges uses safeSearch (not raw search) in ilike', () => {
    const code = src('hooks/useFieldChanges.ts')
    const searchSection = code.slice(
      code.indexOf('if (search)'),
      code.indexOf('if (search)') + 500,
    )
    expect(searchSection).toContain('safeSearch')
    expect(searchSection).not.toMatch(/`%\$\{search\}%`/)
  })

  it('RootTransactionSearch escapes % _ and backslash in safeSearch', () => {
    const code = src('components/ui/RootTransactionSearch.tsx')
    const safeSearchPattern = code.match(/const safeSearch = rawQuery\.trim\(\)\.replace\(([^)]+)\)/)?.[1]
    expect(safeSearchPattern).toBeTruthy()
    expect(safeSearchPattern).toContain('%')
    expect(safeSearchPattern).toContain('_')
    expect(safeSearchPattern).toContain('\\\\')
  })

  it('RootTransactionSearch does not build the ILIKE pattern from an unescaped query', () => {
    const code = src('components/ui/RootTransactionSearch.tsx')
    expect(code).not.toMatch(/`%\$\{(query|rawQuery)\.trim\(\)\}%`/)
  })
})

// ── H3: send-invite-email verifies admin of invitation's org ──────────────────

describe('H3: send-invite-email checks admin membership in invitation org', () => {
  const fn = readFileSync(
    resolve(ROOT, 'supabase/functions/send-invite-email/index.ts'), 'utf-8',
  )

  it('fetches invite before checking membership', () => {
    const inviteIdx      = fn.indexOf("from('invitations')")
    const membershipIdx  = fn.indexOf("from('org_members')")
    expect(inviteIdx).toBeGreaterThan(0)
    expect(membershipIdx).toBeGreaterThan(inviteIdx)
  })

  it('membership check uses invite.org_id (not any org)', () => {
    const membershipSection = fn.slice(
      fn.indexOf("from('org_members')"),
      fn.indexOf("from('org_members')") + 300,
    )
    expect(membershipSection).toContain('invite.org_id')
    expect(membershipSection).not.toContain('.limit(1)')
  })

  it('invite query selects org_id field', () => {
    const inviteSelect = fn.slice(
      fn.indexOf("from('invitations')"),
      fn.indexOf("from('invitations')") + 300,
    )
    expect(inviteSelect).toContain('org_id')
  })
})

// ── H4: profiles_update_admin has WITH CHECK ──────────────────────────────────

describe('H4: profiles_update_admin has WITH CHECK to prevent role escalation', () => {
  it('schema.sql has WITH CHECK on profiles_update_admin', () => {
    const schema = sql('supabase/schema.sql')
    const policySection = schema.slice(
      schema.indexOf('create policy "profiles_update_admin"'),
      schema.indexOf('create policy "profiles_delete"'),
    )
    expect(policySection).toContain('with check')
    expect(policySection).toContain('p2.role')
  })

  it('migration recreates profiles_update_admin with WITH CHECK', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    const policySection = fix.slice(
      fix.indexOf('CREATE POLICY "profiles_update_admin"'),
      fix.indexOf('CREATE POLICY "profiles_update_admin"') + 600,
    )
    expect(policySection).toContain('WITH CHECK')
    expect(policySection).toContain('p2.role')
  })
})

// ── H5: accept_invitation checks org status ───────────────────────────────────

describe('H5: accept_invitation blocks joining inactive orgs', () => {
  const schema = sql('supabase/schema.sql')

  it('fallback org lookup filters by status = active', () => {
    const fnSection = schema.slice(
      schema.indexOf("create or replace function public.accept_invitation"),
      schema.indexOf("-- ── Server-side audit trigger functions"),
    )
    expect(fnSection).toContain("status = 'active'")
    expect(fnSection).not.toContain("from public.organizations where slug = 'primary' limit 1")
  })

  it('explicit status check raises exception for inactive org', () => {
    const fnSection = schema.slice(
      schema.indexOf("create or replace function public.accept_invitation"),
      schema.indexOf("-- ── Server-side audit trigger functions"),
    )
    expect(fnSection).toContain("is no longer active")
  })

  it('no unconditional fallback to any org', () => {
    const fnSection = schema.slice(
      schema.indexOf("create or replace function public.accept_invitation"),
      schema.indexOf("-- ── Server-side audit trigger functions"),
    )
    expect(fnSection).not.toContain('from public.organizations limit 1')
  })

  it('migration implements the same status check', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain("status = 'active'")
    expect(fix).toContain('is no longer active')
  })
})

// ── H6: request_gdpr_erasure requires explicit p_org_id ──────────────────────

describe('H6: request_gdpr_erasure requires explicit org_id parameter', () => {
  it('schema.sql function signature has p_org_id as first param before p_target_user_id', () => {
    const schema = sql('supabase/schema.sql')
    const fnSection = schema.slice(
      schema.indexOf('create or replace function public.request_gdpr_erasure'),
      schema.indexOf('create or replace function public.request_gdpr_erasure') + 200,
    )
    expect(fnSection).toContain('p_org_id')
    const orgIdx    = fnSection.indexOf('p_org_id')
    const targetIdx = fnSection.indexOf('p_target_user_id')
    expect(orgIdx).toBeGreaterThanOrEqual(0)
    expect(targetIdx).toBeGreaterThan(orgIdx)
  })

  it('schema.sql drops old 2-arg signature', () => {
    const schema = sql('supabase/schema.sql')
    expect(schema).toContain('drop function if exists public.request_gdpr_erasure(uuid, text)')
  })

  it('migration drops old signature and grants new 3-arg', () => {
    const fix = migration('20260606000003_security_fixes.sql')
    expect(fix).toContain('DROP FUNCTION IF EXISTS public.request_gdpr_erasure(uuid, text)')
    expect(fix).toContain('GRANT  EXECUTE ON FUNCTION public.request_gdpr_erasure(uuid, uuid, text)')
  })

  it('function uses is_org_admin(p_org_id) instead of LIMIT 1 lookup', () => {
    const schema = sql('supabase/schema.sql')
    const fnSection = schema.slice(
      schema.indexOf('create or replace function public.request_gdpr_erasure'),
      schema.indexOf('drop function if exists public.request_gdpr_erasure'),
    )
    expect(fnSection).toContain('is_org_admin(p_org_id)')
    expect(fnSection).not.toContain('LIMIT 1')
  })
})

// ── H8: No silent column-strip retry in FX insert or bulk update ──────────────

describe('H8: MISSING_COL_RE silent retry is removed', () => {
  const code = src('hooks/useMutations.ts')

  it('MISSING_COL_RE constant is removed', () => {
    expect(code).not.toContain('MISSING_COL_RE')
  })

  it('useAddFXTransaction does not retry with stripped column', () => {
    const fnSection = code.slice(
      code.indexOf('export function useAddFXTransaction'),
      code.indexOf('export function useUpdateFXTransaction'),
    )
    expect(fnSection).not.toContain('delete payload')
    expect(fnSection).not.toContain('retry')
  })

  it('useBulkUpdateTransaction does not strip columns', () => {
    const fnSection = code.slice(
      code.indexOf('export function useBulkUpdateTransaction'),
      code.lastIndexOf('}') + 1,
    )
    expect(fnSection).not.toContain('strippedCols')
    expect(fnSection).not.toContain('filter(([k]) => k !== col)')
  })

  it('bulk update return type no longer includes strippedCols', () => {
    const fnSig = code.slice(
      code.indexOf('): Promise<{ failed:'),
      code.indexOf('): Promise<{ failed:') + 60,
    )
    expect(fnSig).not.toContain('strippedCols')
  })
})
