import { normalizeId } from './normalizeId'

// Unit Separator. normalizeId strips or collapses every control and invisible
// character, so this can never occur inside a normalised reference or
// description — "A" + "BC" and "AB" + "C" stay distinct keys.
const SEP = '\u001f'

/**
 * The row-identity key, matching the database's uniqueness index:
 * reference + date + amount + description, each normalised the way
 * public.normalize_txn_ref() normalises it. Amount goes through Number so
 * "1000.00" and "1000" agree.
 */
export function rowFingerprint(
  ref: string,
  date: string,
  amount: number,
  description: string | null,
): string {
  return [
    normalizeId(ref),
    date,
    String(Number(amount)),
    normalizeId(description ?? ''),
  ].join(SEP)
}

/**
 * Position of this row among otherwise-identical rows in the same statement:
 * 0 for the first, 1 for the second, and so on.
 *
 * A bank statement can legitimately contain two byte-identical lines. A
 * transfer that fails is reversed and retried, and both attempts post under one
 * Session ID with the same date, amount and narration — and, when nothing falls
 * between them, the same running balance too. Position is the only thing that
 * separates them, so it is stored (`ref_occurrence`) and forms part of the
 * uniqueness key.
 *
 * That leaves the bank's reference stored verbatim, which matters for
 * reconciling against the statement. And because the numbering follows
 * statement order, re-importing the same file reproduces it exactly — so a
 * genuine duplicate still collides and is still blocked.
 *
 * `counts` is shared across one import and mutated in place. `startAt` carries
 * the number of matching rows already in the database, so a statement imported
 * in overlapping parts keeps numbering upward instead of restarting at 0.
 */
export function nextOccurrence(
  counts: Map<string, number>,
  fingerprint: string,
  startAt = 0,
): number {
  const seen = counts.get(fingerprint) ?? startAt
  counts.set(fingerprint, seen + 1)
  return seen
}
