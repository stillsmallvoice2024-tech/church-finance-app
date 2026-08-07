import { normalizeId } from './normalizeId'

// Unit Separator. normalizeId strips or collapses every control and invisible
// character, so this can never occur inside a normalised reference or
// description — "A" + "BC" and "AB" + "C" stay distinct keys.
const SEP = '\u001f'

/**
 * Hand out a transaction reference that this import has not already used for an
 * identical row, suffixing "-1", "-2", … only when it has.
 *
 * Uniqueness in the database is (org, bank, reference, date, amount,
 * description) — not the reference alone. That distinction is the whole point
 * here: banks legitimately reuse one reference across several postings (a
 * transfer, its fee and the VAT on that fee all carry one Session ID), and
 * those rows differ in amount, so they coexist happily and the bank's real
 * reference is preserved for reconciliation.
 *
 * What still needs suffixing is the narrow case of two rows in one import that
 * are identical in every one of those columns — most often a generated fallback
 * ID, which hashes date + amount + description + bank and so collides exactly
 * when those match. Without a suffix the second row would be rejected by the
 * index and a real transaction would be lost.
 *
 * `counts` is shared across a whole import and mutated in place. Every value
 * handed out is recorded against its fingerprint, so the same (reference,
 * fingerprint) pair can never be issued twice — including when "REF-1" is
 * itself a reference the statement contains.
 */
export function claimRef(counts: Map<string, number>, ref: string, fingerprint: string): string {
  const keyFor = (r: string) => `${r}${SEP}${fingerprint}`

  const seen = counts.get(keyFor(ref)) ?? 0
  counts.set(keyFor(ref), seen + 1)
  if (seen === 0) return ref

  let n = seen
  let candidate = `${ref}-${n}`
  while ((counts.get(keyFor(candidate)) ?? 0) > 0) {
    n++
    candidate = `${ref}-${n}`
  }
  counts.set(keyFor(candidate), 1)
  return candidate
}

/**
 * The row-identity half of the uniqueness key. Description is normalised
 * exactly as the database does it (public.normalize_txn_ref → normalizeId), and
 * amount goes through Number so "1000.00" and "1000" agree.
 */
export function rowFingerprint(date: string, amount: number, description: string | null): string {
  return `${date}${SEP}${Number(amount)}${SEP}${normalizeId(description ?? '')}`
}
