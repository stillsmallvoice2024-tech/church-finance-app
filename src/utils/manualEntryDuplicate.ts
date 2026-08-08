import { fetchExistingRowCounts } from './dedupQuery'
import { rowFingerprint } from './refOccurrence'

/**
 * How many transactions the database already holds that are identical to the
 * one being entered by hand — same reference, date, amount, description and
 * bank.
 *
 * When the Transaction Ref field is left blank the modals derive one by hashing
 * date + amount + description + bank, so two genuinely separate gifts of the
 * same amount, on the same day, with the same description hash to the same
 * reference. That used to be refused outright ("a transaction with this ref
 * already exists"), which made a real second entry impossible to record — two
 * members each giving ₦5,000 on one Sunday is ordinary, not a mistake.
 *
 * Nothing on the form can separate those two entries, so the count is not used
 * to reject. It is used to ask: the modal confirms with the user, and on
 * confirmation stores the new row at `ref_occurrence = count`, which is what
 * lets it coexist with the rows already there instead of colliding with them.
 *
 * A count of 0 means the entry is new and saves without a prompt, so the
 * accidental-double-submit guard the old check provided is kept.
 */
export async function countIdenticalManualEntries(opts: {
  table:        'inflow_transactions' | 'outflow_transactions' | 'fx_transactions'
  refColumn:    'transaction_ref' | 'transaction_id'
  amountColumn: 'amount' | 'amount_disbursed' | 'deposit'
  /** fx_transactions only: the other half of its split amount. */
  amountColumn2?: 'withdrawal'
  descColumn:   'description' | 'narration'
  orgId:        string
  bankName:     string | null
  ref:          string
  date:         string
  amount:       number
  description:  string | null
}): Promise<number> {
  const counts = await fetchExistingRowCounts(
    opts.table, opts.refColumn, opts.amountColumn, opts.descColumn,
    [opts.ref], opts.bankName, opts.orgId, opts.amountColumn2,
  )
  return counts.get(rowFingerprint(opts.ref, opts.date, opts.amount, opts.description)) ?? 0
}
