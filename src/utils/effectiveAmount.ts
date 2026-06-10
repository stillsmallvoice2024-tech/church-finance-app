// Computes the effective financial contribution of a root transaction after
// applying all directly-linked offset transactions.
//
// Offset transactions contribute 0 to balances independently — their amounts
// are only counted here, against the root. No chaining: all offsets must point
// directly to the same root (root_transaction_id = root.id).
//
// Usage:
//   const effective = computeEffectiveTransactionAmount(root.amount, offsets)
//   // For a full reversal: root.amount = 1000, offset.amount = -1000 → effective = 0
//   // For a partial refund: root.amount = 1000, offset.amount = -400  → effective = 600
export function computeEffectiveTransactionAmount(
  rootAmount: number,
  offsets: { amount: number }[],
): number {
  return rootAmount + offsets.reduce((sum, o) => sum + o.amount, 0)
}

// Convenience type guard — true when the row is an offset (non-contributing).
export function isOffsetTransaction(tx: { offset_role?: string | null }): boolean {
  return tx.offset_role === 'offset'
}
