export type OffsetRole = 'root' | 'offset'

export type OffsetLinkType =
  | 'reversal'
  | 'refund'
  | 'bank_deposit'
  | 'intra_bank_transfer'

// Transaction types that carry no allocatable income and must be excluded from
// category balances, allocation engines, and financial reports.
// fx_conversion is intentionally absent — converted naira IS allocatable income.
export const NON_ALLOCATABLE_TYPES = new Set([
  'balance_brought_forward',
  'reversal',
  'refund',
  'bank_deposit',
  'intrabank_transfer',
])

// Returns true when a transaction row must be excluded from balances/reports.
// Checks both legacy transaction_type exclusion and new offset_role exclusion.
// offset_role = 'offset' rows always contribute 0 — their financial effect is
// already captured on the root transaction via computeEffectiveTransactionAmount.
// Safe on unmigrated DBs: when offset_role column is absent the field is
// undefined, which !== 'offset', so no rows are incorrectly excluded.
export function isNonContributing(tx: {
  transaction_type?: string | null
  offset_role?: string | null
}): boolean {
  if (tx.offset_role === 'offset') return true
  if (tx.transaction_type && NON_ALLOCATABLE_TYPES.has(tx.transaction_type)) return true
  return false
}
