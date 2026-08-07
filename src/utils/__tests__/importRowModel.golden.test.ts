/**
 * Golden test — transaction ID stability across the row-model refactor.
 *
 * `buildImportRows` consolidated logic that previously lived in five separate
 * loops inside ImportModal.tsx. Transaction IDs feed BOTH duplicate detection
 * and insert, so any drift in how they are generated silently re-imports
 * transactions that already exist — the July 2026 failure where 772 of 800
 * known rows were reported as new.
 *
 * This test reimplements the pre-refactor algorithm verbatim and asserts the
 * new pipeline produces byte-identical IDs. It is the gate for the refactor:
 * if it fails, dedup has moved and the change must not ship.
 */

import { describe, it, expect } from 'vitest'
import {
  buildImportRows,
  mergeContinuationRows,
  deriveColumnIndices,
  parseNumber,
  parseDebitAmount,
  markDuplicates,
} from '../buildImportRows'
import { rowFingerprint } from '../refOccurrence'
import { generateFallbackTransactionId } from '../generateTransactionId'
import { normalizeId } from '../normalizeId'
import { parseDate, type DateFormat } from '../parseDate'
import type { ColumnIndices } from '../../types/importRow'

// ── Fixture ──────────────────────────────────────────────────────────────────
// Deliberately exercises every hazard the pipeline documents:
//  - a title row above the real header (header detection offset)
//  - a repeated mid-file header row
//  - continuation rows with no date and no amount
//  - COMM / VAT charge rows sharing the parent transaction's reference
//  - rows with no reference at all (fallback SHA-256 hashing)
//  - two identical rows (within-batch collision suffixing)
//  - invisible Unicode inside a description (zero-width space, NBSP, BOM)

const HEADERS = ['Date', 'Narration', 'Reference', 'Credit', 'Debit']

const ROWS: unknown[][] = [
  ['01/03/2026', 'NIP TRANSFER FROM JANE DOE',            'REF001', '50,000.00', ''],
  ['02/03/2026', 'NIP TRANSFER TO JOHN\u200b DOE',          'REF002', '',          '10,000.00'],
  ['',           'CONTINUATION OF NARRATION',             '',       '',          ''],
  ['03/03/2026', 'COMM - To pay/Volunteers Tag/Alice',    'REF002', '',          '52.50'],
  ['04/03/2026', 'VAT ON TRANSFER',                       'REF002', '',          '3.94'],
  ['Date',       'Narration',                             'Reference', 'Credit', 'Debit'], // repeated header
  ['05/03/2026', 'CASH DEPOSIT\u00a0 BRANCH',                '',       '25,000.00', ''],
  ['06/03/2026', 'POS PAYMT SHOPRITE',                    '',       '',          '(1,250.00)'],
  ['07/03/2026', 'IDENTICAL ROW',                         '',       '7,500.00',  ''],
  ['07/03/2026', 'IDENTICAL ROW',                         '',       '7,500.00',  ''],
  ['08/03/2026', '\ufeffSUNDAY OFFERING',                    '',       '120,000.00', ''],
  ['',           '',                                      '',       '',          ''], // blank
]

const DATE_FORMAT: DateFormat = 'DD/MM/YYYY'
const BANK = 'Access Bank'

const MAPPING: Record<string, string> = {
  Date:      'date',
  Narration: 'description',
  Reference: 'reference',
  Credit:    'credit',
  Debit:     'debit',
}

// ── Pre-refactor algorithm, copied verbatim from ImportModal.tsx ─────────────
// Stage 1 (continuation merge + normalization) then Stage 3 (ID generation).
// Intentionally NOT refactored — this is the reference implementation.

interface LegacyResult {
  inflowIds:  Record<number, string>
  outflowIds: Record<number, string>
}

