/**
 * Hand out a transaction reference that is not already used in this import,
 * suffixing "-1", "-2", … when the base is taken.
 *
 * Two rows in one import can share a reference for two reasons: a generated
 * fallback ID hashed identically (same date, amount, description and bank), or
 * the statement itself repeats a reference across genuine rows — a split
 * settlement, or a charge posted against its parent's reference. Both used to
 * insert happily; with transaction references unique per (org, bank) the second
 * row would now be rejected, losing a real transaction. Suffixing keeps both and
 * flags them for review.
 *
 * `counts` is shared across a whole import and mutated in place. Every returned
 * value is recorded in it, so a suffixed form can never be handed out twice —
 * including the case where "REF-1" is itself a reference the statement contains.
 */
export function claimRef(counts: Map<string, number>, base: string): string {
  const seen = counts.get(base) ?? 0
  counts.set(base, seen + 1)
  if (seen === 0) return base

  let n = seen
  let candidate = `${base}-${n}`
  while ((counts.get(candidate) ?? 0) > 0) {
    n++
    candidate = `${base}-${n}`
  }
  counts.set(candidate, 1)
  return candidate
}
