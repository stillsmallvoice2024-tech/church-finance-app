import { supabase } from '../lib/supabase'
import { normalizeId } from './normalizeId'
import { chunkIds } from './chunkIds'

/**
 * Fetch which of the given transaction IDs already exist in the database,
 * scoped to the active org and to `bank_name` when provided.
 *
 * The org filter is required: RLS permits every org the user belongs to, so
 * without it a ref that exists in another org marks the row as a duplicate
 * here and the import silently skips a legitimate transaction.
 *
 * IDs are queried in chunks so the PostgREST `.in()` query string never
 * exceeds URL limits, and any query error is THROWN — never swallowed —
 * so a failed duplicate check can't silently report everything as new.
 */
export async function fetchExistingTransactionIds(
  table: 'inflow_transactions' | 'outflow_transactions',
  column: 'transaction_ref' | 'transaction_id',
  ids: string[],
  bankName: string | null,
  orgId: string,
): Promise<Set<string>> {
  const existing = new Set<string>()
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return existing

  const results = await Promise.all(
    chunkIds(unique).map(chunk => {
      const base = supabase.from(table).select(column).eq('org_id', orgId).in(column, chunk)
      return bankName ? base.eq('bank_name', bankName) : base
    }),
  )

  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
      const id = normalizeId(row[column] ?? '')
      if (id) existing.add(id)
    }
  }
  return existing
}
