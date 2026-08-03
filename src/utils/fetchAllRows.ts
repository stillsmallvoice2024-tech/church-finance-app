// Supabase PostgREST enforces a server-side db-max-rows cap (default 1000) that
// overrides any client .limit() call.  This helper paginates transparently so
// callers always receive the full result set.
//
// Postgres gives no ordering guarantee for a query without ORDER BY, so paging
// with .range() alone can return the same row twice — or skip one entirely —
// once a result set exceeds one page.  Every page request therefore appends a
// primary-key tiebreaker (`id` by default); callers that set their own sort
// keep it, this only makes the ordering total.

const PAGE_SIZE = 1000

type PagedQuery<T> = {
  order: (column: string, opts: { ascending: boolean }) => PagedQuery<T>
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export async function fetchAllRows<T>(
  buildQuery: () => PagedQuery<T>,
  stableKey = 'id',
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery()
      .order(stableKey, { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: all, error: null }
}
