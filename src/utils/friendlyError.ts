// Translates raw Supabase/Postgres/network errors into plain, actionable
// language for end users. The raw message is logged to the console for
// debugging — it is never shown in a toast.

const FALLBACK = "Couldn't complete that. Check your connection and try again."

export function friendlyError(err: unknown, action?: string): string {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : err instanceof Error
        ? err.message
        : String(err ?? '')

  if (raw) console.error('[error]', raw)

  const prefix = action ? `Couldn't ${action}. ` : "Couldn't complete that. "
  const m = raw.toLowerCase()

  // AbortError covers both our own request timeout and a cancelled navigation.
  if (m.includes('took longer than') || m.includes('aborterror') || m.includes('signal is aborted') || m.includes('lock_not_available') || m.includes('canceling statement'))
    return `${prefix}The server took too long to respond. Reload the page to check whether it saved before trying again.`
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('timeout'))
    return `${prefix}Check your connection and try again.`
  if (m.includes('row-level security') || m.includes('permission denied') || m.includes('not authorized'))
    return `${prefix}You don't have permission for this action.`
  if (m.includes('jwt') || m.includes('not authenticated') || m.includes('invalid claim'))
    return `${prefix}Your session expired — please sign in again.`
  // Named before the generic duplicate-key branch so the transaction-reference
  // indexes explain themselves — "a record with this name already exists" is
  // meaningless when the collision is on a reference the user just typed.
  if (m.includes('_org_bank_ref_unique'))
    return `${prefix}A transaction with this reference already exists for this bank. ` +
           `Check the ledger — this transaction may already have been recorded.`
  if (m.includes('banks_org_name_unique'))
    return `${prefix}A bank account with this name already exists. ` +
           `Add something that tells them apart, like the account type or the last four digits.`
  if (m.includes('duplicate key') || m.includes('already exists'))
    return `${prefix}A record with this name already exists.`
  if (m.includes('foreign key') || m.includes('violates'))
    return `${prefix}This record is still linked to other data.`
  if (m.includes('no rows') || m.includes('0 rows'))
    return `${prefix}The record could not be found — it may have been removed.`

  return action ? `${prefix}Please try again.` : FALLBACK
}

export { FALLBACK as FRIENDLY_ERROR_FALLBACK }
