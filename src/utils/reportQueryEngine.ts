import { supabase } from '../lib/supabase'
import { allocatePercent } from './financeMath'
import { isNonContributing } from './transactionTypes'

export interface DateRange {
  from: string
  to: string
}

export interface QueryResult {
  value: number
  error: string | null
}

// Token-side portion key → DB stage_code_2 value
export type BudgetPortion = 'all' | 'seed' | 'savings' | 'percentage'

export const STAGE_CODE_MAP: Record<string, string> = {
  seed:       'Specific Seed',
  savings:    'Savings',
  percentage: 'Percentage Allocation',
}

// Internal config shape returned by fetchLockedConfigs
interface RawConfig {
  id:              string
  rows:            unknown
  config_group_id?: string | null
  start_date?:     string | null
  end_date?:       string | null
  effective_from?: string | null
  effective_to?:   string | null
  is_special?:     boolean | null
}

interface RawGroup {
  id:         string
  is_default: boolean
}

// Build a minimal version index for batch resolution inside this module.
function buildRawIndex(configs: RawConfig[], groups: RawGroup[]) {
  const generalGroupId = groups.find(g => g.is_default)?.id ?? null
  const byGroup = new Map<string, RawConfig[]>()
  for (const c of configs) {
    if (!c.config_group_id) continue
    const arr = byGroup.get(c.config_group_id) ?? []
    arr.push(c)
    byGroup.set(c.config_group_id, arr)
  }
  return {
    generalGroupId,
    resolve(groupId: string | null, date: string): RawConfig | null {
      const target = groupId ?? generalGroupId
      if (!target) return null
      const versions = byGroup.get(target) ?? []
      let result: RawConfig | null = null
      for (const v of versions) {
        const from = v.effective_from ?? v.start_date
        const to   = v.effective_to   ?? v.end_date
        if (from && date < from) continue
        if (to   && date > to)   continue
        if (!result) { result = v; continue }
        const vFrom = v.effective_from ?? v.start_date ?? ''
        const rFrom = result.effective_from ?? result.start_date ?? ''
        if (vFrom > rFrom) result = v
      }
      return result
    },
  }
}

// Fetch ALL locked allocation configs so explicit allocation_config_id
// references to special configs are resolved correctly.
async function fetchLockedConfigs(): Promise<{ data: RawConfig[] | null; error: { message: string } | null }> {
  return supabase
    .from('allocation_configs')
    .select('id, rows, config_group_id, effective_from, effective_to, start_date, end_date, is_special')
    .eq('status', 'locked')
}

async function fetchGroups(): Promise<{ data: RawGroup[] | null; error: { message: string } | null }> {
  return supabase
    .from('special_config_groups')
    .select('id, is_default')
}

async function fetchIncomeTypeGroupMap(): Promise<Map<string, string | null>> {
  const { data } = await supabase.from('income_types').select('id, special_config_group_id')
  return new Map<string, string | null>(
    (data ?? []).map((r: Record<string, unknown>) => [r.id as string, r.special_config_group_id as string | null])
  )
}

