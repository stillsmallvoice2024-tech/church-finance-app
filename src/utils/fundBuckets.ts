import { supabase } from '../lib/supabase'
import { fetchAllRows } from './fetchAllRows'
import { allocatePercent } from './financeMath'
import { isNonContributing } from './transactionTypes'
import {
  useAllocationStore,
  buildVersionIndex,
  type AllocationConfig,
  type SpecialConfigGroup,
} from '../store/allocationStore'

// ────────────────────────────────────────────────────────────────────────────
// Single source of truth for the three fund buckets per category.
//
// Historically CategoryLedger's summary cards and the Regular / Designated /
// Savings tabs each re-derived these numbers with independently-written
// formulas, and drifted. This module IS the CategoryLedger card algorithm
// (the one confirmed accurate), extracted so every surface reads from it.
//
// The card only needs each bucket's NET; the tabs also show deposited vs
// withdrawn. We therefore track in/out separately. Crucially, routing an
// internal-transfer debit to the *Out side (rather than reducing the *In side,
// as the card did inline) leaves every bucket's NET identical to the card —
// so card values are unchanged — while giving the tabs a correct in/out split.
// ────────────────────────────────────────────────────────────────────────────

export interface CategoryBuckets {
  category: string
  pctIn:  number; pctOut:  number   // Regular Funds (Percentage Allocation)
  seedIn: number; seedOut: number   // Designated Gifts (Specific Seed)
  savIn:  number; savOut:  number   // Savings Funds
}

// Per-target breakdown for the Designated Gifts tab; grouped seed contributions.
export interface SeedTarget {
  target: string
  total:  number   // signed: deposits positive, withdrawals negative
  count:  number
  latest: string
}

export interface FundBuckets {
  byCategory:  Map<string, CategoryBuckets>
  seedTargets: Map<string, SeedTarget[]>
  error:       string | null
}

// ── Raw input shapes (already org-scoped by the caller) ──────────────────────

export interface FundBucketInputs {
  seedInflows:  Array<{ stage_code_1: string | null; amount: number; date?: string | null; specific_seed_description?: string | null; description?: string | null }>
  seedOutflows: Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  savInflows:   Array<{ stage_code_1: string | null; amount: number }>
  savOutflows:  Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  allInflows:   Array<{ date: string; amount: number; stage_code_2: string | null; allocation_config_id: string | null; income_type_id: string | null; transaction_type?: string | null; offset_role?: string | null; description?: string | null }>
  openingBalances: Array<{ budget_portion: string | null; amount: number; category: string }>
  intraFlows:   Array<{ account_from: string | null; account_from_stage2: string | null; account_to: string | null; account_to_stage2: string | null; total_amount: number; date?: string | null }>
  pctOutflows:  Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  incomeTypeGroup: Map<string, string | null>
  configs: AllocationConfig[]
  groups:  SpecialConfigGroup[]
}

// ── Pure aggregator (unit-testable, no I/O) ──────────────────────────────────

