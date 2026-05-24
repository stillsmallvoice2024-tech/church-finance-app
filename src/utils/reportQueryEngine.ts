import { supabase } from '../lib/supabase'

export interface DateRange {
  from: string
  to: string
}

export interface QueryResult {
  value: number
  error: string | null
}

export async function getCategoryInflows(
  category: string,
  dateRange?: DateRange,
): Promise<QueryResult> {
  let q = supabase
    .from('inflow_transactions')
    .select('amount')
    .eq('stage_code_1', category)
  if (dateRange) {
    q = q.gte('date', dateRange.from).lte('date', dateRange.to)
  }
  const { data, error } = await q
  if (error) return { value: 0, error: error.message }
  return {
    value: (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0),
    error: null,
  }
}

export async function getCategoryOutflows(
  category: string,
  dateRange?: DateRange,
): Promise<QueryResult> {
  let q = supabase
    .from('outflow_transactions')
    .select('actual_amount, amount_disbursed')
    .eq('stage_code_1', category)
  if (dateRange) {
    q = q.gte('date', dateRange.from).lte('date', dateRange.to)
  }
  const { data, error } = await q
  if (error) return { value: 0, error: error.message }
  return {
    value: (data ?? []).reduce(
      (sum, r) => sum + Number(r.actual_amount || r.amount_disbursed || 0),
      0,
    ),
    error: null,
  }
}

export async function getCategoryBalance(
  category: string,
  dateRange?: DateRange,
): Promise<QueryResult> {
  const [inflows, outflows] = await Promise.all([
    getCategoryInflows(category, dateRange),
    getCategoryOutflows(category, dateRange),
  ])
  if (inflows.error) return inflows
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
): Promise<TableRow[]> {
  return Promise.all(
    categories.filter(c => c.trim()).map(async category => {
      const [inf, out] = await Promise.all([
        getCategoryInflows(category, dateRange),
        getCategoryOutflows(category, dateRange),
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
