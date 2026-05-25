import { supabase } from '../lib/supabase'

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

const STAGE_CODE_MAP: Record<string, string> = {
  seed:       'Specific Seed',
  savings:    'Savings',
  percentage: 'Percentage Allocation',
}

// Find the locked non-special allocation config covering a given date
function findConfigForDate(
  configs: Array<{
    id: string
    rows: unknown
    start_date?: string | null
    end_date?: string | null
    effective_from?: string | null
    effective_to?: string | null
  }>,
  date: string,
) {
  const matching = configs.filter(c => {
    const from = c.effective_from ?? c.start_date
    const to   = c.effective_to   ?? c.end_date
    if (from && date < from) return false
    if (to   && date > to)   return false
    return true
  })
  return matching.sort((a, b) => {
    const af = a.effective_from ?? a.start_date ?? ''
    const bf = b.effective_from ?? b.start_date ?? ''
    return bf.localeCompare(af)
  })[0] ?? null
}

// Percentage-allocation inflows require fetching configs and computing the split
async function getCategoryPercentageInflows(
  category: string,
  dateRange?: DateRange,
): Promise<QueryResult> {
  let inflowQ = supabase
    .from('inflow_transactions')
    .select('amount, allocation_config_id, date, transaction_type, stage_code_2')
    .is('transaction_type', null) // exclude reversals, refunds, bank deposits

  let intraQ = supabase
    .from('intra_flows')
    .select('total_amount')
    .eq('account_to', category)
    .eq('account_to_stage2', 'Percentage Allocation')
    .eq('status', 'active')

  if (dateRange) {
    inflowQ = inflowQ.gte('date', dateRange.from).lte('date', dateRange.to)
    intraQ  = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
  }

  const [inflowRes, configRes, intraRes] = await Promise.all([
    inflowQ,
    supabase
      .from('allocation_configs')
      .select('id, rows, start_date, end_date, effective_from, effective_to')
      .eq('status', 'locked')
      .eq('is_special', false),
    intraQ,
  ])

  if (inflowRes.error)  return { value: 0, error: inflowRes.error.message }
  if (configRes.error)  return { value: 0, error: configRes.error.message }

  const configs = configRes.data ?? []
  let total = 0

  for (const inflow of inflowRes.data ?? []) {
    const s2 = inflow.stage_code_2 as string | null
    // Skip seed/savings — they are direct allocations, not percentage
    if (s2 === 'Specific Seed' || s2 === 'Savings') continue

    const cfgId = inflow.allocation_config_id as string | null
    const cfg   = cfgId
      ? configs.find(c => c.id === cfgId) ?? findConfigForDate(configs, inflow.date as string)
      : findConfigForDate(configs, inflow.date as string)
    if (!cfg) continue

    const rows = Array.isArray(cfg.rows) ? cfg.rows : []
    const catRow = (rows as Array<Record<string, unknown>>).find(
      r => r.category_name === category && r.budget_portion === 'Percentage Allocation',
    )
    if (!catRow?.percentage) continue
    total += Number(inflow.amount) * (Number(catRow.percentage) / 100)
  }

  // Direct intra-flow credits to this category's percentage portion
  if (!intraRes.error) {
    for (const r of intraRes.data ?? []) {
      total += Number(r.total_amount)
    }
  }

  return { value: total, error: null }
}

