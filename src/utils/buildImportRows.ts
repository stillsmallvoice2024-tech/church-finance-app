// ── Import row construction ──────────────────────────────────────────────────
//
// Consolidates logic that previously appeared in five places inside
// ImportModal.tsx: the ID-generation loop, the duplicate-marking loop, the
// `autoClassifiedTypes` memo, the Step 4 `allRows` IIFE, and `runImport`.
// Column indices were separately derived at seven sites; they are derived once
// here and carried on the result.
//
// Every function is pure and DB-free so the pipeline can be unit-tested without
// React or Supabase.

import { normalizeId } from './normalizeId'
import { parseDate, type DateFormat } from './parseDate'
import { generateFallbackTransactionId } from './generateTransactionId'
import type { ImportRow, ColumnIndices } from '../types/importRow'
import { emptyRowConfig } from '../types/importRow'

// ── Cell parsing ─────────────────────────────────────────────────────────────

/** Raw signed numeric parse. Credits are always stored positive, so this is safe there. */
export function parseNumber(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw
  const cleaned = String(raw).replace(/,/g, '').replace(/\s/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

/**
 * Debit amounts arrive in several sign conventions depending on the bank.
 * Always returns an unsigned magnitude and understands accounting notation.
 *
 * NEVER use `parseNumber` on a raw debit cell — it returns signed values and
 * does not handle `(1,000.00)`.
 */
export function parseDebitAmount(raw: unknown): number {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : Math.abs(raw)
  let s = String(raw).replace(/,/g, '').replace(/\s/g, '').trim()
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1)   // (1000.00) → 1000
  const n = parseFloat(s)
  return isNaN(n) ? 0 : Math.abs(n)
}

// ── Column indices ───────────────────────────────────────────────────────────

/**
 * Derive every column index once from the header→field mapping.
 *
 * Previously recomputed at seven independent sites, which is why
 * `import-rules.md` had to enumerate "all four debit read-sites" as a rule to
 * remember. One derivation makes that class of drift structurally impossible.
 */
export function deriveColumnIndices(
  headers: string[],
  mapping: Record<string, string>,
): ColumnIndices {
  const find = (field: string) => headers.findIndex(h => mapping[h] === field)
  return {
    date:    find('date'),
    desc:    find('description'),
    credit:  find('credit'),
    debit:   find('debit'),
    ref:     find('reference'),
    s1:      find('stage_code_1'),
    s2:      find('stage_code_2'),
    balance: find('balance'),
  }
}

// ── Stage 1: continuation rows + description normalization ───────────────────

/**
 * Some bank statements split one transaction across two rows — the narration or
 * reference overflows into a row with no date and no amount. Those rows are
 * appended to the nearest preceding dated row.
 *
 * Also strips repeated mid-file header rows (statements with several sub-tables)
 * before continuation logic runs, and normalizes every description cell.
 *
 * Row indices are preserved for surviving rows, so per-row state stays aligned.
 */
export function mergeContinuationRows(
  rows: unknown[][],
  headers: string[],
  idx: ColumnIndices,
  dateFormat: DateFormat,
): unknown[][] {
  const merged = rows.map(r => [...r])

  // Drop repeated header rows first — otherwise they look like continuation
  // rows and get appended to the preceding transaction's description.
  const normCell = (c: unknown) => String(c ?? '').toLowerCase().replace(/[\s_\-()[\]]+/g, '')
  const headerSig = headers.map(normCell).filter(Boolean).join('\0')
  if (headerSig) {
    for (let ri = merged.length - 1; ri >= 0; ri--) {
      if (merged[ri].map(normCell).filter(Boolean).join('\0') === headerSig) {
        merged.splice(ri, 1)
      }
    }
  }

  for (let ri = 1; ri < merged.length; ri++) {
    const row = merged[ri]
    if (parseDate(row[idx.date], dateFormat) !== null) continue
    if ((idx.credit >= 0 && parseNumber(row[idx.credit]) > 0) ||
        (idx.debit  >= 0 && parseDebitAmount(row[idx.debit]) > 0)) continue
    const hasDesc = idx.desc >= 0 && row[idx.desc] != null && String(row[idx.desc]).trim() !== ''
    const hasRef  = idx.ref  >= 0 && row[idx.ref]  != null && String(row[idx.ref]).trim()  !== ''
    if (!hasDesc && !hasRef) continue
    let prevRi = ri - 1
    while (prevRi >= 0 && parseDate(merged[prevRi][idx.date], dateFormat) === null) prevRi--
    if (prevRi < 0) continue
    const prev = merged[prevRi]
    if (hasDesc) prev[idx.desc] = (String(prev[idx.desc] ?? '').trim() + ' ' + String(row[idx.desc]).trim()).replace(/\s+/g, ' ').trim()
    if (hasRef)  prev[idx.ref]  = (String(prev[idx.ref]  ?? '').trim() + ' ' + String(row[idx.ref]).trim()).replace(/\s+/g, ' ').trim()
  }

  // Normalize descriptions BEFORE any hashing so fallback IDs are stable across
  // re-imports of the same file.
  if (idx.desc >= 0) {
    for (const row of merged) {
      const raw = row[idx.desc]
      if (raw != null && raw !== '') row[idx.desc] = normalizeId(String(raw)) || raw
    }
  }

  return merged
}

// ── Stage 2 + 3: build rows and generate transaction IDs ─────────────────────

export interface BuildImportRowsOptions {
  /** Called periodically so the caller can show hashing progress on long files. */
  onProgress?: (done: number, total: number) => void
  /** Rows between event-loop yields. Keeps the UI paintable on 10k-row files. */
  yieldEvery?: number
}

/**
 * Build the `ImportRow[]` model from merged sheet rows.
 *
 * A row that carries both a credit and a debit produces two entries — matching
 * the original behaviour, which kept separate inflow and outflow ID maps keyed
 * by the same row index.
 *
 * Transaction IDs are generated here, after description normalization, and are
 * the same values later used for both duplicate detection and insert. Computing
 * them once is what prevents dedup/insert drift.
 */
export async function buildImportRows(
  merged: unknown[][],
  idx: ColumnIndices,
  dateFormat: DateFormat,
  bankName: string,
  opts: BuildImportRowsOptions = {},
): Promise<ImportRow[]> {
  const { onProgress, yieldEvery = 500 } = opts
  const rows: ImportRow[] = []

  // Separate counters per kind, mirroring the original inflow/outflow ID maps.
  const inflowIdCounts  = new Map<string, number>()
  const outflowIdCounts = new Map<string, number>()

  for (let ri = 0; ri < merged.length; ri++) {
    if (yieldEvery > 0 && ri > 0 && ri % yieldEvery === 0) {
      onProgress?.(ri, merged.length)
      // Let React paint the progress counter before continuing.
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    const raw  = merged[ri]
    const date = idx.date >= 0 ? parseDate(raw[idx.date], dateFormat) : null
    if (!date) continue

    const credit = idx.credit >= 0 ? parseNumber(raw[idx.credit]) : 0
    const debit  = idx.debit  >= 0 ? parseDebitAmount(raw[idx.debit]) : 0
    const desc   = idx.desc >= 0 && raw[idx.desc] != null ? String(raw[idx.desc]).trim() : ''
    const ref    = idx.ref >= 0 && raw[idx.ref] != null && raw[idx.ref] !== ''
                     ? normalizeId(String(raw[idx.ref])) || null : null

    if (credit > 0) {
      let txnId: string
      if (ref) {
        txnId = ref
      } else {
        const baseId = await generateFallbackTransactionId(String(date), String(credit), desc, bankName)
        const count  = inflowIdCounts.get(baseId) ?? 0
        inflowIdCounts.set(baseId, count + 1)
        txnId = count === 0 ? baseId : `${baseId}-${count}`
      }
      rows.push({
        ri, kind: 'inflow', date, amount: credit, description: desc, ref, txnId,
        isDuplicate: false, config: emptyRowConfig(), resolution: 'unresolved',
      })
    }

    if (debit > 0) {
      let txnId: string
      if (ref) {
        // Some banks reuse the parent transaction's reference for its associated
        // charges; the suffix keeps COMM/VAT rows distinct for dedup.
        const chargeTag = /^COMM(?:ISSION)?\b/i.test(desc) ? '-comm'
                        : /^VAT\b/i.test(desc)             ? '-vat'
                        : ''
        txnId = chargeTag ? `${ref}${chargeTag}` : ref
      } else {
        const baseId = await generateFallbackTransactionId(String(date), String(debit), desc, bankName)
        const count  = outflowIdCounts.get(baseId) ?? 0
        outflowIdCounts.set(baseId, count + 1)
        txnId = count === 0 ? baseId : `${baseId}-${count}`
      }
      const config = emptyRowConfig()
      // Seed stage codes from mapped spreadsheet columns when present.
      config.stageCode1 = idx.s1 >= 0 && raw[idx.s1] != null && raw[idx.s1] !== ''
        ? String(raw[idx.s1]).trim() : ''
      config.stageCode2 = idx.s2 >= 0 && raw[idx.s2] != null && raw[idx.s2] !== ''
        ? String(raw[idx.s2]).trim() : ''
      rows.push({
        ri, kind: 'outflow', date, amount: debit, description: desc, ref, txnId,
        isDuplicate: false, config, resolution: config.stageCode1 ? 'rule' : 'unresolved',
      })
    }
  }

  onProgress?.(merged.length, merged.length)
  return rows
}

/** Distinct transaction IDs for one side, ready for the chunked dedup query. */
export function collectTxnIds(rows: ImportRow[], kind: 'inflow' | 'outflow'): string[] {
  return rows.filter(r => r.kind === kind).map(r => r.txnId)
}

/**
 * Mark rows whose transaction ID already exists in the database.
 * Returns `{ total, newCount, dupCount }` for the Step 4 summary banner.
 */
export function markDuplicates(
  rows: ImportRow[],
  existingInflowRefs: Set<string>,
  existingOutflowIds: Set<string>,
): { total: number; newCount: number; dupCount: number } {
  // A statement row producing both a credit and a debit entry is counted once,
  // matching the original per-row duplicate statistics.
  const seenRis    = new Set<number>()
  const dupRis     = new Set<number>()

  for (const row of rows) {
    const existing = row.kind === 'inflow' ? existingInflowRefs : existingOutflowIds
    if (existing.has(normalizeId(row.txnId))) {
      row.isDuplicate = true
      dupRis.add(row.ri)
    }
    seenRis.add(row.ri)
  }

  const total    = seenRis.size
  const dupCount = dupRis.size
  return { total, newCount: total - dupCount, dupCount }
}