export function aggregateFundBuckets(inp: FundBucketInputs): Omit<FundBuckets, 'error'> {
  const versionIndex = buildVersionIndex(inp.configs, inp.groups)

  const map = new Map<string, CategoryBuckets>()
  const ensure = (cat: string) => {
    let b = map.get(cat)
    if (!b) { b = { category: cat, pctIn: 0, pctOut: 0, seedIn: 0, seedOut: 0, savIn: 0, savOut: 0 }; map.set(cat, b) }
    return b
  }

  const seedContribs = new Map<string, Array<{ label: string; amount: number; date: string }>>()
  const addSeed = (cat: string, label: string, amount: number, date: string) => {
    const arr = seedContribs.get(cat) ?? []
    arr.push({ label, amount, date })
    seedContribs.set(cat, arr)
  }

  // Direct Specific Seed inflows
  for (const r of inp.seedInflows) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount)
    ensure(cat).seedIn += amt
    addSeed(cat, r.specific_seed_description || r.description || '(No target specified)', amt, r.date ?? '')
  }
  // Direct Specific Seed outflows (offset rows subtract instead of add)
  for (const r of inp.seedOutflows) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount_disbursed || 0)
    const net = r.offset_role === 'offset' ? -amt : amt
    ensure(cat).seedOut += net
    addSeed(cat, 'Withdrawal', -net, '')
  }
  // Direct Savings inflows / outflows
  for (const r of inp.savInflows) {
    ensure(r.stage_code_1 || '(Uncategorised)').savIn += Number(r.amount)
  }
  for (const r of inp.savOutflows) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount_disbursed || 0)
    ensure(cat).savOut += r.offset_role === 'offset' ? -amt : amt
  }

  // Opening balances by portion
  for (const ob of inp.openingBalances) {
    if (!ob.category) continue
    const b = ensure(ob.category)
    if (ob.budget_portion === 'Specific Seed')            { b.seedIn += Number(ob.amount); addSeed(ob.category, 'Opening Balance', Number(ob.amount), '') }
    else if (ob.budget_portion === 'Savings')             { b.savIn  += Number(ob.amount) }
    else if (ob.budget_portion === 'Percentage Allocation') { b.pctIn += Number(ob.amount) }
  }

  // Config-distributed inflows (date-resolved general config OR explicit id)
  for (const r of inp.allInflows) {
    if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue
    if (isNonContributing(r)) continue
    const cfg = r.allocation_config_id
      ? (inp.configs.find(c => c.id === r.allocation_config_id)
          ?? versionIndex.resolve(r.income_type_id ? (inp.incomeTypeGroup.get(r.income_type_id) ?? null) : null, r.date))
      : versionIndex.resolve(r.income_type_id ? (inp.incomeTypeGroup.get(r.income_type_id) ?? null) : null, r.date)
    if (!cfg) continue
    for (const catRow of cfg.rows) {
      let allocated: number
      if (catRow.amount != null && catRow.amount > 0)       allocated = catRow.amount
      else if (catRow.percentage)                           allocated = allocatePercent(Number(r.amount), catRow.percentage)
      else continue
      if (catRow.budget_portion === 'Specific Seed')        { ensure(catRow.category_name).seedIn += allocated; addSeed(catRow.category_name, r.description || 'Distribution rule', allocated, r.date) }
      else if (catRow.budget_portion === 'Savings')         { ensure(catRow.category_name).savIn  += allocated }
      else                                                  { ensure(catRow.category_name).pctIn  += allocated }
    }
  }

  // Internal transfers: FROM = withdrawal (Out), TO = deposit (In).
  // Net (In−Out) per bucket is identical to the card's inline reduction.
  for (const r of inp.intraFlows) {
    const amount = Number(r.total_amount)
    if (amount <= 0) continue
    const fromCat = r.account_from || '', fromStage = r.account_from_stage2 || ''
    const toCat   = r.account_to   || '', toStage   = r.account_to_stage2   || ''
    if (fromCat === toCat && fromStage === toStage) continue
    const date = r.date ?? ''
    if (fromCat) {
      if (fromStage === 'Percentage Allocation')      ensure(fromCat).pctOut  += amount
      else if (fromStage === 'Specific Seed')         { ensure(fromCat).seedOut += amount; addSeed(fromCat, `Transfer Out (to ${toCat || 'unknown'})`, -amount, date) }
      else if (fromStage === 'Savings')               ensure(fromCat).savOut  += amount
    }
    if (toCat) {
      if (toStage === 'Percentage Allocation')        ensure(toCat).pctIn  += amount
      else if (toStage === 'Specific Seed')           { ensure(toCat).seedIn += amount; addSeed(toCat, `Transfer In (from ${fromCat || 'unknown'})`, amount, date) }
      else if (toStage === 'Savings')                 ensure(toCat).savIn  += amount
    }
  }

  // Percentage outflows (all non-seed/non-savings), offset rows subtract
  for (const r of inp.pctOutflows) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount_disbursed || 0)
    ensure(cat).pctOut += r.offset_role === 'offset' ? -amt : amt
  }

  // Group seed contributions into per-category targets
  const seedTargets = new Map<string, SeedTarget[]>()
  for (const [cat, contribs] of seedContribs) {
    const byTarget = new Map<string, SeedTarget>()
    for (const c of contribs) {
      const t = byTarget.get(c.label) ?? { target: c.label, total: 0, count: 0, latest: '' }
      t.total += c.amount
      t.count += 1
      if (c.date && c.date > t.latest) t.latest = c.date
      byTarget.set(c.label, t)
    }
    seedTargets.set(cat, [...byTarget.values()].sort((a, b) => b.total - a.total))
  }

  return { byCategory: map, seedTargets }
}

