import { supabase } from '../lib/supabase'
import { normalizeId } from './normalizeId'
import { chunkIds } from './chunkIds'

/**
 * Fetch which of the given transaction IDs already exist in the database,
 * scoped to `bank_name` when provided.
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
): Promise<Set<string>> {
  const existing = new Set<string>()
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return existing

  const results = await Promise.all(
    chunkIds(unique).map(chunk => {
      const base = supabase.from(table).select(column).in(column, chunk)
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
