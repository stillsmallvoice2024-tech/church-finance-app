// Supabase PostgREST enforces a server-side db-max-rows cap (default 1000) that
// overrides any client .limit() call.  This helper paginates transparently so
// callers always receive the full result set.

const PAGE_SIZE = 1000

type RangeableQuery<T> = {
  range: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

export async function fetchAllRows<T>(
  buildQuery: () => RangeableQuery<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: all, error: null }
}