export async function getCategoryInflows(
  category: string,
  dateRange?: DateRange,
  portion?: BudgetPortion,
): Promise<QueryResult> {
  if (portion === 'percentage') {
    return getCategoryPercentageInflows(category, dateRange)
  }

  let q = supabase
    .from('inflow_transactions')
    .select('amount')
    .eq('stage_code_1', category)

  let intraQ = supabase
    .from('intra_flows')
    .select('total_amount')
    .eq('account_to', category)
    .eq('status', 'active')

  if (dateRange) {
    q      = q.gte('date', dateRange.from).lte('date', dateRange.to)
    intraQ = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
  }
  if (portion && portion !== 'all') {
    q      = q.eq('stage_code_2', STAGE_CODE_MAP[portion])
    intraQ = intraQ.eq('account_to_stage2', STAGE_CODE_MAP[portion])
  }

  const [{ data, error }, intraRes] = await Promise.all([q, intraQ])
  if (error) return { value: 0, error: error.message }
  const baseTotal   = (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
  const intraCredit = intraRes.error ? 0 : (intraRes.data ?? []).reduce((sum, r) => sum + Number(r.total_amount), 0)
  return { value: baseTotal + intraCredit, error: null }
}

export async function getCategoryOutflows(
  category: string,
  dateRange?: DateRange,
  portion?: BudgetPortion,
): Promise<QueryResult> {
  let q = supabase
    .from('outflow_transactions')
    .select('actual_amount, amount_disbursed')
    .eq('stage_code_1', category)

  let intraQ = supabase
    .from('intra_flows')
    .select('total_amount')
    .eq('account_from', category)
    .eq('status', 'active')

  if (dateRange) {
    q      = q.gte('date', dateRange.from).lte('date', dateRange.to)
    intraQ = intraQ.gte('date', dateRange.from).lte('date', dateRange.to)
  }

  if (portion === 'seed') {
    q      = q.eq('stage_code_2', 'Specific Seed')
    intraQ = intraQ.eq('account_from_stage2', 'Specific Seed')
  } else if (portion === 'savings') {
    q      = q.eq('stage_code_2', 'Savings')
    intraQ = intraQ.eq('account_from_stage2', 'Savings')
  } else if (portion === 'percentage') {
    // Percentage-allocated outflows: not seed, not savings
    q = q
      .not('stage_code_2', 'eq', 'Specific Seed')
      .not('stage_code_2', 'eq', 'Savings')
    intraQ = intraQ.eq('account_from_stage2', 'Percentage Allocation')
  }
  // 'all' = no stage2 filter on either query

  const [{ data, error }, intraRes] = await Promise.all([q, intraQ])
  if (error) return { value: 0, error: error.message }
  const baseTotal  = (data ?? []).reduce(
    (sum, r) => sum + Number(r.actual_amount || r.amount_disbursed || 0),
    0,
  )
  const intraDebit = intraRes.error ? 0 : (intraRes.data ?? []).reduce((sum, r) => sum + Number(r.total_amount), 0)
  return { value: baseTotal + intraDebit, error: null }
}

export async function getCategoryBalance(
  category: string,
  dateRange?: DateRange,
  portion?: BudgetPortion,
): Promise<QueryResult> {
  const [inflows, outflows] = await Promise.all([
    getCategoryInflows(category, dateRange, portion),
    getCategoryOutflows(category, dateRange, portion),
  ])
  if (inflows.error)  return inflows
  if (outflows.error) return outflows
  return { value: inflows.value - outflows.value, error: null }
}

export async function getNetMovement(dateRange?: DateRange): Promise<QueryResult> {
  let inflowQ  = supabase.from('inflow_transactions').select('amount')
  let outflowQ = supabase.from('outflow_transactions').select('actual_amount, amount_disbursed')
  if (dateRange) {
    inflowQ  = inflowQ.gte('date', dateRange.from).lte('date', dateRange.to)
    outflowQ = outflowQ.gte('date', dateRange.from).lte('date', dateRange.to)
  }
  const [inflowRes, outflowRes] = await Promise.all([inflowQ, outflowQ])
  if (inflowRes.error)  return { value: 0, error: inflowRes.error.message }
  if (outflowRes.error) return { value: 0, error: outflowRes.error.message }
  const totalIn  = (inflowRes.data  ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const totalOut = (outflowRes.data ?? []).reduce(
    (s, r) => s + Number(r.actual_amount || r.amount_disbursed || 0),
    0,
  )
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
): Promise<TableRow[]> {
  return Promise.all(
    categories.filter(c => c.trim()).map(async category => {
      const [inf, out] = await Promise.all([
        getCategoryInflows(category, dateRange, portion),
        getCategoryOutflows(category, dateRange, portion),
      ])
      return {
        category,
        inflows:      inf.value,
        outflows:     out.value,
        balance:      inf.value - out.value,
        inflowError:  inf.error,
        outflowError: out.error,
      }
    }),
  )
}
