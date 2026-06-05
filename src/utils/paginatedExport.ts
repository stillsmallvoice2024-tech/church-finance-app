const CHUNK = 1_000
export const EXPORT_MAX = 100_000

/**
 * Fetches all matching rows via paginated Supabase range queries.
 *
 * The factory is called once per chunk; include `count: 'exact'` in
 * the select for the first call so the total is available. Subsequent
 * calls may use `count: 'none'` for efficiency, but `count: 'exact'`
 * on every call is also fine (simpler and only used in export paths).
 *
 * Hard safety cap: EXPORT_MAX rows. When the server total exceeds the
 * cap, `truncated` is true and only the first EXPORT_MAX rows are
 * returned — no silent failure.
 */
export async function fetchAllPaginated<Row>(
  makeChunk: (from: number, to: number) => PromiseLike<{
    data: Row[] | null
    count: number | null
    error: { message: string } | null
  }>,
): Promise<{ rows: Row[]; truncated: boolean; total: number }> {
  const rows: Row[] = []

  // First chunk — establishes total count
  const first = await makeChunk(0, CHUNK - 1)
  if (first.error) throw new Error(first.error.message)
  rows.push(...(first.data ?? []))
  const total = first.count ?? rows.length

  const fetchUpTo = Math.min(total, EXPORT_MAX)

  for (let from = CHUNK; from < fetchUpTo; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, fetchUpTo - 1)
    const chunk = await makeChunk(from, to)
    if (chunk.error) throw new Error(chunk.error.message)
    rows.push(...(chunk.data ?? []))
  }

  return { rows, truncated: total > EXPORT_MAX, total }
}
