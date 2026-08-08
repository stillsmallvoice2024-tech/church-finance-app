// A multi-row INSERT is atomic — if any one row in the batch violates a
// constraint, Postgres rejects the whole statement and none of its rows land.
// Import batches 250 rows per request, so a single bad row (a stray dedup
// collision, an FK to a deleted allocation config, etc.) silently blocks up
// to 249 otherwise-valid rows — and with them, whatever fund breakdown those
// rows were configured with — until the user notices the failed-rows banner
// and clicks Retry.
//
// This isolates the failure instead of surfacing it as a whole-batch loss:
// on error, split the batch in half and retry each half, recursing down to
// the single offending row(s). Every good row in the original batch still
// gets inserted in the same run; only genuinely bad rows are reported.

export interface InsertResilientResult<T> {
  imported: number
  failed:   T[]
  errors:   string[]
  // Rows the database rejected as already present. The transaction-ref unique
  // indexes are the authority on duplicates; the import's dedup pre-check is
  // only a fast path, so a row can pass the pre-check and still land here when
  // a concurrent import (or a retry after a write timeout) got there first.
  // These are an expected, benign outcome — reported as skipped, not failed.
  duplicates: T[]
}

// Postgres unique_violation. Supabase surfaces it as `code`; the recursion also
// checks the message so a batch rejected through a path that drops the code
// (an RPC wrapper, an older client) is still classified correctly.
export function isDuplicateError(error: { message: string; code?: string } | null): boolean {
  if (!error) return false
  if (error.code === '23505') return true
  return /duplicate key value|already exists/i.test(error.message)
}

export async function insertBatchResilient<T>(
  // PromiseLike, not Promise: Supabase's query builder is a thenable that only
  // runs when awaited, and it lacks `catch`/`finally`, so it does not satisfy
  // `Promise`. Passing `rows => supabase.from(t).insert(rows)` directly is the
  // intended call shape, and awaiting is all this function does with it.
  insert: (rows: T[]) => PromiseLike<{ error: { message: string; code?: string } | null }>,
  rows: T[],
): Promise<InsertResilientResult<T>> {
  if (rows.length === 0) return { imported: 0, failed: [], errors: [], duplicates: [] }

  const { error } = await insert(rows)
  if (!error) return { imported: rows.length, failed: [], errors: [], duplicates: [] }

  // A whole-batch unique violation still has to be split: only the offending
  // rows are duplicates, the rest of the batch is good and must still land.
  if (rows.length === 1) {
    return isDuplicateError(error)
      ? { imported: 0, failed: [], errors: [], duplicates: rows }
      : { imported: 0, failed: rows, errors: [error.message], duplicates: [] }
  }

  const mid = Math.ceil(rows.length / 2)
  const [left, right] = await Promise.all([
    insertBatchResilient(insert, rows.slice(0, mid)),
    insertBatchResilient(insert, rows.slice(mid)),
  ])
  return {
    imported:   left.imported + right.imported,
    failed:     [...left.failed, ...right.failed],
    errors:     [...left.errors, ...right.errors],
    duplicates: [...left.duplicates, ...right.duplicates],
  }
}
