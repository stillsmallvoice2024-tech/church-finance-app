import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export const BALANCE_BROUGHT_FORWARD_TYPE = 'balance_brought_forward'
export const BF_DESCRIPTION = 'Balance Brought Forward'

// Sentinel date — sorts before any real transaction date.
// BankLedger always exempts B/F rows from date-range filtering so this value
// never causes display gaps regardless of the user's date picker state.
const BF_DATE = '1900-01-01'

/**
 * Upserts or removes the "Balance Brought Forward" audit record in
 * inflow_transactions.  BankLedger injects B/F synthetically from
 * bank.starting_balance, so this record exists for audit/export purposes
 * rather than for display.
 *
 * Deduplication key: bank_name + transaction_type = 'balance_brought_forward'.
 * Uses .limit(2) instead of .maybeSingle() so that existing duplicates
 * (from prior bugs) never cause PGRST116 errors — they are cleaned up inline.
 */
export async function propagateBankOpeningBalance(
  bankName:          string,
  startingBalance:   number | null | undefined,
  previousBankName?: string,
): Promise<void> {
  const { user } = useAuthStore.getState()
  if (!user?.id) throw new Error('Not authenticated')

  // On bank rename: purge the entry filed under the old name
  if (previousBankName && previousBankName !== bankName) {
    await supabase
      .from('inflow_transactions')
      .delete()
      .eq('bank_name', previousBankName)
      .eq('transaction_type', BALANCE_BROUGHT_FORWARD_TYPE)
  }

  // Fetch at most 2 rows — enough to detect duplicates without a full scan
  const { data: rows, error: selectErr } = await supabase
    .from('inflow_transactions')
    .select('id')
    .eq('bank_name', bankName)
    .eq('transaction_type', BALANCE_BROUGHT_FORWARD_TYPE)
    .limit(2)

  if (selectErr) throw selectErr

  // Inline cleanup: if duplicates exist, delete all but the first
  if (rows && rows.length > 1) {
    const { error: cleanErr } = await supabase
      .from('inflow_transactions')
      .delete()
      .in('id', rows.slice(1).map(r => r.id))
    if (cleanErr) console.warn('[bankOpeningBalance] duplicate cleanup failed:', cleanErr.message)
  }

  const existing = rows?.[0] ?? null
  const balance  = typeof startingBalance === 'number' ? startingBalance : 0

  if (balance <= 0) {
    if (existing?.id) {
      const { error } = await supabase
        .from('inflow_transactions')
        .delete()
        .eq('id', existing.id)
      if (error) throw error
    }
    return
  }

  if (existing?.id) {
    const { error } = await supabase
      .from('inflow_transactions')
      .update({ amount: balance })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('inflow_transactions')
      .insert({
        date:             BF_DATE,
        amount:           balance,
        description:      BF_DESCRIPTION,
        bank_name:        bankName,
        transaction_type: BALANCE_BROUGHT_FORWARD_TYPE,
        created_by:       user.id,
      })
    if (error) throw error
  }
}