// ── Config-distributed inflow helper ──────────────────────────────────────────
//
// Computes the portion of general inflow_transactions that is allocated to
// `category` via allocation configs.
//
// portionFilter:
//   'Specific Seed'        → only config rows with that budget_portion
//   'Savings'              → only config rows with that budget_portion
//   'Percentage Allocation'→ only config rows with Percentage / unset budget_portion
//   null                   → all config rows for this category (all budget portions)
//
// NOTE: Direct seed/savings inflows (stage_code_2 explicitly set) are excluded
// here and must be counted separately via the stage_code_1 direct queries.
async function getCategoryConfigInflows(
  category:     string,
  dateRange:    DateRange | undefined,
  dateField:    string | undefined,
  portionFilter: string | null,
): Promise<QueryResult> {
  const col = dateField === 'recorded_at' ? 'recorded_at' : 'date'

  let inflowQ = supabase
    .from('inflow_transactions')
    .select('amount, allocation_config_id, income_type_id, date, transaction_type, stage_code_2, offset_role')
    // Allow null (normal inflows) and fx_conversion (converted naira). All other tagged
    // types (reversal, refund, bank_deposit, intrabank_transfer, balance_brought_forward)
    // are pass-through entries that carry no allocatable income.
    .or('transaction_type.is.null,transaction_type.eq.fx_conversion')

  if (dateRange) {
    const to = col === 'recorded_at' ? `${dateRange.to}T23:59:59` : dateRange.to
    inflowQ = inflowQ.gte(col, dateRange.from).lte(col, to)
  }

  const [inflowRes, configRes, groupsRes, itGroupMap] = await Promise.all([
    inflowQ,
    fetchLockedConfigs(),
    fetchGroups(),
    fetchIncomeTypeGroupMap(),
  ])

  if (inflowRes.error) return { value: 0, error: inflowRes.error.message }
  if (configRes.error) return { value: 0, error: configRes.error.message }

  const configs   = configRes.data ?? []
  const rawIndex  = buildRawIndex(configs, groupsRes.data ?? [])
  let total = 0

  for (const inflow of inflowRes.data ?? []) {
    // Belt-and-suspenders: PostgREST filter already excludes non-allocatable types,
    // but isNonContributing also catches offset_role='offset' rows on migrated DBs.
    if (isNonContributing(inflow)) continue
    const s2 = inflow.stage_code_2 as string | null
    // Direct seed/savings inflows are counted via stage_code_1 direct queries
    if (s2 === 'Specific Seed' || s2 === 'Savings') continue

    const cfgId        = inflow.allocation_config_id as string | null
    const incomeTypeId = inflow.income_type_id as string | null
    const groupId      = incomeTypeId ? (itGroupMap.get(incomeTypeId) ?? null) : null
    const cfg = cfgId
      ? (configs.find(c => c.id === cfgId) ?? rawIndex.resolve(groupId, inflow.date as string))
      : rawIndex.resolve(groupId, inflow.date as string)
    if (!cfg) continue

    const rows = Array.isArray(cfg.rows) ? cfg.rows : []
    for (const row of rows as Array<Record<string, unknown>>) {
      if (row.category_name !== category) continue
      if (!row.percentage) continue

      if (portionFilter !== null) {
        // Normalize: config rows with budget_portion='Percentage' or unset → 'Percentage Allocation'
        const rowPortion = (row.budget_portion as string) || 'Percentage Allocation'
        const normalized = rowPortion === 'Percentage' ? 'Percentage Allocation' : rowPortion
        if (normalized !== portionFilter) continue
      }

      total += allocatePercent(Number(inflow.amount), Number(row.percentage))
    }
  }

  return { value: total, error: null }
}

// ── Opening-balance helper ─────────────────────────────────────────────────────

async function getCategoryOpeningBalance(
  category: string,
  portion?: BudgetPortion,
): Promise<QueryResult> {
  const { data, error } = await supabase
    .from('category_opening_balances')
    .select('amount, budget_portion, categories(name)')

  if (error) return { value: 0, error: error.message }

  let total = 0
  for (const row of data ?? []) {
    const catName = (row.categories as unknown as { name: string } | null)?.name
    if (catName !== category) continue

    if (portion && portion !== 'all') {
      const expected = STAGE_CODE_MAP[portion]
      if (row.budget_portion !== expected) continue
    }
    total += Number(row.amount)
  }

  return { value: total, error: null }
}

// ── Public query functions ─────────────────────────────────────────────────────