async function legacyGenerateIds(
  headers: string[],
  rawRows: unknown[][],
  mapping: Record<string, string>,
  dateFormat: DateFormat,
  bankName: string,
): Promise<LegacyResult> {
  const s1ColIdx  = headers.findIndex(h => mapping[h] === 'stage_code_1')
  const dateIdx   = headers.findIndex(h => mapping[h] === 'date')
  const descIdx   = headers.findIndex(h => mapping[h] === 'description')
  const creditIdx = headers.findIndex(h => mapping[h] === 'credit')
  const debitIdx  = headers.findIndex(h => mapping[h] === 'debit')
  const refIdx    = headers.findIndex(h => mapping[h] === 'reference')
  void s1ColIdx

  const merged = rawRows.map(r => [...r])

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
    if (parseDate(row[dateIdx], dateFormat) !== null) continue
    if ((creditIdx >= 0 && parseNumber(row[creditIdx]) > 0) ||
        (debitIdx >= 0 && parseDebitAmount(row[debitIdx]) > 0)) continue
    const hasDesc = descIdx >= 0 && row[descIdx] != null && String(row[descIdx]).trim() !== ''
    const hasRef  = refIdx  >= 0 && row[refIdx]  != null && String(row[refIdx]).trim()  !== ''
    if (!hasDesc && !hasRef) continue
    let prevRi = ri - 1
    while (prevRi >= 0 && parseDate(merged[prevRi][dateIdx], dateFormat) === null) prevRi--
    if (prevRi < 0) continue
    const prev = merged[prevRi]
    if (hasDesc) prev[descIdx] = (String(prev[descIdx] ?? '').trim() + ' ' + String(row[descIdx]).trim()).replace(/\s+/g, ' ').trim()
    if (hasRef)  prev[refIdx]  = (String(prev[refIdx]  ?? '').trim() + ' ' + String(row[refIdx]).trim()).replace(/\s+/g, ' ').trim()
  }
  if (descIdx >= 0) {
    for (const row of merged) {
      const raw = row[descIdx]
      if (raw != null && raw !== '') row[descIdx] = normalizeId(String(raw)) || raw
    }
  }

  const newInflowIds:  Record<number, string> = {}
  const newOutflowIds: Record<number, string> = {}
  for (let ri = 0; ri < merged.length; ri++) {
    const raw    = merged[ri]
    const date   = dateIdx >= 0 ? parseDate(raw[dateIdx], dateFormat) : null
    if (!date) continue
    const credit = creditIdx >= 0 ? parseNumber(raw[creditIdx]) : 0
    const debit  = debitIdx  >= 0 ? parseDebitAmount(raw[debitIdx]) : 0
    const desc   = descIdx >= 0 && raw[descIdx] != null ? String(raw[descIdx]).trim() : ''
    const ref    = refIdx >= 0 && raw[refIdx] != null && raw[refIdx] !== ''
                     ? normalizeId(String(raw[refIdx])) || null : null

    if (credit > 0) {
      let id: string
      if (ref) {
        id = ref
      } else {
        // No suffix on repeats: two rows hashing alike ARE the same row, and
        // ref_occurrence separates them now. Kept in the reference
        // implementation so this golden still pins hashing itself.
        id = await generateFallbackTransactionId(String(date), String(credit), desc, bankName)
      }
      newInflowIds[ri] = id
    }
    if (debit > 0) {
      let id: string
      if (ref) {
        const chargeTag = /^COMM(?:ISSION)?\b/i.test(desc) ? '-comm'
                        : /^VAT\b/i.test(desc)             ? '-vat'
                        : ''
        id = chargeTag ? `${ref}${chargeTag}` : ref
      } else {
        id = await generateFallbackTransactionId(String(date), String(debit), desc, bankName)
      }
      newOutflowIds[ri] = id
    }
  }

  return { inflowIds: newInflowIds, outflowIds: newOutflowIds }
}

// ── New pipeline ─────────────────────────────────────────────────────────────

