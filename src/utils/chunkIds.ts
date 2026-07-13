// PostgREST `.in()` filters are sent in the GET query string. A large import
// (e.g. 800 rows of 64-char SHA-256 fallback IDs) produces a ~50KB URL that
// exceeds server URL limits — the request fails and, if the error is ignored,
// every row is silently treated as new. Always chunk `.in()` ID lists.

export const DEDUP_CHUNK_SIZE = 100

export function chunkIds(ids: string[], size: number = DEDUP_CHUNK_SIZE): string[][] {
  if (size <= 0) throw new Error('chunkIds: size must be > 0')
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}
