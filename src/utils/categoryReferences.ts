import { supabase } from '../lib/supabase'

/**
 * Category/fund linkage is by NAME, not by foreign key.
 *
 * `inflow_transactions.stage_code_1`, `outflow_transactions.stage_code_1`,
 * `intra_flows.account_from/account_to` and `allocation_configs.rows[].category_name`
 * all store the category name as plain text. A rename therefore detaches every
 * historical row from its fund, and a delete leaves money summed under a name that
 * no longer appears in any dropdown.
 *
 * These helpers keep the text keys consistent: count references before deleting,
 * cascade the new name to every referencing row after renaming.
 */

export interface CategoryReferenceCounts {
  inflows:           number
  outflows:          number
  openingBalances:   number
  intraFlows:        number
  allocationConfigs: number
  total:             number
}

const zero: CategoryReferenceCounts = {
  inflows: 0, outflows: 0, openingBalances: 0, intraFlows: 0, allocationConfigs: 0, total: 0,
}

/** Tables missing in older databases must not block the check. */
function countOf(res: { count: number | null; error: { message: string } | null }): number {
  if (res.error) {
    if (/does not exist/i.test(res.error.message)) return 0
    throw new Error(res.error.message)
  }
  return res.count ?? 0
}

interface ConfigRow { category_name?: string | null; [k: string]: unknown }

async function fetchConfigsReferencing(orgId: string, name: string):
  Promise<Array<{ id: string; rows: ConfigRow[] }>> {
  const { data, error } = await supabase
    .from('allocation_configs')
    .select('id, rows')
    .eq('org_id', orgId)
  if (error) {
    if (/does not exist/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? [])
    .map(c => ({ id: c.id as string, rows: (Array.isArray(c.rows) ? c.rows : []) as ConfigRow[] }))
    .filter(c => c.rows.some(r => r.category_name === name))
}

/** Counts every row that would be orphaned by deleting this category. */
export async function countCategoryReferences(
  orgId: string,
  categoryId: string,
  name: string,
): Promise<CategoryReferenceCounts> {
  if (!orgId || !name) return zero

  const head = { count: 'exact' as const, head: true }
  const [inf, out, cob, intraFrom, intraTo, configs] = await Promise.all([
    supabase.from('inflow_transactions').select('id', head).eq('org_id', orgId).eq('stage_code_1', name),
    supabase.from('outflow_transactions').select('id', head).eq('org_id', orgId).eq('stage_code_1', name),
    supabase.from('category_opening_balances').select('id', head).eq('org_id', orgId).eq('category_id', categoryId),
    supabase.from('intra_flows').select('id', head).eq('org_id', orgId).eq('account_from', name),
    supabase.from('intra_flows').select('id', head).eq('org_id', orgId).eq('account_to', name),
    fetchConfigsReferencing(orgId, name),
  ])

  const counts: CategoryReferenceCounts = {
    inflows:           countOf(inf),
    outflows:          countOf(out),
    openingBalances:   countOf(cob),
    intraFlows:        countOf(intraFrom) + countOf(intraTo),
    allocationConfigs: configs.length,
    total:             0,
  }
  counts.total = counts.inflows + counts.outflows + counts.openingBalances
    + counts.intraFlows + counts.allocationConfigs
  return counts
}

/** Human-readable list of what still points at the category, for error messages. */
export function describeCategoryReferences(c: CategoryReferenceCounts): string {
  const parts: string[] = []
  if (c.inflows)           parts.push(`${c.inflows} inflow${c.inflows === 1 ? '' : 's'}`)
  if (c.outflows)          parts.push(`${c.outflows} outflow${c.outflows === 1 ? '' : 's'}`)
  if (c.intraFlows)        parts.push(`${c.intraFlows} internal transfer${c.intraFlows === 1 ? '' : 's'}`)
  if (c.openingBalances)   parts.push(`${c.openingBalances} opening balance${c.openingBalances === 1 ? '' : 's'}`)
  if (c.allocationConfigs) parts.push(`${c.allocationConfigs} allocation config${c.allocationConfigs === 1 ? '' : 's'}`)
  return parts.join(', ')
}

export interface RenameCascadeResult {
  inflows:           number
  outflows:          number
  intraFlows:        number
  allocationConfigs: number
}

/**
 * Repoints every text reference from `oldName` to `newName`.
 * Runs after the `categories` row itself has been updated; a partial failure
 * throws so the caller can surface it (the rename is not silently half-applied).
 */
export async function cascadeCategoryRename(
  orgId: string,
  oldName: string,
  newName: string,
): Promise<RenameCascadeResult> {
  const result: RenameCascadeResult = { inflows: 0, outflows: 0, intraFlows: 0, allocationConfigs: 0 }
  if (!orgId || !oldName || oldName === newName) return result

  const updateStage = async (table: 'inflow_transactions' | 'outflow_transactions') => {
    const { data, error } = await supabase
      .from(table)
      .update({ stage_code_1: newName })
      .eq('org_id', orgId)
      .eq('stage_code_1', oldName)
      .select('id')
    if (error) throw new Error(error.message)
    return data?.length ?? 0
  }

  const updateIntra = async (col: 'account_from' | 'account_to') => {
    const { data, error } = await supabase
      .from('intra_flows')
      .update({ [col]: newName })
      .eq('org_id', orgId)
      .eq(col, oldName)
      .select('id')
    if (error) {
      if (/does not exist/i.test(error.message)) return 0
      throw new Error(error.message)
    }
    return data?.length ?? 0
  }

  result.inflows  = await updateStage('inflow_transactions')
  result.outflows = await updateStage('outflow_transactions')
  result.intraFlows = (await updateIntra('account_from')) + (await updateIntra('account_to'))

  // allocation_configs.rows is jsonb — rewrite each affected config's array.
  const configs = await fetchConfigsReferencing(orgId, oldName)
  for (const cfg of configs) {
    const rows = cfg.rows.map(r => (r.category_name === oldName ? { ...r, category_name: newName } : r))
    const { error } = await supabase.from('allocation_configs').update({ rows }).eq('id', cfg.id)
    if (error) throw new Error(error.message)
    result.allocationConfigs++
  }

  return result
}