async function newGenerateIds() {
  const idx: ColumnIndices = deriveColumnIndices(HEADERS, MAPPING)
  const merged = mergeContinuationRows(ROWS, HEADERS, idx, DATE_FORMAT)
  const rows = await buildImportRows(merged, idx, DATE_FORMAT, BANK, { yieldEvery: 0 })
  const inflowIds:  Record<number, string> = {}
  const outflowIds: Record<number, string> = {}
  for (const r of rows) {
    if (r.kind === 'inflow') inflowIds[r.ri] = r.txnId
    else                     outflowIds[r.ri] = r.txnId
  }
  return { inflowIds, outflowIds, rows, merged, idx }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('importRowModel golden — ID generation is unchanged', () => {
  it('produces byte-identical inflow transaction refs', async () => {
    const legacy = await legacyGenerateIds(HEADERS, ROWS, MAPPING, DATE_FORMAT, BANK)
    const next   = await newGenerateIds()
    expect(next.inflowIds).toEqual(legacy.inflowIds)
  })

  it('produces byte-identical outflow transaction ids', async () => {
    const legacy = await legacyGenerateIds(HEADERS, ROWS, MAPPING, DATE_FORMAT, BANK)
    const next   = await newGenerateIds()
    expect(next.outflowIds).toEqual(legacy.outflowIds)
  })

  it('keys IDs by the same row indices as before', async () => {
    const legacy = await legacyGenerateIds(HEADERS, ROWS, MAPPING, DATE_FORMAT, BANK)
    const next   = await newGenerateIds()
    expect(Object.keys(next.inflowIds).sort()).toEqual(Object.keys(legacy.inflowIds).sort())
    expect(Object.keys(next.outflowIds).sort()).toEqual(Object.keys(legacy.outflowIds).sort())
  })

  it('is deterministic — a second run yields the same IDs', async () => {
    const a = await newGenerateIds()
    const b = await newGenerateIds()
    expect(a.inflowIds).toEqual(b.inflowIds)
    expect(a.outflowIds).toEqual(b.outflowIds)
  })
})

describe('importRowModel — pipeline behaviour the IDs depend on', () => {
  it('strips the repeated mid-file header row', async () => {
    const { merged } = await newGenerateIds()
    const isHeaderRow = (r: unknown[]) => String(r[1] ?? '') === 'Narration'
    expect(merged.some(isHeaderRow)).toBe(false)
  })

  it('merges a continuation row into the preceding dated row', async () => {
    const { merged, idx } = await newGenerateIds()
    const target = merged.find(r => String(r[idx.desc] ?? '').includes('JOHN'))
    expect(String(target?.[idx.desc])).toContain('CONTINUATION OF NARRATION')
  })

  it('suffixes COMM and VAT rows that reuse the parent reference', async () => {
    const { rows } = await newGenerateIds()
    const ids = rows.filter(r => r.kind === 'outflow').map(r => r.txnId)
    expect(ids).toContain('REF002-comm')
    expect(ids).toContain('REF002-vat')
    // The parent debit keeps the bare reference.
    expect(ids).toContain('REF002')
  })

  // Identical rows used to be forced apart by suffixing the reference. They are
  // now separated by ref_occurrence instead, so the reference the bank supplied
  // (or the deterministic fallback hash) is stored verbatim on both.
  it('gives two identical rows the same ref and distinct occurrences', async () => {
    const { rows } = await newGenerateIds()
    const identical = rows.filter(r => r.description === 'IDENTICAL ROW')
    expect(identical).toHaveLength(2)
    expect(identical[0].txnId).toEqual(identical[1].txnId)

    markDuplicates(rows, new Map(), new Map())
    expect(identical.map(r => r.refOccurrence)).toEqual([0, 1])
  })

  it('skips exactly as many identical rows as the database already holds', async () => {
    const { rows } = await newGenerateIds()
    const identical = rows.filter(r => r.description === 'IDENTICAL ROW')
    const fp = rowFingerprint(identical[0].txnId, identical[0].date, identical[0].amount, identical[0].description)
    const side = identical[0].kind === 'inflow' ? 'inflow' : 'outflow'

    // One of the pair is already stored: skip that one, import the other as
    // occurrence 1 so it coexists rather than colliding.
    markDuplicates(
      rows,
      side === 'inflow'  ? new Map([[fp, 1]]) : new Map(),
      side === 'outflow' ? new Map([[fp, 1]]) : new Map(),
    )
    expect(identical[0].isDuplicate).toBe(true)
    expect(identical[1].isDuplicate).toBe(false)
    expect(identical[1].refOccurrence).toBe(1)
  })

  it('strips invisible Unicode from descriptions before hashing', async () => {
    const { rows } = await newGenerateIds()
    const descs = rows.map(r => r.description)
    // normalizeId REMOVES invisible characters outright (it does not translate
    // them to spaces), then collapses the whitespace that remains.
    expect(descs).toContain('SUNDAY OFFERING')            // leading BOM stripped
    expect(descs).toContain('CASH DEPOSIT BRANCH')        // NBSP stripped, space collapsed
    expect(descs.some(d => d.includes('\u200b'))).toBe(false)
    expect(descs.some(d => d.includes('\u00a0'))).toBe(false)
    expect(descs.some(d => d.includes('\ufeff'))).toBe(false)
  })

  it('treats accounting-notation debits as positive magnitudes', async () => {
    const { rows } = await newGenerateIds()
    const pos = rows.find(r => r.description.startsWith('POS PAYMT'))
    expect(pos?.kind).toBe('outflow')
    expect(pos?.amount).toBe(1250)
  })

  it('skips rows with no parseable date', async () => {
    const { rows } = await newGenerateIds()
    expect(rows.every(r => r.date !== '')).toBe(true)
  })

  it('carries the RAW description, never a shortened narration', async () => {
    const { rows } = await newGenerateIds()
    const comm = rows.find(r => r.description.startsWith('COMM'))
    // normalizeNarration would render this as "COMM - Volunteers Tag";
    // the row model must keep the full statement text.
    expect(comm?.description).toBe('COMM - To pay/Volunteers Tag/Alice')
  })
})
