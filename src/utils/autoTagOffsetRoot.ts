import type { RootTxnLink } from '../components/ui/RootTransactionSearch'
import type { MutationHook, UpdateTransactionInput } from '../hooks/useMutations'

type UpdateFn = MutationHook<UpdateTransactionInput>['mutate']

// Types for which linking an offset to a root auto-promotes the root.
// Scoped explicitly — not every offsetable type (e.g. refund, bank_deposit)
// has this behavior, only the ones it's been asked for.
const AUTO_TAG_ROOT_TYPES = new Set(['reversal', 'intrabank_transfer'])

// When an offset row is linked to a root transaction, the root is
// auto-promoted to offset_role='root' + transaction_type=<the offset's own
// type> so it groups correctly on that type's page (Reversals, Intrabank
// Transfers) without the user editing the root by hand. Best-effort — call
// sites must not let a failure here block the offset row, which has already
// saved successfully by the time this runs.
export async function autoTagOffsetRoot(
  transactionType: string | null | undefined,
  offsetRole:       string | null | undefined,
  rootTxnLink:      RootTxnLink | null,
  updateInflow:     UpdateFn,
  updateOutflow:    UpdateFn,
): Promise<void> {
  if (!transactionType || !AUTO_TAG_ROOT_TYPES.has(transactionType) || offsetRole !== 'offset' || !rootTxnLink) return
  const updater = rootTxnLink.table === 'inflow_transactions' ? updateInflow : updateOutflow
  await updater({ id: rootTxnLink.id, updates: { offset_role: 'root', transaction_type: transactionType } })
}
