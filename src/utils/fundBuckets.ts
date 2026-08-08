import { supabase } from '../lib/supabase'
import { fetchAllRows } from './fetchAllRows'
import { allocatePercent } from './financeMath'
import { isNonContributing } from './transactionTypes'
import { fetchCategoryNamesById, resolveFundName } from './categoryReferences'
import {
  useAllocationStore,
  buildVersionIndex,
  type AllocationConfig,
  type SpecialConfigGroup,
} from '../store/allocationStore'
import { useTransactionSyncStore } from '../store/transactionSyncStore'

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

// ── Pre-aggregated input shapes (server-summed) ──────────────────────────────
//
// Five of the row sets below — seed in/out, savings in/out, percentage outflows
// — are only ever summed. `org_category_fund_totals` and `org_seed_target_totals`
// (migration 20260807000002) do that summing in Postgres and return one row per
// category / per seed target instead of one per transaction. Feeding those
// totals in here produces byte-identical output to walking the raw rows, so the
// two paths stay interchangeable: the raw arrays remain the fallback for a
// database that has not had the migration applied yet.

export interface PreAggregatedFundTotals {
  category: string
  seedIn:   number
  seedOut:  number
  savIn:    number
  savOut:   number
  pctOut:   number
}

export interface PreAggregatedSeedTarget {
  category: string
  label:    string
  total:    number
  count:    number
  latest:   string
}

// ── Raw input shapes (already org-scoped by the caller) ──────────────────────

export interface FundBucketInputs {
  seedInflows?:  Array<{ stage_code_1: string | null; amount: number; date?: string | null; specific_seed_description?: string | null; description?: string | null }>
  seedOutflows?: Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  savInflows?:   Array<{ stage_code_1: string | null; amount: number }>
  savOutflows?:  Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  allInflows:   Array<{ date: string; amount: number; stage_code_2: string | null; allocation_config_id: string | null; income_type_id: string | null; transaction_type?: string | null; offset_role?: string | null; description?: string | null }>
  openingBalances: Array<{ budget_portion: string | null; amount: number; category: string }>
  intraFlows:   Array<{ account_from: string | null; account_from_stage2: string | null; account_to: string | null; account_to_stage2: string | null; total_amount: number; date?: string | null }>
  pctOutflows?:  Array<{ stage_code_1: string | null; amount_disbursed: number; offset_role?: string | null }>
  incomeTypeGroup: Map<string, string | null>
  configs: AllocationConfig[]
  groups:  SpecialConfigGroup[]
  // Server-summed replacement for the five optional row arrays above. When
  // present those arrays are expected to be empty — supplying both would
  // double-count.
  preAggregated?: {
    totals:      PreAggregatedFundTotals[]
    seedTargets: PreAggregatedSeedTarget[]
  }
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

  // `count` is how many underlying transactions this contribution stands for.
  // It is 1 per row on the raw path; on the pre-aggregated path one entry can
  // stand for many rows, and the Designated Gifts tab shows that tally.
  const seedContribs = new Map<string, Array<{ label: string; amount: number; date: string; count: number }>>()
  const addSeed = (cat: string, label: string, amount: number, date: string, count = 1) => {
    const arr = seedContribs.get(cat) ?? []
    arr.push({ label, amount, date, count })
    seedContribs.set(cat, arr)
  }

  // Server-summed seed / savings / percentage-outflow totals, when available.
  for (const t of inp.preAggregated?.totals ?? []) {
    const b = ensure(t.category)
    b.seedIn  += t.seedIn
    b.seedOut += t.seedOut
    b.savIn   += t.savIn
    b.savOut  += t.savOut
    b.pctOut  += t.pctOut
  }
  for (const s of inp.preAggregated?.seedTargets ?? []) {
    addSeed(s.category, s.label, s.total, s.latest, s.count)
  }

