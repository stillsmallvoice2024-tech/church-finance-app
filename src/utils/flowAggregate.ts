// Shared aggregation for the Inflows / Outflows "Simple" view summaries.
//
// Both pages mirror the dashboard's **directional flipping** of same-table
// offsets: an offset whose root lives in the SAME table is money moving the
// other way, so it is counted on the opposite page instead of being dropped.
// A refund that reverses an outflow is cash the church actually received —
// the user experienced it as an inflow, so it belongs in the Inflows
// headline (and vice-versa). Flipping keeps root + offset netting to zero
// while both amounts stay visible.
//
// Flipped rows come from the other table and carry no income/outflow type, so
// they aggregate under the `null` ("Unclassified") type slice; without them
// the type breakdown percentages would not sum to the headline total.

export interface OffsetFields {
  offset_role: string | null
  root_transaction_table: string | null
}

export type FlowTable = 'inflow_transactions' | 'outflow_transactions'

/** True when this row is an offset whose root lives in `table` (its own table). */
export const isSameTableOffset = (r: OffsetFields, table: FlowTable): boolean =>
  r.offset_role === 'offset' && r.root_transaction_table === table

export interface FlowRow {
  date: string          // 'YYYY-MM-DD'
  amount: number
  typeId: string | null // income_type_id / outflow_type_id; null for flipped rows
}

export interface FlowAggregate {
  monthly: { month: string; amount: number }[]  // month = 'YYYY-MM', ascending
  byType:  { typeId: string | null; amount: number }[]  // descending by amount
  total:   number
  count:   number
}

export function aggregateFlow(rows: FlowRow[]): FlowAggregate {
  const monthMap = new Map<string, number>()
  const typeMap  = new Map<string | null, number>()
  let total = 0

  for (const r of rows) {
    const amt   = Number(r.amount)
    const month = r.date.slice(0, 7)
    total += amt
    monthMap.set(month, (monthMap.get(month) ?? 0) + amt)
    typeMap.set(r.typeId, (typeMap.get(r.typeId) ?? 0) + amt)
  }

  return {
    monthly: Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount })),
    byType: Array.from(typeMap.entries())
      .map(([typeId, amount]) => ({ typeId, amount }))
      .sort((a, b) => b.amount - a.amount),
    total,
    count: rows.length,
  }
}
