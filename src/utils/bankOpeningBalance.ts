import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export const BALANCE_BROUGHT_FORWARD_TYPE = 'balance_brought_forward'

const BF_DATE        = '1900-01-01'
const BF_DESCRIPTION = 'Balance Brought Forward'

/**
 * Upserts or removes the synthetic "Balance Brought Forward" inflow entry for a
 * bank. Called from AddBankModal after a successful bank save.
 *
 * Deduplication: keyed on bank_name + transaction_type = 'balance_brought_forward'.
 * If previousBankName differs from bankName (rename), the old entry is deleted first.
 */
export async function propagateBankOpeningBalance(
  bankName:          string,
  startingBalance:   number | null | undefined,
  previousBankName?: string,
): Promise<void> {
  const { user } = useAuthStore.getState()
  if (!user?.id) throw new Error('Not authenticated')

  // On bank rename: remove the entry filed under the old name
  if (previousBankName && previousBankName !== bankName) {
    await supabase
      .from('inflow_transactions')
      .delete()
      .eq('bank_name', previousBankName)
      .eq('transaction_type', BALANCE_BROUGHT_FORWARD_TYPE)
  }

  // Find any existing B/F entry for the current bank name
  const { data: existing } = await supabase
    .from('inflow_transactions')
    .select('id')
    .eq('bank_name', bankName)
    .eq('transaction_type', BALANCE_BROUGHT_FORWARD_TYPE)
    .maybeSingle()

  const balance = typeof startingBalance === 'number' ? startingBalance : 0

  if (balance <= 0) {
    // Opening balance cleared — remove the propagated entry
    if (existing?.id) {
      await supabase
        .from('inflow_transactions')
        .delete()
        .eq('id', existing.id)
    }
    return
  }

  if (existing?.id) {
    // Update amount only — preserve date, description, bank_name
    const { error } = await supabase
      .from('inflow_transactions')
      .update({ amount: balance })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    // Insert fresh entry at sentinel date so it always sorts first
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
