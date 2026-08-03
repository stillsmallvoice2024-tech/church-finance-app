import type { RootTxnLink } from '../components/ui/RootTransactionSearch'
import type { MutationHook, UpdateTransactionInput } from '../hooks/useMutations'

type UpdateFn = MutationHook<UpdateTransactionInput>['mutate']

// For reversals ONLY: when an offset row is linked to a root transaction, the
// root is auto-promoted to offset_role='root' + transaction_type='reversal' so
// it groups correctly on the Reversals page without the user editing the root
// by hand. Best-effort — call sites must not let a failure here block the
// offset row, which has already saved successfully by the time this runs.
export async function autoTagReversalRoot(
  transactionType: string | null | undefined,
  offsetRole:       string | null | undefined,
  rootTxnLink:      RootTxnLink | null,
  updateInflow:     UpdateFn,
  updateOutflow:    UpdateFn,
): Promise<void> {
  if (transactionType !== 'reversal' || offsetRole !== 'offset' || !rootTxnLink) return
  const updater = rootTxnLink.table === 'inflow_transactions' ? updateInflow : updateOutflow
  await updater({ id: rootTxnLink.id, updates: { offset_role: 'root', transaction_type: 'reversal' } })
}