  // Direct Specific Seed inflows
  for (const r of inp.seedInflows ?? []) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount)
    ensure(cat).seedIn += amt
    addSeed(cat, r.specific_seed_description || r.description || '(No target specified)', amt, r.date ?? '')
  }
  // Direct Specific Seed outflows (offset rows subtract instead of add)
  for (const r of inp.seedOutflows ?? []) {
    const cat = r.stage_code_1 || '(Uncategorised)'
    const amt = Number(r.amount_disbursed || 0)
    const net = r.offset_role === 'offset' ? -amt : amt
    ensure(cat).seedOut += net
    addSeed(cat, 'Withdrawal', -net, '')
  }
  // Direct Savings inflows / outflows
  for (const r of inp.savInflows ?? []) {
    ensure(r.stage_code_1 || '(Uncategorised)').savIn += Number(r.amount)
  }
  for (const r of inp.savOutflows ?? []) {
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
  for (const r of inp.pctOutflows ?? []) {
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
      t.count += c.count
      if (c.date && c.date > t.latest) t.latest = c.date
      byTarget.set(c.label, t)
    }
    seedTargets.set(cat, [...byTarget.values()].sort((a, b) => b.total - a.total))
  }

  return { byCategory: map, seedTargets }
}

// ── DB-fetch wrapper ─────────────────────────────────────────────────────────

// Rows the config-distribution pass discards outright. Pushing these to the
// server means they are never sent to the browser at all — previously every one
// of them was downloaded and then dropped by `isNonContributing`.
const NON_ALLOCATABLE_LIST = 'balance_brought_forward,reversal,refund,bank_deposit,intrabank_transfer'

// PostgREST NULL semantics: `neq`/`not.in` never match a NULL, so each filter
// needs an explicit `is.null` branch or rows with no value would be dropped.
// Separate `.or()` calls are ANDed together.
function percentageEligibleInflows(orgId: string) {
  return supabase
    .from('inflow_transactions')
    .select('date, amount, stage_code_2, allocation_config_id, income_type_id, transaction_type, offset_role, description')
    .eq('org_id', orgId)
    .or('stage_code_2.is.null,stage_code_2.eq.Percentage Allocation')
    .or('offset_role.is.null,offset_role.neq.offset')
    .or(`transaction_type.is.null,transaction_type.not.in.(${NON_ALLOCATABLE_LIST})`)
}

// ── Server-side aggregate fast path ──────────────────────────────────────────

interface FundTotalsRow  { category_id: string | null; stage_code_1: string | null; seed_in: number; seed_out: number; seed_out_count: number; sav_in: number; sav_out: number; pct_out: number }
interface SeedTargetRow  { category_id: string | null; stage_code_1: string | null; label: string; total: number; entry_count: number; latest: string | null }

// Set to false the first time the RPCs come back missing, so a database that
// has not had 20260807000002 applied pays the failed round-trip once per page
// load rather than on every call.
let aggregateRpcAvailable = true

async function fetchServerAggregates(orgId: string): Promise<{ totals: FundTotalsRow[]; targets: SeedTargetRow[] } | null> {
  if (!aggregateRpcAvailable) return null
  const [totalsRes, targetsRes] = await Promise.all([
    supabase.rpc('org_category_fund_totals', { p_org_id: orgId }),
    supabase.rpc('org_seed_target_totals',   { p_org_id: orgId }),
  ])
  if (totalsRes.error || targetsRes.error) {
    aggregateRpcAvailable = false
    return null
  }
  return {
    totals:  (totalsRes.data  ?? []) as FundTotalsRow[],
    targets: (targetsRes.data ?? []) as SeedTargetRow[],
  }
}

// ── Shared result cache ──────────────────────────────────────────────────────
//
// Four pages — Category Accounts, Regular Funds, Savings Funds, Designated
// Gifts — each call computeFundBuckets on mount. Without this they re-ran the
// whole fetch on every tab switch. The key carries the transaction-sync
// versions, so any write that bumps one invalidates the cache immediately; the
// TTL only bounds staleness from writes that bump nothing (a category rename,
// an opening-balance edit), both of which also call invalidateFundBuckets().

const CACHE_TTL_MS = 15_000

let cache: { key: string; at: number; promise: Promise<FundBuckets> } | null = null

function cacheKey(orgId: string): string {
  const s = useTransactionSyncStore.getState()
  return `${orgId}|${s.inflowVersion}|${s.outflowVersion}|${s.intraflowVersion}`
}