export async function getCategoryInflows(
  category:  string,
  dateRange?: DateRange,
  portion?:   BudgetPortion,
  dateField?: string,
): Promise<QueryResult> {
  const col = dateField === 'recorded_at' ? 'recorded_at' : 'date'

  // ── Percentage portion: purely config-distributed ─────────────────────────
  if (portion === 'percentage') {
    const cfgResult = await getCategoryConfigInflows(
      category, dateRange, dateField, 'Percentage Allocation',
    )
    if (cfgResult.error) return cfgResult

    let intraQ = supabase
      .from('intra_flows')
      .select('total_amount')
      .eq('account_to', category)
      .eq('account_to_stage2', 'Percentage Allocation')
      .eq('status', 'active')
    if (dateRange) intraQ = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)

    const intraRes = await intraQ
    const intraTotal = intraRes.error
      ? 0
      : (intraRes.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0)

    return { value: cfgResult.value + intraTotal, error: null }
  }

  // ── Seed or savings: direct transactions + config-split for this portion ──
  if (portion === 'seed' || portion === 'savings') {
    const stageCode = STAGE_CODE_MAP[portion]

    let directQ = supabase
      .from('inflow_transactions')
      .select('amount')
      .eq('stage_code_1', category)
      .eq('stage_code_2', stageCode)
    let intraQ = supabase
      .from('intra_flows')
      .select('total_amount')
      .eq('account_to', category)
      .eq('account_to_stage2', stageCode)
      .eq('status', 'active')

    if (dateRange) {
      const to = col === 'recorded_at' ? `${dateRange.to}T23:59:59` : dateRange.to
      directQ = directQ.gte(col, dateRange.from).lte(col, to)
      intraQ  = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
    }

    const [directRes, cfgResult, intraRes] = await Promise.all([
      directQ,
      getCategoryConfigInflows(category, dateRange, dateField, stageCode),
      intraQ,
    ])

    if (directRes.error) return { value: 0, error: directRes.error.message }
    if (cfgResult.error) return cfgResult

    const directTotal = (directRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const intraTotal  = intraRes.error
      ? 0
      : (intraRes.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0)

    return { value: directTotal + cfgResult.value + intraTotal, error: null }
  }

  // ── All portions: direct seed + direct savings + all config-distributed + all intra ──
  // Uses three separate queries to avoid double-counting:
  //   • direct seed/savings (stage_code_1 = category, explicit stage_code_2)
  //   • config-distributed inflows across ALL budget portions (stage_code_2 = null)
  //   • all intra-flows credited to this category (any stage2)
  {
    let seedQ = supabase
      .from('inflow_transactions')
      .select('amount')
      .eq('stage_code_1', category)
      .eq('stage_code_2', 'Specific Seed')
    let savingsQ = supabase
      .from('inflow_transactions')
      .select('amount')
      .eq('stage_code_1', category)
      .eq('stage_code_2', 'Savings')
    let intraQ = supabase
      .from('intra_flows')
      .select('total_amount')
      .eq('account_to', category)
      .eq('status', 'active')

    if (dateRange) {
      const to = col === 'recorded_at' ? `${dateRange.to}T23:59:59` : dateRange.to
      seedQ    = seedQ.gte(col, dateRange.from).lte(col, to)
      savingsQ = savingsQ.gte(col, dateRange.from).lte(col, to)
      intraQ   = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
    }

    const [seedRes, savingsRes, cfgResult, intraRes] = await Promise.all([
      seedQ,
      savingsQ,
      getCategoryConfigInflows(category, dateRange, dateField, null),
      intraQ,
    ])

    if (seedRes.error)    return { value: 0, error: seedRes.error.message }
    if (savingsRes.error) return { value: 0, error: savingsRes.error.message }
    if (cfgResult.error)  return cfgResult

    const seedTotal    = (seedRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const savingsTotal = (savingsRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const intraTotal   = intraRes.error
      ? 0
      : (intraRes.data ?? []).reduce((s, r) => s + Number(r.total_amount), 0)

    return { value: seedTotal + savingsTotal + cfgResult.value + intraTotal, error: null }
  }
}

export async function getCategoryOutflows(
  category:  string,
  dateRange?: DateRange,
  portion?:   BudgetPortion,
  dateField?: string,
): Promise<QueryResult> {
  const col = dateField === 'recorded_at' ? 'recorded_at' : 'date'

  let q = supabase
    .from('outflow_transactions')
    .select('amount_disbursed, offset_role')
    .eq('stage_code_1', category)

  let intraQ = supabase
    .from('intra_flows')
    .select('total_amount')
    .eq('account_from', category)
    .eq('status', 'active')

  if (dateRange) {
    const to = col === 'recorded_at' ? `${dateRange.to}T23:59:59` : dateRange.to
    q      = q.gte(col, dateRange.from).lte(col, to)
    intraQ = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
  }

  if (portion === 'seed') {
    q      = q.eq('stage_code_2', 'Specific Seed')
    intraQ = intraQ.eq('account_from_stage2', 'Specific Seed')
  } else if (portion === 'savings') {
    q      = q.eq('stage_code_2', 'Savings')
    intraQ = intraQ.eq('account_from_stage2', 'Savings')
  } else if (portion === 'percentage') {
    q = q
      .not('stage_code_2', 'eq', 'Specific Seed')
      .not('stage_code_2', 'eq', 'Savings')
    intraQ = intraQ.eq('account_from_stage2', 'Percentage Allocation')
  }
  // 'all' = no stage2 filter on either query

  const [{ data, error }, intraRes] = await Promise.all([q, intraQ])
  if (error) return { value: 0, error: error.message }
  const baseTotal = (data ?? []).reduce((sum, r) => {
    const amt = Number(r.amount_disbursed || 0)
    const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
    return sum + (isOffset ? -amt : amt)
  }, 0)
  const intraDebit = intraRes.error
    ? 0
    : (intraRes.data ?? []).reduce((sum, r) => sum + Number(r.total_amount), 0)
  return { value: baseTotal + intraDebit, error: null }
}

export async function getCategoryBalance(
  category:  string,
  dateRange?: DateRange,
  portion?:   BudgetPortion,
  dateField?: string,
): Promise<QueryResult> {
  const [inflows, outflows, opening] = await Promise.all([
    getCategoryInflows(category, dateRange, portion, dateField),
    getCategoryOutflows(category, dateRange, portion, dateField),
    getCategoryOpeningBalance(category, portion),
  ])
  if (inflows.error)  return inflows
  if (outflows.error) return outflows
  // opening balance errors are non-fatal (table may not exist in all deploys)
  const openingVal = opening.error ? 0 : opening.value
  return { value: openingVal + inflows.value - outflows.value, error: null }
}

export async function getNetMovement(dateRange?: DateRange, dateField?: string): Promise<QueryResult> {
  const col = dateField === 'recorded_at' ? 'recorded_at' : 'date'
  let inflowQ  = supabase
    .from('inflow_transactions')
    .select('amount, transaction_type, offset_role')
    .or('transaction_type.is.null,transaction_type.eq.fx_conversion')
  let outflowQ = supabase
    .from('outflow_transactions')
    .select('amount_disbursed, offset_role')
  if (dateRange) {
    const to = col === 'recorded_at' ? `${dateRange.to}T23:59:59` : dateRange.to
    inflowQ  = inflowQ.gte(col, dateRange.from).lte(col, to)
    outflowQ = outflowQ.gte(col, dateRange.from).lte(col, to)
  }
  const [inflowRes, outflowRes] = await Promise.all([inflowQ, outflowQ])
  if (inflowRes.error)  return { value: 0, error: inflowRes.error.message }
  if (outflowRes.error) return { value: 0, error: outflowRes.error.message }
  const totalIn = (inflowRes.data ?? []).reduce((s, r) => {
    if (isNonContributing(r)) return s
    return s + Number(r.amount)
  }, 0)
  const totalOut = (outflowRes.data ?? []).reduce((s, r) => {
    const amt      = Number(r.amount_disbursed || 0)
    const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
    return s + (isOffset ? -amt : amt)
  }, 0)
  return { value: totalIn - totalOut, error: null }
}

export interface TableRow {
  category:     string
  inflows:      number
  outflows:     number
  balance:      number
  inflowError:  string | null
  outflowError: string | null
}

export async function resolveTableBlock(
  categories: string[],
  dateRange?: DateRange,
  portion?: BudgetPortion,
  dateField?: string,
): Promise<TableRow[]> {
  return Promise.all(
    categories.filter(c => c.trim()).map(async category => {
      const [inf, out, opening] = await Promise.all([
        getCategoryInflows(category, dateRange, portion, dateField),
        getCategoryOutflows(category, dateRange, portion, dateField),
        getCategoryOpeningBalance(category, portion),
      ])
      const openingVal = opening.error ? 0 : opening.value
      return {
        category,
        inflows:      inf.value,
        outflows:     out.value,
        balance:      openingVal + inf.value - out.value,
        inflowError:  inf.error,
        outflowError: out.error,
      }
    }),
  )
}
