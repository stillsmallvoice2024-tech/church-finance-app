import { supabase } from '../lib/supabase'
import { normalizeId } from './normalizeId'
import { chunkIds } from './chunkIds'
import { mapWithConcurrency } from './mapWithConcurrency'
import { rowFingerprint } from './refOccurrence'

// Chunks are fetched concurrently but capped — a 50k-row import chunked at
// 100 IDs/request is ~500 chunks per side, and firing all of them at once
// via a single Promise.all hits browser per-host connection limits and
// Supabase rate limits well before it hits anything server-side.
const DEDUP_QUERY_CONCURRENCY = 10

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

  const results = await mapWithConcurrency(chunkIds(unique), DEDUP_QUERY_CONCURRENCY, chunk => {
    const base = supabase.from(table).select(column).eq('org_id', orgId).in(column, chunk)
    return bankName ? base.eq('bank_name', bankName) : base
  })

  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
      const id = normalizeId(row[column] ?? '')
      if (id) existing.add(id)
    }
  }
  return existing
}

/**
 * Fetch how many rows already in the database match each full row identity —
 * reference + date + amount + description — for the given references.
 *
 * The reference alone is not identity. A bank reuses one Session ID across a
 * transfer, the fee on it and the VAT on that fee, so matching on the reference
 * marks the fee as a duplicate of the transfer and silently drops a real
 * transaction — the bug this replaces. It is also why the count matters rather
 * than mere presence: a statement can legitimately carry the same row twice (a
 * failed transfer, reversed and retried), and the import must skip exactly as
 * many as the database already holds, not all of them.
 *
 * Chunked like fetchExistingTransactionIds, and errors are THROWN for the same
 * reason — a failed check must never report everything as new.
 */
export async function fetchExistingRowCounts(
  table: 'inflow_transactions' | 'outflow_transactions' | 'fx_transactions',
  refColumn: 'transaction_ref' | 'transaction_id',
  amountColumn: 'amount' | 'amount_disbursed',
  descColumn: 'description' | 'narration',
  ids: string[],
  bankName: string | null,
  orgId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return counts

  const cols = `${refColumn}, date, ${amountColumn}, ${descColumn}`
  const results = await mapWithConcurrency(chunkIds(unique), DEDUP_QUERY_CONCURRENCY, chunk => {
    const base = supabase.from(table).select(cols).eq('org_id', orgId).in(refColumn, chunk)
    return bankName ? base.eq('bank_name', bankName) : base
  })

  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const fp = rowFingerprint(
        String(row[refColumn] ?? ''),
        String(row.date ?? ''),
        Number(row[amountColumn] ?? 0),
        (row[descColumn] as string | null) ?? '',
      )
      counts.set(fp, (counts.get(fp) ?? 0) + 1)
    }
  }
  return counts
}
