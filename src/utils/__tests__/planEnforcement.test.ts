/**
 * Plan-enforcement regression tests.
 *
 * The audit finding these guard against: org_plan_at_least() was defined and
 * granted in the schema but called by nothing — `grep -rn "org_plan_at_least"
 * supabase/ src/` returned the definition and a comment, zero call sites — so
 * every subscription gate was a `<div>` a user could delete, and the client
 * resolver failed OPEN to the top tier on top of that.
 *
 * Pure structural tests: reads source files, checks patterns, no DB needed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { resolveEffectiveTier, FEATURE_TIERS, TXN_TYPE_FEATURE } from '../../hooks/usePlan'

const ROOT      = resolve(__dirname, '../../..')
const sql       = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8')
const src       = (rel: string) => readFileSync(resolve(ROOT, 'src', rel), 'utf-8')
const schema    = sql('supabase/schema.sql')
const migration = sql('supabase/migrations/20260807000000_plan_enforcement.sql')

// ── The resolver must fail closed ─────────────────────────────────────────────

describe('resolveEffectiveTier fails closed', () => {
  it('resolves an unknown tier to free, not full', () => {
    expect(resolveEffectiveTier(null, null)).toBe('free')
  })

  it('resolves an unknown tier to free even with a future expiry', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect(resolveEffectiveTier(null, future)).toBe('free')
  })

  it('still honours a known tier inside its expiry', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect(resolveEffectiveTier('full', future)).toBe('full')
    expect(resolveEffectiveTier('level1', null)).toBe('level1')
  })

  it('still reverts a lapsed plan to free', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    expect(resolveEffectiveTier('full', past)).toBe('free')
  })
})

describe('usePlan predicates fail closed while the tier is unknown', () => {
  const code = src('hooks/usePlan.ts')

  it('hasFeature returns false, not true, when unresolved', () => {
    const fn = code.slice(code.indexOf('const hasFeature'), code.indexOf('const quantityLimit'))
    expect(fn).toContain('if (!resolved) return false')
    expect(fn).not.toContain('if (!resolved) return true')
  })

  it('isLevel1OrAbove requires a resolved tier', () => {
    expect(code).toContain('isLevel1OrAbove: (): boolean => resolved && tierAtLeast(tier, \'level1\')')
    expect(code).not.toContain('!resolved || tierAtLeast(tier, \'level1\')')
  })

  it('exposes planLoading so callers can render a neutral placeholder', () => {
    expect(code).toContain('planLoading')
  })
})

// A gate that fails closed will show an upsell card (or redirect) to a paying
// org unless every consumer holds off while the tier is unknown.
describe('consumers hold off while the tier is unknown', () => {
  it('PlanGates render a placeholder instead of an upsell during load', () => {
    const code = src('components/auth/PlanGates.tsx')
    expect(code).toContain('GatePlaceholder')
    expect((code.match(/if \(planLoading\) return <GatePlaceholder \/>/g) ?? []).length).toBe(3)
  })

  it('the route guard does not redirect before the tier is known', () => {
    const code = src('App.tsx')
    const guard = code.slice(code.indexOf('function FeatureGuard'), code.indexOf('function OnboardingGuard'))
    expect(guard).toContain('if (planLoading) return null')
    expect(guard.indexOf('planLoading')).toBeLessThan(guard.indexOf('Navigate'))
  })

  it('quantity caps are held off until the tier is known', () => {
    expect(src('pages/setup/BanksTab.tsx')).toContain('!planLoading && bankLimit !== null')
    expect(src('pages/setup/DistributionRulesTab.tsx')).toContain('!planLoading && customRuleLimit !== null')
  })
})

// ── The database must actually enforce ───────────────────────────────────────

describe('org_plan_at_least has real call sites', () => {
  // The original finding in one assertion: a definition with no callers.
  const callSites = (text: string) =>
    (text.match(/public\.org_plan_at_least\(/g) ?? []).length

  it('schema.sql calls it, not merely defines it', () => {
    // 1 definition + 1 grant + N call sites.
    expect(callSites(schema)).toBeGreaterThan(2)
  })

  it('at least one RLS policy references a plan predicate', () => {
    const policySection = schema.slice(schema.indexOf('-- 9. RLS POLICIES'))
    expect(policySection).toContain('public.org_plan_at_least(org_id')
  })
})

describe('gated tables carry a plan check on INSERT', () => {
  const gated: Array<[string, string, string]> = [
    ['fx_insert',              'fx_transactions',          'level1'],
    ['fxc_insert',             'fx_conversions',           'level1'],
    ['receipts_insert',        'receipts',                 'level1'],
    ['bsb_insert',             'bank_statement_balances',  'level1'],
    ['invitations_insert',     'invitations',              'level1'],
    ['report_templates_insert','report_templates',         'level1'],
    ['bank_deposits_insert',   'bank_deposits',            'full'],
    ['intrabank_insert',       'intrabank_transfers',      'full'],
    ['dr_insert',              'dynamic_reports',          'full'],
  ]

  gated.forEach(([policy, table, tier]) => {
    it(`${policy} requires ${tier} in both schema and migration`, () => {
      for (const text of [schema, migration]) {
        const start = text.indexOf(`create policy "${policy}" on public.${table}`)
        expect(start).toBeGreaterThan(-1)
        const body = text.slice(start, text.indexOf(');', start))
        expect(body).toContain(`public.org_plan_at_least(org_id, '${tier}')`)
      }
    })
  })

  it('quantity-capped inserts use their own predicate', () => {
    for (const text of [schema, migration]) {
      const start = text.indexOf('create policy "scg_insert"')
      const body  = text.slice(start, text.indexOf(');', start))
      expect(body).toContain('public.org_can_add_custom_rule(org_id)')
    }
  })
})

describe('plan and billing columns are locked to the service role', () => {
  const guarded = [
    'plan_tier', 'plan_started_at', 'plan_expires_at', 'plan_status',
    'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id',
    'imported_rows_count', 'imported_rows_period_start',
  ]

  it.each([['schema', schema], ['migration', migration]])('%s installs the guard trigger', (_label, text) => {
    expect(text).toContain('create trigger trg_guard_org_plan_columns')
    expect(text).toContain('before update on public.organizations')
  })

  it.each(guarded)('the guard covers %s', (col) => {
    const start = schema.indexOf('function public.guard_org_plan_columns()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain(`'${col}'`)
  })

  // A bare `new.<col>` reference raises "record new has no field ..." on a
  // database that hasn't applied every billing migration — which would take
  // down every organizations UPDATE, not just a plan change.
  it('compares via to_jsonb rather than direct field references', () => {
    const start = schema.indexOf('function public.guard_org_plan_columns()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain('to_jsonb(old)')
    expect(body).toContain('to_jsonb(new)')
    const code = body.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\bnew\.(plan_|stripe_|trial_|imported_)/)
  })

  it('only the service role or a JWT-less session may pass', () => {
    const start = schema.indexOf('function public.plan_guard_is_privileged()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain("v_role in ('', 'service_role')")
  })

  it('the import counter RPC sets the transaction-local bypass', () => {
    const start = schema.indexOf('function public.increment_import_count(')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain("set_config('app.plan_guard_bypass', 'on', true)")
  })
})

describe('gated transaction types are enforced in the database', () => {
  it('every TXN_TYPE_FEATURE key appears in org_plan_allows_txn_type', () => {
    const start = schema.indexOf('function public.org_plan_allows_txn_type(')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    for (const type of Object.keys(TXN_TYPE_FEATURE)) {
      expect(body).toContain(`when '${type}'`)
    }
  })

  it('both transaction tables carry the trigger', () => {
    for (const text of [schema, migration]) {
      expect(text).toContain('create trigger trg_inflow_txn_type_plan')
      expect(text).toContain('create trigger trg_outflow_txn_type_plan')
    }
  })

  // A downgrade must not trap data: editing a row created on a higher tier
  // has to keep working, so the trigger only fires on an actual change.
  it('the trigger ignores updates that do not change transaction_type', () => {
    const start = schema.indexOf('function public.enforce_txn_type_plan()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain('new.transaction_type is not distinct from old.transaction_type')
  })

  // OLD is unassigned during INSERT and PL/pgSQL does not guarantee
  // short-circuit AND, so `tg_op = 'UPDATE' and old.x ...` in one condition
  // can raise "record old is not assigned yet" on every insert.
  it.each(['enforce_txn_type_plan()', 'enforce_bank_plan_limits()'])(
    '%s never reads OLD outside a tg_op = UPDATE block',
    (fn) => {
      const start = schema.indexOf(`function public.${fn}`)
      const body  = schema.slice(start, schema.indexOf('$$;', start))
      body.split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .filter(line => line.includes('old.'))
        .forEach(line => expect(line).not.toMatch(/tg_op\s*=\s*'UPDATE'\s+and/))
    },
  )
})

describe('bank quantity and currency caps are enforced in the database', () => {
  it('the trigger is installed on banks', () => {
    for (const text of [schema, migration]) {
      expect(text).toContain('create trigger trg_bank_plan_limits')
      expect(text).toContain('before insert or update on public.banks')
    }
  })

  it('the one-bank cap applies on INSERT only', () => {
    const start = schema.indexOf('function public.enforce_bank_plan_limits()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toMatch(/if tg_op = 'INSERT' and not public\.org_can_add_bank\(new\.org_id\)/)
  })

  it('editing an existing FX bank without changing currency is allowed', () => {
    const start = schema.indexOf('function public.enforce_bank_plan_limits()')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    expect(body).toContain('new.currency is not distinct from old.currency')
  })
})

// ── The two copies of the tier map must not drift ────────────────────────────

describe('client and database agree on which tier gates what', () => {
  it('the four gated transaction types require full in both', () => {
    const start = schema.indexOf('function public.org_plan_allows_txn_type(')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    for (const [type, feature] of Object.entries(TXN_TYPE_FEATURE)) {
      const clientTier = FEATURE_TIERS[feature!]
      const dbLine = body.split('\n').find(l => l.includes(`when '${type}'`))
      expect(dbLine).toBeDefined()
      expect(dbLine).toContain(`'${clientTier}'`)
    }
  })

  it('the custom-rule cap matches QUANTITY_LIMITS', () => {
    const start = schema.indexOf('function public.org_can_add_custom_rule(')
    const body  = schema.slice(start, schema.indexOf('$$;', start))
    // level1: 2, full: unlimited, free: none — see QUANTITY_LIMITS in usePlan.ts
    expect(body).toContain("when 'full'   then true")
    expect(body).toContain('< 2')
    expect(body).toContain('else               false')
  })
})
