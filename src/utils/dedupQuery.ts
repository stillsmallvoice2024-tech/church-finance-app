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
  amountColumn: 'amount' | 'amount_disbursed' | 'deposit',
  descColumn: 'description' | 'narration',
  ids: string[],
  bankName: string | null,
  orgId: string,
  // fx_transactions splits its amount across deposit and withdrawal. Pass
  // 'withdrawal' here so the fingerprint matches the one the import builds,
  // which uses whichever of the two is non-zero.
  amountColumn2?: 'withdrawal',
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return counts

  const cols = [refColumn, 'date', amountColumn, amountColumn2, descColumn]
    .filter(Boolean).join(', ')
  const results = await mapWithConcurrency(chunkIds(unique), DEDUP_QUERY_CONCURRENCY, chunk => {
    const base = supabase.from(table).select(cols).eq('org_id', orgId).in(refColumn, chunk)
    return bankName ? base.eq('bank_name', bankName) : base
  })

  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const amount = Number(row[amountColumn] ?? 0)
        || Number(amountColumn2 ? row[amountColumn2] ?? 0 : 0)
      const fp = rowFingerprint(
        String(row[refColumn] ?? ''),
        String(row.date ?? ''),
        amount,
        (row[descColumn] as string | null) ?? '',
      )
      counts.set(fp, (counts.get(fp) ?? 0) + 1)
    }
  }
  return counts
}

export interface ExistingRefRow {
  id:              string
  ref:             string
  amount:          number
  transaction_type: string | null
  date:            string
  created_at:      string
}

/**
 * Fetch stored rows matching any of the given references, regardless of
 * amount, date or description — used to find a reversal's original when it
 * was imported in an earlier statement. Unlike fetchExistingRowCounts (exact
 * row-identity match, for dedup) this is deliberately loose: a reversal's
 * date and description differ from its original's, only the reference and
 * (up to sign) the amount match.
 */
export async function fetchRowsByRef(
  table: 'inflow_transactions' | 'outflow_transactions',
  refColumn: 'transaction_ref' | 'transaction_id',
  amountColumn: 'amount' | 'amount_disbursed',
  refs: string[],
  bankName: string | null,
  orgId: string,
): Promise<ExistingRefRow[]> {
  const unique = [...new Set(refs)].filter(Boolean)
  if (unique.length === 0) return []

  const cols = `id, ${refColumn}, ${amountColumn}, transaction_type, date, created_at`
  const results = await mapWithConcurrency(chunkIds(unique), DEDUP_QUERY_CONCURRENCY, chunk => {
    const base = supabase.from(table).select(cols).eq('org_id', orgId).in(refColumn, chunk)
    return bankName ? base.eq('bank_name', bankName) : base
  })

  const out: ExistingRefRow[] = []
  for (const { data, error } of results) {
    if (error) throw error
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.push({
        id:               String(row.id),
        ref:              normalizeId(String(row[refColumn] ?? '')),
        amount:           Number(row[amountColumn] ?? 0),
        transaction_type: (row.transaction_type as string | null) ?? null,
        date:             String(row.date ?? ''),
        created_at:       String(row.created_at ?? ''),
      })
    }
  }
  return out
}