// ── DB-fetch wrapper ─────────────────────────────────────────────────────────

export async function computeFundBuckets(orgId: string): Promise<FundBuckets> {
  // Ensure allocation configs/groups are available (cached across calls).
  const store = useAllocationStore.getState()
  if (!store.loaded && !store.loading) await store.fetch()
  const { configs, groups } = useAllocationStore.getState()

  const [seedRes, seedOutRes, savInRes, savOutRes, allInflowRes, cobRes, intraFlowRes, pctOutRes, incomeTypeRes] = await Promise.all([
    fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, amount, date, specific_seed_description, description').eq('org_id', orgId).eq('stage_code_2', 'Specific Seed')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role').eq('org_id', orgId).eq('stage_code_2', 'Specific Seed')),
    fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, amount').eq('org_id', orgId).eq('stage_code_2', 'Savings')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role').eq('org_id', orgId).eq('stage_code_2', 'Savings')),
    fetchAllRows(() => supabase.from('inflow_transactions').select('date, amount, stage_code_2, allocation_config_id, income_type_id, transaction_type, offset_role, description').eq('org_id', orgId)),
    supabase.from('category_opening_balances').select('budget_portion, amount, categories(name)').eq('org_id', orgId),
    fetchAllRows(() => supabase.from('intra_flows').select('account_from, account_from_stage2, account_to, account_to_stage2, total_amount, date').eq('org_id', orgId).eq('status', 'active')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role').eq('org_id', orgId).not('stage_code_2', 'eq', 'Specific Seed').not('stage_code_2', 'eq', 'Savings')),
    supabase.from('income_types').select('id, special_config_group_id').eq('org_id', orgId),
  ])

  const fatal = seedRes.error || seedOutRes.error || savInRes.error || savOutRes.error || allInflowRes.error || pctOutRes.error
  if (fatal) return { byCategory: new Map(), seedTargets: new Map(), error: fatal.message }

  const incomeTypeGroup = new Map<string, string | null>(
    (incomeTypeRes.data ?? []).map((r: Record<string, unknown>) => [r.id as string, (r.special_config_group_id as string | null) ?? null]),
  )

  const openingBalances = (cobRes.error ? [] : (cobRes.data ?? [])).map(ob => ({
    budget_portion: ob.budget_portion as string | null,
    amount:         Number(ob.amount),
    category:       (ob.categories as unknown as { name: string } | null)?.name ?? '',
  }))

  const { byCategory, seedTargets } = aggregateFundBuckets({
    seedInflows:  (seedRes.data ?? []) as FundBucketInputs['seedInflows'],
    seedOutflows: (seedOutRes.data ?? []) as FundBucketInputs['seedOutflows'],
    savInflows:   (savInRes.data ?? []) as FundBucketInputs['savInflows'],
    savOutflows:  (savOutRes.data ?? []) as FundBucketInputs['savOutflows'],
    allInflows:   (allInflowRes.data ?? []) as FundBucketInputs['allInflows'],
    openingBalances,
    intraFlows:   (intraFlowRes.error ? [] : (intraFlowRes.data ?? [])) as FundBucketInputs['intraFlows'],
    pctOutflows:  (pctOutRes.data ?? []) as FundBucketInputs['pctOutflows'],
    incomeTypeGroup,
    configs,
    groups,
  })

  return { byCategory, seedTargets, error: null }
}
