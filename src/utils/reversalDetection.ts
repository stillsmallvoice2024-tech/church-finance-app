import { normalizeId } from './normalizeId'
import type { ImportRow, ColumnIndices } from '../types/importRow'

/**
 * Like parseNumber, but keeps the sign. A bank marks a reversal one of two
 * ways: the same reference posts twice in the same column with opposite
 * signs ("-600" or "(600)" alongside "600"), or it posts once in each column
 * at the same amount. parseDebitAmount / parseNumber already abs the debit
 * side before a row is even built, so by the time an ImportRow exists the
 * sign that would identify the first case is gone — this reads it straight
 * from the raw cell, before that happens.
 */
export function parseSignedAmount(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  let s = String(raw).replace(/,/g, '').trim()
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/\s/g, '')
  if (s.startsWith('-')) neg = true
  const n = parseFloat(s)
  if (isNaN(n)) return 0
  return neg ? -Math.abs(n) : Math.abs(n)
}

export interface ReversalCandidate {
  ri:     number
  kind:   'inflow' | 'outflow'
  ref:    string
  amount: number
}

export interface ReversalDetection {
  /** Row indices to pre-select "Reversal" for — a pair found within this file. */
  reversalRis: Set<number>
  /**
   * A row whose OWN sign says it is a reversal, but no positive counterpart of
   * the same reference/kind/amount exists in this file — its original is
   * either earlier in the same import (past the point pairing already covers)
   * or already sitting in the database. Always tagged locally regardless of
   * whether the original is ever found, since the sign is unambiguous on its
   * own; carried forward so the caller can look for the original and offer to
   * tag it too.
   */
  lonelyNegative: ReversalCandidate[]
  /**
   * A row with no sign clue and no opposite-column partner in this file. Not
   * tagged locally — a same-ref, same-amount opposite-column row is common
   * enough on its own (see ImportModal.tsx's COMM/VAT handling) that it is
   * only a reversal if the database confirms one exists.
   */
  unpaired: ReversalCandidate[]
}

const AMOUNT_EPSILON = 0.005

// A reversal often carries the SAME transaction id as the original, but with a
// marker prefix on the reference/description text ("REV.", "RVRSAL",
// "REVERSE", "REVERSAL", "RVSL") — or, just as often, no marker at all. Case 2
// pairing must match these to the original even though the raw text differs,
// so grouping is done on this stripped "core" reference, not the raw one.
const REVERSAL_MARKER = /^(?:rev(?:ersal|ersed|erse)?|rvrsal|rvsl)[\s.:\-_]*/i
function coreRef(ref: string): string {
  return ref.replace(REVERSAL_MARKER, '').trim() || ref
}

/**
 * Pairs reversals within a single statement. Two passes per reference group:
 * first same-kind rows separated only by sign (case 1 — the debit column
 * carries both "600" and "-600"), then, among what's left, opposite-kind rows
 * at the same amount (case 2 — a debit reversed as a credit). A row claimed by
 * either pass is not reconsidered by the other or by a later group.
 */
export function detectReversalsWithinFile(
  rows: ImportRow[],
  merged: unknown[][],
  idx: ColumnIndices,
): ReversalDetection {
  const reversalRis = new Set<number>()
  const paired       = new Set<number>()
  const lonelyNegative: ReversalCandidate[] = []
  const unpaired: ReversalCandidate[] = []

  const byRef = new Map<string, ImportRow[]>()
  for (const r of rows) {
    if (!r.ref) continue
    const key = coreRef(normalizeId(r.ref))
    if (!key) continue
    const group = byRef.get(key)
    if (group) group.push(r); else byRef.set(key, [r])
  }

  const rawSign = new Map<number, number>()
  for (const r of rows) {
    const colIdx = r.kind === 'inflow' ? idx.credit : idx.debit
    if (colIdx == null || colIdx < 0) continue
    rawSign.set(r.ri, parseSignedAmount(merged[r.ri]?.[colIdx]))
  }
  const sameAmount = (a: number, b: number) => Math.abs(a - b) <= AMOUNT_EPSILON

  for (const group of byRef.values()) {
    // Case 1: same kind, opposite sign.
    for (const a of group) {
      if (paired.has(a.ri) || (rawSign.get(a.ri) ?? 0) >= 0) continue
      const b = group.find(x =>
        !paired.has(x.ri) && x.ri !== a.ri && x.kind === a.kind &&
        (rawSign.get(x.ri) ?? 0) > 0 && sameAmount(x.amount, a.amount))
      if (b) {
        paired.add(a.ri); paired.add(b.ri)
        reversalRis.add(a.ri); reversalRis.add(b.ri)
      }
    }
    // Case 2: opposite kind, either sign, among what case 1 left unpaired.
    for (const a of group) {
      if (paired.has(a.ri)) continue
      const b = group.find(x =>
        !paired.has(x.ri) && x.ri !== a.ri && x.kind !== a.kind && sameAmount(x.amount, a.amount))
      if (b) {
        paired.add(a.ri); paired.add(b.ri)
        reversalRis.add(a.ri); reversalRis.add(b.ri)
      }
    }
  }

  for (const r of rows) {
    if (paired.has(r.ri) || !r.ref) continue
    const key = coreRef(normalizeId(r.ref))
    if (!key) continue
    const sign = rawSign.get(r.ri) ?? 0
    if (sign < 0) {
      reversalRis.add(r.ri)
      lonelyNegative.push({ ri: r.ri, kind: r.kind, ref: key, amount: r.amount })
    } else {
      unpaired.push({ ri: r.ri, kind: r.kind, ref: key, amount: r.amount })
    }
  }

  return { reversalRis, lonelyNegative, unpaired }
}