/** Drop the shared cache — call after any write that does not bump a sync version. */
export function invalidateFundBuckets(): void {
  cache = null
}

export function computeFundBuckets(orgId: string): Promise<FundBuckets> {
  const key = cacheKey(orgId)
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.promise

  const promise = loadFundBuckets(orgId)
  const entry = { key, at: Date.now(), promise }
  cache = entry
  // Never cache a failure: a transient network error would otherwise be served
  // to the next three pages for the rest of the TTL.
  promise
    .then(r => { if (r.error && cache === entry) cache = null })
    .catch(() => { if (cache === entry) cache = null })
  return promise
}

async function loadFundBuckets(orgId: string): Promise<FundBuckets> {
  // Ensure allocation configs/groups are available (cached across calls).
  const store = useAllocationStore.getState()
  if (!store.loaded && !store.loading) await store.fetch()
  const { configs, groups } = useAllocationStore.getState()

  const [aggregates, allInflowRes, cobRes, intraFlowRes, incomeTypeRes] = await Promise.all([
    fetchServerAggregates(orgId),
    fetchAllRows(() => percentageEligibleInflows(orgId)),
    supabase.from('category_opening_balances').select('budget_portion, amount, categories(name)').eq('org_id', orgId),
    fetchAllRows(() => supabase.from('intra_flows').select('account_from, from_category_id, account_from_stage2, account_to, to_category_id, account_to_stage2, total_amount, date').eq('org_id', orgId).eq('status', 'active')),
    supabase.from('income_types').select('id, special_config_group_id').eq('org_id', orgId),
  ])

  // Fallback for a database without migration 20260807000002: pull the five
  // aggregate row sets and let the aggregator sum them client-side, exactly as
  // before. Same numbers, more data over the wire.
  const raw = aggregates ? null : await fetchRawAggregateRows(orgId)

  const fatal = allInflowRes.error || raw?.error
  if (fatal) return { byCategory: new Map(), seedTargets: new Map(), error: fatal.message }

  const incomeTypeGroup = new Map<string, string | null>(
    (incomeTypeRes.data ?? []).map((r: Record<string, unknown>) => [r.id as string, (r.special_config_group_id as string | null) ?? null]),
  )

  const openingBalances = (cobRes.error ? [] : (cobRes.data ?? [])).map(ob => ({
    budget_portion: ob.budget_portion as string | null,
    amount:         Number(ob.amount),
    category:       (ob.categories as unknown as { name: string } | null)?.name ?? '',
  }))

  // Fund grouping key: category_id is authoritative, stage_code_1 is a display
  // snapshot that can lag behind a rename on rows written before the backfill.
  // Resolve to the category's CURRENT name here, at the I/O boundary, so the
  // aggregator below stays a pure name-keyed function.
  let namesById = new Map<string, string>()
  try { namesById = await fetchCategoryNamesById(orgId) } catch { /* fall back to the text snapshot */ }

  type Snapshot = { stage_code_1?: string | null; category_id?: string | null }
  const byFund = <T extends Snapshot>(rows: unknown): T[] =>
    ((rows ?? []) as T[]).map(r => ({
      ...r,
      stage_code_1: resolveFundName(namesById, r.category_id, r.stage_code_1),
    }))

  type IntraSnapshot = {
    account_from?: string | null; from_category_id?: string | null
    account_to?:   string | null; to_category_id?:   string | null
  }
  const intraByFund = ((intraFlowRes.error ? [] : (intraFlowRes.data ?? [])) as IntraSnapshot[]).map(r => ({
    ...r,
    account_from: resolveFundName(namesById, r.from_category_id, r.account_from),
    account_to:   resolveFundName(namesById, r.to_category_id,   r.account_to),
  }))

  const { byCategory, seedTargets } = aggregateFundBuckets({
    // Fast path and fallback are mutually exclusive — exactly one of these
    // supplies the seed / savings / percentage-outflow figures.
    ...(aggregates
      ? { preAggregated: foldServerAggregates(aggregates, namesById) }
      : {
          seedInflows:  byFund(raw!.seedIn.data)   as unknown as FundBucketInputs['seedInflows'],
          seedOutflows: byFund(raw!.seedOut.data)  as unknown as FundBucketInputs['seedOutflows'],
          savInflows:   byFund(raw!.savIn.data)    as unknown as FundBucketInputs['savInflows'],
          savOutflows:  byFund(raw!.savOut.data)   as unknown as FundBucketInputs['savOutflows'],
          pctOutflows:  byFund(raw!.pctOut.data)   as unknown as FundBucketInputs['pctOutflows'],
        }),
    allInflows:   (allInflowRes.data ?? []) as FundBucketInputs['allInflows'],
    openingBalances,
    intraFlows:   intraByFund as unknown as FundBucketInputs['intraFlows'],
    incomeTypeGroup,
    configs,
    groups,
  })

  return { byCategory, seedTargets, error: null }
}

