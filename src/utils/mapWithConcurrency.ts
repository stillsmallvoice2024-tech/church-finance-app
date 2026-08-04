// `Promise.all(items.map(fn))` fires every item at once. Fine for a handful
// of requests, but a 50k-row import chunked at 100 IDs/request produces
// ~500 simultaneous fetches — that blows past browser per-host connection
// limits and Supabase rate limits well before it ever hits PostgREST's
// row/URL limits, so requests start timing out or getting rejected instead
// of just queuing.
//
// This runs a fixed-size pool of workers pulling from a shared queue, so at
// most `limit` requests are in flight at once while everything still runs
// concurrently (not one-at-a-time) within that cap. Results are returned in
// the same order as `items`, regardless of completion order.

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R> | PromiseLike<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
