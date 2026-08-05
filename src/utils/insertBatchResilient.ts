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
}

export async function insertBatchResilient<T>(
  // PromiseLike, not Promise: Supabase's query builder is a thenable that only
  // runs when awaited, and it lacks `catch`/`finally`, so it does not satisfy
  // `Promise`. Passing `rows => supabase.from(t).insert(rows)` directly is the
  // intended call shape, and awaiting is all this function does with it.
  insert: (rows: T[]) => PromiseLike<{ error: { message: string } | null }>,
  rows: T[],
): Promise<InsertResilientResult<T>> {
  if (rows.length === 0) return { imported: 0, failed: [], errors: [] }

  const { error } = await insert(rows)
  if (!error) return { imported: rows.length, failed: [], errors: [] }

  if (rows.length === 1) return { imported: 0, failed: rows, errors: [error.message] }

  const mid = Math.ceil(rows.length / 2)
  const [left, right] = await Promise.all([
    insertBatchResilient(insert, rows.slice(0, mid)),
    insertBatchResilient(insert, rows.slice(mid)),
  ])
  return {
    imported: left.imported + right.imported,
    failed:   [...left.failed, ...right.failed],
    errors:   [...left.errors, ...right.errors],
  }
}