/**
 * Collapses the server's raw (category_id, stage_code_1) groups onto resolved
 * fund names. Two server rows can land on the same fund — one carrying a
 * category_id, one an older text snapshot from before the backfill — so they
 * are summed rather than overwritten.
 *
 * The "Withdrawal" seed target is reconstructed here from the outflow totals,
 * mirroring the per-row `addSeed(cat, 'Withdrawal', -net, '')` on the raw path:
 * total is the negated sum, count the number of underlying rows, date empty.
 */
function foldServerAggregates(
  aggregates: { totals: FundTotalsRow[]; targets: SeedTargetRow[] },
  namesById:  Map<string, string>,
): { totals: PreAggregatedFundTotals[]; seedTargets: PreAggregatedSeedTarget[] } {
  const fundOf = (r: { category_id: string | null; stage_code_1: string | null }) =>
    resolveFundName(namesById, r.category_id, r.stage_code_1) || '(Uncategorised)'

  const totals = new Map<string, PreAggregatedFundTotals>()
  const seedTargets: PreAggregatedSeedTarget[] = []

  for (const r of aggregates.totals) {
    const category = fundOf(r)
    const t = totals.get(category)
      ?? { category, seedIn: 0, seedOut: 0, savIn: 0, savOut: 0, pctOut: 0 }
    t.seedIn  += Number(r.seed_in)
    t.seedOut += Number(r.seed_out)
    t.savIn   += Number(r.sav_in)
    t.savOut  += Number(r.sav_out)
    t.pctOut  += Number(r.pct_out)
    totals.set(category, t)

    const outCount = Number(r.seed_out_count)
    if (outCount > 0) {
      seedTargets.push({ category, label: 'Withdrawal', total: -Number(r.seed_out), count: outCount, latest: '' })
    }
  }

  for (const r of aggregates.targets) {
    seedTargets.push({
      category: fundOf(r),
      label:    r.label,
      total:    Number(r.total),
      count:    Number(r.entry_count),
      latest:   r.latest ?? '',
    })
  }

  return { totals: [...totals.values()], seedTargets }
}

/**
 * The five per-transaction scans the RPCs replace. Only reached on a database
 * without migration 20260807000002.
 */
async function fetchRawAggregateRows(orgId: string) {
  const [seedIn, seedOut, savIn, savOut, pctOut] = await Promise.all([
    fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, category_id, amount, date, specific_seed_description, description').eq('org_id', orgId).eq('stage_code_2', 'Specific Seed')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, category_id, amount_disbursed, offset_role').eq('org_id', orgId).eq('stage_code_2', 'Specific Seed')),
    fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, category_id, amount').eq('org_id', orgId).eq('stage_code_2', 'Savings')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, category_id, amount_disbursed, offset_role').eq('org_id', orgId).eq('stage_code_2', 'Savings')),
    fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, category_id, amount_disbursed, offset_role').eq('org_id', orgId).not('stage_code_2', 'eq', 'Specific Seed').not('stage_code_2', 'eq', 'Savings')),
  ])
  const error = seedIn.error || seedOut.error || savIn.error || savOut.error || pctOut.error
  return { seedIn, seedOut, savIn, savOut, pctOut, error }
}
