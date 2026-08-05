import { describe, it, expect } from 'vitest'
import {
  extractTableFromPages,
  mergeRowFragments,
  cleanHeaderCell,
  collapseLetterSpacing,
  isDateLike,
  isAmountLike,
  type PdfPageItems,
  type PdfTextItem,
} from '../pdfTableExtract'
import { stripPageFurniture } from '../pageFurniture'

// ── Fixture helpers ────────────────────────────────────────────────────────────

const FONT = 10
const CHAR_W = 5.4

/** Places a text run at (x, y) with a width derived from its length. */
function t(x: number, y: number, text: string, width?: number): PdfTextItem {
  const w = width ?? text.length * CHAR_W
  return { x, xEnd: x + w, y, height: FONT, text }
}

/** Places a run with an explicit font size — for fixtures that mirror real geometry. */
function tf(x: number, y: number, text: string, width: number, height: number): PdfTextItem {
  return { x, xEnd: x + width, y, height, text }
}

function page(items: PdfTextItem[], height = 842): PdfPageItems {
  return { height, items }
}

// ── Fragment merging ───────────────────────────────────────────────────────────

describe('mergeRowFragments', () => {
  it('joins currency fragments split by pdfjs into one cell', () => {
    // Real geometry from a Wema/ALAT statement header: "Credit(" "₦" ")"
    const out = mergeRowFragments([
      { x: 429.4, xEnd: 456.7, y: 443.3, height: FONT, text: 'Credit(' },
      { x: 456.7, xEnd: 461.7, y: 443.3, height: FONT, text: '₦' },
      { x: 461.6, xEnd: 464.8, y: 443.3, height: FONT, text: ')' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Credit(₦)')
    expect(out[0].xEnd).toBeCloseTo(464.8)
  })

  it('keeps separate columns apart across a gutter', () => {
    const out = mergeRowFragments([t(20.8, 443, 'Value Date', 42.6), t(79.3, 443, 'Transaction Date', 66.9)])
    expect(out.map(i => i.text)).toEqual(['Value Date', 'Transaction Date'])
  })

  it('re-inserts the space between words in one cell', () => {
    const out = mergeRowFragments([t(10, 20, 'Need help?', 43.6), t(56.5, 20, 'Please', 22.6)])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Need help? Please')
  })

  it('merges long fragments — not only short ones', () => {
    // The old length<=3 heuristic could not merge two long runs.
    const out = mergeRowFragments([t(10, 20, 'INTERNATIONAL', 70), t(83, 20, 'TRANSFER', 43)])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('INTERNATIONAL TRANSFER')
  })

  it('does not inject a space into a kerning-split word', () => {
    // pdfjs splits mid-word on font/encoding changes with an effectively zero gap.
    const out = mergeRowFragments([t(10, 20, 'SHOP', 22), t(32, 20, 'RITE', 21)])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('SHOPRITE')
  })
})

// ── Cell classifiers ───────────────────────────────────────────────────────────

describe('cell classifiers', () => {
  it('recognises the date formats banks emit', () => {
    for (const d of ['02-Aug-2026', '03/08/2026', '2026-08-03', '3 Aug 2026', 'Aug 3, 2026', '03.08.2026']) {
      expect(isDateLike(d), d).toBe(true)
    }
    expect(isDateLike('S97259364')).toBe(false)
    expect(isDateLike('')).toBe(false)
  })

  it('recognises amounts including accounting and currency notation', () => {
    for (const a of ['249.54', '2,495.41', '₦745,704.11', '(1,000.00)', '-1,000.00', '1000', '500.00 CR']) {
      expect(isAmountLike(a), a).toBe(true)
    }
    // Narration containing digits must never read as an amount.
    expect(isAmountLike('0289680405:Int.Pd:01-07-2026 to 31-07-2026')).toBe(false)
    expect(isAmountLike('POS PAYMT SHOPRITE 22391')).toBe(false)
  })

  it('strips currency parentheticals from header cells', () => {
    expect(cleanHeaderCell('Credit(₦)')).toBe('Credit')
    expect(cleanHeaderCell('Amount (NGN)')).toBe('Amount')
    expect(cleanHeaderCell('Transaction  Details')).toBe('Transaction Details')
    expect(cleanHeaderCell('Balance')).toBe('Balance')
  })
})

// ── Full-page extraction ───────────────────────────────────────────────────────

/**
 * Mirrors the Wema/ALAT "Building Project" statement: a three-column metadata
 * block and a summary block above the table, and a contact footer below it.
 */
function wemaStylePage(): PdfPageItems {
  return page([
    t(12.9, 109.1, 'Account Statement', 162.6),
    t(12.9, 158.2, 'Account Name', 109.6),
    t(12.9, 180.5, "THE STANDING CHURCH INTERNATIONAL ''BUILDING PROJECT''", 346.1),
    t(12.9, 209.2, 'Address', 35.7), t(207.8, 209.2, 'Current Balance', 71.9), t(323.3, 209.2, 'Effective Available Balance', 120.5),
    t(12.9, 223.1, 'NO 7B ALFONSO ROAD SASA', 107.1), t(207.8, 223.1, '748,199.52', 39.2), t(323.3, 223.1, '748,157.52', 38.7),
    t(12.9, 244.4, 'Account Number', 73.9), t(207.8, 244.4, 'Total Credit', 52.1), t(323.3, 244.4, 'Total Debit', 48.1),
    t(12.9, 258.3, '0289680405', 49.1), t(207.8, 258.3, '2,495.41', 29.7), t(323.3, 258.3, '249.54', 25.8),
    t(12.9, 279.7, 'Account Type', 60.5), t(207.8, 279.7, 'Credit Count', 56), t(323.3, 279.7, 'Debit Count', 52.1),
    t(12.9, 293.5, 'WEMA TREASURE ACCOUNT - NON', 130.9), t(207.8, 293.5, '1', 2.5), t(323.3, 293.5, '1', 2.5),
    t(12.9, 307.4, 'INDIVIDUAL', 42.1),
    t(12.9, 348.1, 'Summary', 71.4),
    // Summary block — scores as highly on header keywords as the real header.
    t(38.7, 389.2, 'Opening Balance', 76.4), t(165.6, 389.2, 'Closing Balance', 71.4),
    t(287.6, 389.2, 'Date Printed', 54.5), t(399.6, 389.2, 'Start Date', 44.6), t(503.3, 389.2, 'End Date', 39.2),
    t(38.7, 403.1, '₦', 5.7), t(44.6, 403.1, '745,704.11', 36.7),
    t(165.6, 403.1, '₦', 5.7), t(171.6, 403.1, '748,199.52', 39.2),
    t(287.6, 403.1, '03 - Aug - 2026', 61), t(399.6, 403.1, '03-Aug-2026', 53.1), t(503.3, 403.1, '03-Aug-2026', 53.1),
    // The real transaction table header.
    t(20.8, 443.3, 'Value Date', 42.6), t(79.3, 443.3, 'Transaction Date', 66.9),
    t(162.6, 443.3, 'Reference Number', 73.9), t(252.9, 443.3, 'Transaction Details', 74.9),
    t(429.4, 443.3, 'Credit(', 27.3), t(456.7, 443.3, '₦', 5), t(461.6, 443.3, ')', 3.2),
    t(481, 443.3, 'Debit(', 23.8), t(504.8, 443.3, '₦', 5), t(509.7, 443.3, ')', 3.2),
    t(529.5, 443.3, 'Balance(', 35.2), t(564.8, 443.3, '₦', 5), t(569.7, 443.3, ')', 3.2),
    // Data rows.
    t(18.8, 465.6, '02-Aug-2026', 46.6), t(77.3, 465.6, '03-Aug-2026', 46.6), t(160.6, 465.6, 'S97259364', 38.2),
    t(250.9, 465.6, '0289680405:WTax.Pd:01-07-2026to 31-07-2026', 163.6),
    t(479, 465.6, '249.54', 23.3), t(527.6, 465.6, '745,704.11', 32.7),
    t(18.8, 489.9, '02-Aug-2026', 46.6), t(77.3, 489.9, '03-Aug-2026', 46.6), t(160.6, 489.9, 'S97259364', 38.2),
    t(250.9, 489.9, '0289680405:Int.Pd:01-07-2026 to 31-07-2026', 155.2),
    t(427.4, 489.9, '2,495.41', 26.8), t(527.6, 489.9, '748,199.52', 35.2),
    // Footer.
    t(22.8, 525.6, 'Need help?', 43.6), t(68.3, 525.6, 'Please', 22.6), t(92.7, 525.6, 'call:', 16),
    t(111.1, 525.6, '0700 2255 2528 or', 64), t(177, 525.6, 'e-mail:', 27.9), t(207.3, 525.6, 'help@alat.ng', 45.1),
    t(12.9, 548.9, 'alat.ng | wemabank.com', 109.1),
  ])
}

describe('extractTableFromPages — bank statement with preamble and footer', () => {
  const result = extractTableFromPages([wemaStylePage()])

  it('locates the transaction table rather than gridding the whole page', () => {
    expect(result.tableDetected).toBe(true)
    expect(result.headers).toEqual([
      'Value Date', 'Transaction Date', 'Reference Number', 'Transaction Details',
      'Credit', 'Debit', 'Balance',
    ])
  })

  it('emits only the transaction rows', () => {
    expect(result.rows).toEqual([
      ['02-Aug-2026', '03-Aug-2026', 'S97259364', '0289680405:WTax.Pd:01-07-2026to 31-07-2026', '', '249.54', '745,704.11'],
      ['02-Aug-2026', '03-Aug-2026', 'S97259364', '0289680405:Int.Pd:01-07-2026 to 31-07-2026', '2,495.41', '', '748,199.52'],
    ])
  })

  it('prefers the transaction header over the summary block that scores as high', () => {
    // The summary row (Opening/Closing Balance, Date Printed, Start/End Date)
    // must not become the header — it is followed by exactly one value row.
    expect(result.headers).not.toContain('Opening Balance')
    expect(result.rows.some(r => r.includes('748,157.52'))).toBe(false)
  })

  it('drops the contact footer', () => {
    const flat = result.rows.flat().join(' ')
    expect(flat).not.toMatch(/Need help|alat\.ng|wemabank/)
  })
})

// ── Column-assignment edge cases ───────────────────────────────────────────────

describe('extractTableFromPages — column assignment', () => {
  it('keeps a right-aligned balance out of the debit column', () => {
    // Header "Balance" starts at 500; the value is right-aligned so its left
    // edge (492) sits left of the Debit/Balance midpoint. Left-edge snapping
    // would file it under Debit; overlap assignment keeps it under Balance.
    const p = page([
      t(20, 100, 'Date', 22), t(80, 100, 'Description', 60), t(430, 100, 'Debit', 27), t(500, 100, 'Balance', 40),
      t(20, 120, '02-Aug-2026', 46), t(80, 120, 'ATM WITHDRAWAL', 78), t(432, 120, '5,000.00', 25), t(492, 120, '1,234,567.89', 48),
      t(20, 140, '03-Aug-2026', 46), t(80, 140, 'POS PURCHASE', 70), t(437, 140, '250.00', 20), t(497, 140, '1,234,317.89', 43),
    ])
    const r = extractTableFromPages([p])
    expect(r.headers).toEqual(['Date', 'Description', 'Debit', 'Balance'])
    expect(r.rows[0]).toEqual(['02-Aug-2026', 'ATM WITHDRAWAL', '5,000.00', '1,234,567.89'])
    expect(r.rows[1]).toEqual(['03-Aug-2026', 'POS PURCHASE', '250.00', '1,234,317.89'])
  })

  it('keeps an over-wide narration in its own column', () => {
    // Description text runs past the Credit header's left edge.
    const p = page([
      t(20, 100, 'Date', 22), t(80, 100, 'Narration', 50), t(300, 100, 'Credit', 30), t(380, 100, 'Balance', 40),
      t(20, 120, '02-Aug-2026', 46), t(80, 120, 'NIP TRANSFER FROM JOHN DOE REF 4829183', 205), t(302, 120, '10,000.00', 30), t(382, 120, '10,000.00', 30),
      t(20, 140, '03-Aug-2026', 46), t(80, 140, 'SALARY', 35), t(305, 140, '500.00', 20), t(385, 140, '10,500.00', 30),
    ])
    const r = extractTableFromPages([p])
    expect(r.rows[0]).toEqual(['02-Aug-2026', 'NIP TRANSFER FROM JOHN DOE REF 4829183', '10,000.00', '10,000.00'])
  })
})

// ── Multi-page ─────────────────────────────────────────────────────────────────

describe('extractTableFromPages — multi-page statements', () => {
  const header = (y: number) => [
    t(20, y, 'Date', 22), t(80, y, 'Description', 60), t(300, y, 'Credit', 30), t(380, y, 'Balance', 40),
  ]

  it('reprints of the header on later pages are not emitted as data', () => {
    const p1 = page([
      ...header(100),
      t(20, 120, '01-Aug-2026', 46), t(80, 120, 'OPENING DEPOSIT', 85), t(302, 120, '100.00', 22), t(382, 120, '100.00', 22),
      t(20, 140, '02-Aug-2026', 46), t(80, 140, 'TRANSFER IN', 62), t(302, 140, '200.00', 22), t(382, 140, '300.00', 22),
    ])
    const p2 = page([
      ...header(100),
      t(20, 120, '03-Aug-2026', 46), t(80, 120, 'TRANSFER IN', 62), t(302, 120, '400.00', 22), t(382, 120, '700.00', 22),
    ])
    const r = extractTableFromPages([p1, p2])
    expect(r.rows).toHaveLength(3)
    expect(r.rows.map(row => row[0])).toEqual(['01-Aug-2026', '02-Aug-2026', '03-Aug-2026'])
    expect(r.rows.some(row => row[1] === 'Description')).toBe(false)
  })

  it('continues a headerless page using the previous page grid', () => {
    const p1 = page([
      ...header(100),
      t(20, 120, '01-Aug-2026', 46), t(80, 120, 'OPENING DEPOSIT', 85), t(302, 120, '100.00', 22), t(382, 120, '100.00', 22),
    ])
    const p2 = page([
      t(20, 100, '02-Aug-2026', 46), t(80, 100, 'TRANSFER IN', 62), t(302, 100, '200.00', 22), t(382, 100, '300.00', 22),
      t(20, 130, 'Page 2 of 2', 50),
    ])
    const r = extractTableFromPages([p1, p2])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1]).toEqual(['02-Aug-2026', 'TRANSFER IN', '200.00', '300.00'])
  })
})

// ── Wrapped narration ──────────────────────────────────────────────────────────

describe('extractTableFromPages — wrapped narration rows', () => {
  it('appends a trailing wrap to the transaction above it', () => {
    const p = page([
      t(20, 100, 'Date', 22), t(80, 100, 'Description', 60), t(300, 100, 'Credit', 30), t(380, 100, 'Balance', 40),
      t(20, 120, '01-Aug-2026', 46), t(80, 120, 'NIP TRANSFER FROM', 95), t(302, 120, '100.00', 22), t(382, 120, '100.00', 22),
      t(80, 132, 'ALICE ADEOTI REF 88213', 118),
      t(20, 170, '02-Aug-2026', 46), t(80, 170, 'SALARY', 35), t(302, 170, '200.00', 22), t(382, 170, '300.00', 22),
    ])
    const r = extractTableFromPages([p])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0][1]).toBe('NIP TRANSFER FROM ALICE ADEOTI REF 88213')
  })

  it('prepends a leading wrap rendered above its own anchor', () => {
    const p = page([
      t(20, 100, 'Date', 22), t(80, 100, 'Description', 60), t(300, 100, 'Credit', 30), t(380, 100, 'Balance', 40),
      t(20, 120, '01-Aug-2026', 46), t(80, 120, 'SALARY', 35), t(302, 120, '100.00', 22), t(382, 120, '100.00', 22),
      // Much closer to the anchor below than to the one above → belongs to it.
      t(80, 165, 'NIP TRANSFER FROM', 95),
      t(20, 172, '02-Aug-2026', 46), t(80, 172, 'BOB OKAFOR', 60), t(302, 172, '200.00', 22), t(382, 172, '300.00', 22),
    ])
    const r = extractTableFromPages([p])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1][1]).toBe('NIP TRANSFER FROM BOB OKAFOR')
  })
})

// ── Fallback path ──────────────────────────────────────────────────────────────

describe('extractTableFromPages — fallback', () => {
  it('reports tableDetected=false and still returns a grid when no header exists', () => {
    // No recognisable titles, but the body reads like transactions, so the
    // guessed grid is worth handing back.
    const p = page([
      t(20, 100, 'alpha', 30), t(200, 100, 'beta', 25),
      t(20, 120, '02-Aug-2026', 46), t(200, 120, '1,500.00', 30),
      t(20, 140, '03-Aug-2026', 46), t(200, 140, '2,500.00', 30),
    ])
    const r = extractTableFromPages([p])
    expect(r.tableDetected).toBe(false)
    expect(r.rows.length).toBeGreaterThan(0)
  })

  it('returns nothing when the only text layer is a page stamp', () => {
    // Mirrors the Parallex statement: the table is drawn as vector outlines, so
    // the sole extractable text is `Page: N of 8`. Returning a tidy one-column
    // grid here would stop the caller falling through to OCR — the only thing
    // that can read such a file.
    const pages = Array.from({ length: 8 }, (_, i) =>
      page([t(543.2, 736.1, `Page: ${i + 1} of 8`, 30.3)], 792),
    )
    const r = extractTableFromPages(pages)
    expect(r).toEqual({ headers: [], rows: [], tableDetected: false, rowPages: [] })
  })

  it('returns nothing for a single stray text run', () => {
    const r = extractTableFromPages([page([t(100, 100, 'Confidential', 60)])])
    expect(r.rows).toEqual([])
    expect(r.headers).toEqual([])
  })

  it('returns empty output for an empty document', () => {
    expect(extractTableFromPages([page([])])).toEqual({ headers: [], rows: [], tableDetected: false, rowPages: [] })
  })
})

// ── Overlapping advertised widths ──────────────────────────────────────────────

/**
 * Mirrors a Wema "Barbados" export. Every run's advertised width overruns the
 * next run's start — `Transaction Date` claims x 52.8→129.1 while
 * `Transaction ID` begins at 102 — so any width-derived gap is negative and the
 * narration claims to be wider than the four columns to its right combined.
 */
function overlappingWidthPage(): PdfPageItems {
  const F = 11
  const desc = 'IP:BARBADOS INTL-MOBILE TRF TO WBP Mission BARBADOS INTL'
  return page([
    tf(52.8, 65.2, 'Account Name', 67.3, F), tf(102, 65.2, 'BARBADOS', 49.9, F),
    tf(52.8, 79.7, 'Account No', 53.3, F), tf(102.3, 79.7, '30000000', 45.1, F),
    // Header — advertised widths overlap the following column's start.
    tf(52.8, 108.7, 'Transaction Date', 76.3, F), tf(102, 108.7, 'Transaction ID', 64.5, F),
    tf(151.2, 108.7, 'Narration', 43.2, F), tf(200.4, 108.7, 'Amount Debit', 63.2, F),
    tf(253, 108.7, 'Amount Credit', 66.1, F), tf(327.4, 108.7, 'Current Balance', 71.8, F),
    // Credit column is right-aligned, so its start drifts across 24pt.
    tf(55.7, 123.3, '7/1/2026', 42.4, F), tf(102, 123.3, 'S97466995', 50.1, F),
    tf(151.2, 123.3, desc, 293.2, F), tf(257.8, 123.3, '1,000,000.00', 58.9, F),
    tf(334.8, 123.3, '1,000,000.00', 58.9, F),
    tf(55.7, 166.8, '7/5/2026', 42.4, F), tf(102, 166.8, 'S99398538', 50.1, F),
    tf(151.2, 166.8, 'NIP:Gudybella multi stream concept-offering', 201, F),
    tf(277.5, 166.8, '1,000.00', 39.3, F), tf(334.8, 166.8, '7,001,000.00', 58.9, F),
    // The only debit row.
    tf(55.7, 181.3, '7/6/2026', 42.4, F), tf(102, 181.3, 'S97214584', 50.1, F),
    tf(151.2, 181.3, 'Fuel to Total Petrol Station', 120.4, F),
    tf(200.8, 181.3, '67,000.00', 44.9, F), tf(334.8, 181.3, '6,934,000.00', 58.9, F),
  ], 792)
}

describe('extractTableFromPages — overlapping advertised widths', () => {
  const result = extractTableFromPages([overlappingWidthPage()])

  it('does not collapse the row into a single cell', () => {
    expect(result.tableDetected).toBe(true)
    expect(result.headers).toEqual([
      'Transaction Date', 'Transaction ID', 'Narration', 'Amount Debit', 'Amount Credit', 'Current Balance',
    ])
  })

  it('separates every column despite negative width-derived gaps', () => {
    expect(result.rows).toEqual([
      ['7/1/2026', 'S97466995', 'IP:BARBADOS INTL-MOBILE TRF TO WBP Mission BARBADOS INTL', '', '1,000,000.00', '1,000,000.00'],
      ['7/5/2026', 'S99398538', 'NIP:Gudybella multi stream concept-offering', '', '1,000.00', '7,001,000.00'],
      ['7/6/2026', 'S97214584', 'Fuel to Total Petrol Station', '67,000.00', '', '6,934,000.00'],
    ])
  })

  it('keeps debit and credit apart when their advertised extents overlap', () => {
    // Amount Debit claims 200.4→263.6 and Amount Credit starts at 253.
    expect(result.rows[2][3]).toBe('67,000.00')
    expect(result.rows[2][4]).toBe('')
    expect(result.rows[0][3]).toBe('')
  })
})

// ── Stacked header and multi-line records ──────────────────────────────────────

/**
 * Mirrors a Wema "Lagos Church" statement. The header stacks over three lines
 * (`Value`/`Date`), the reference title is letter-spaced, and each transaction
 * spans three lines because the narrow date column wraps `01-Aug-` / `2026`
 * above and below the single line that carries the amounts.
 */
function stackedHeaderPage(): PdfPageItems {
  const F = 6.9
  return page([
    // Summary block — scores as highly on header keywords as the real header.
    tf(38.7, 388.7, 'Opening Balance', 76.4, 7.9), tf(165.6, 388.7, 'Closing Balance', 71.4, 7.9),
    tf(287.6, 388.7, 'Date Printed', 54.5, 7.9), tf(399.6, 388.7, 'Start Date', 44.6, 7.9),
    tf(503.3, 388.7, 'End Date', 39.2, 7.9),
    tf(38.7, 402.6, '₦', 5.7, 7.9), tf(44.6, 402.6, '2,997,721.37', 43.6, 7.9),
    tf(165.6, 402.6, '₦', 5.7, 7.9), tf(171.6, 402.6, '3,046,178.19', 43.1, 7.9),
    tf(287.6, 402.6, '03 - Aug - 2026', 61, 7.9), tf(399.6, 402.6, '03-Aug-2026', 53.1, 7.9),
    tf(503.3, 402.6, '03-Aug-2026', 53.1, 7.9),
    // Header band, stacked across three lines.
    tf(20.8, 442.8, 'Value', 21.8, F), tf(60.5, 442.8, 'Transaction', 46.1, F),
    tf(122.5, 442.8, 'R e f e r e n c e', 40.7, F),
    tf(183.5, 448.7, 'Transaction Details', 74.9, F),
    tf(430.9, 448.7, 'Credit(', 27.3, F), tf(458.1, 448.7, '₦', 5, F), tf(463.1, 448.7, ')', 3.2, F),
    tf(482.4, 448.7, 'Debit(', 23.8, F), tf(506.2, 448.7, '₦', 5, F), tf(511.2, 448.7, ')', 3.2, F),
    tf(530.5, 448.7, 'Balance(', 35.2, F), tf(565.7, 448.7, '₦', 5, F), tf(570.7, 448.7, ')', 3.2, F),
    tf(20.8, 455.2, 'Date', 18.3, F), tf(60.5, 455.2, 'Date', 18.3, F), tf(122.5, 455.2, 'Number', 30.7, F),
    // Record 1 — date wraps above and below the amount line.
    tf(18.8, 477.5, '01-Aug-', 27.8, F),
    tf(181.5, 477.5, 'IP:AKINTOLA TIMILEYIN ASHADE-MOBILE TRF TO WBP Tithe-Timileyin', 221.6, F),
    tf(58.5, 483.4, '03-Aug-2026', 46.6, F), tf(120.5, 483.4, 'S97227427', 36.7, F),
    tf(428.9, 483.4, '123,000.00', 35.2, F), tf(528.6, 483.4, '2,997,721.37', 39.2, F),
    tf(18.8, 489.9, '2026', 16.9, F),
    tf(181.5, 489.9, 'Akintola THE STANDING CHURCH INTERN', 134.4, F),
    // Record 2 — single-line narration, date still wrapped.
    tf(18.8, 514.2, '01-Aug-', 27.8, F),
    tf(58.5, 520.1, '03-Aug-2026', 46.6, F), tf(120.5, 520.1, 'S97623571', 35.2, F),
    tf(181.5, 520.1, 'NIP:YETUNDE DORCAS AWOLADE-TITHE', 128.4, F),
    tf(428.9, 520.1, '1,000.00', 27.3, F), tf(528.6, 520.1, '2,998,721.37', 39.7, F),
    tf(18.8, 526.6, '2026', 16.9, F),
    // Record 3 — a debit, with the date split three ways.
    tf(18.8, 550.9, '02-', 12.4, F),
    tf(18.8, 563.3, 'Aug-', 17.4, F), tf(58.5, 563.3, '03-Aug-2026', 46.6, F),
    tf(120.5, 563.3, 'S482987', 29.7, F),
    tf(181.5, 563.3, '0299030203:WTax.Pd:31-07-2026to 31-07-2026', 161.6, F),
    tf(480.4, 563.3, '1,106.31', 25.8, F), tf(528.6, 563.3, '3,018,678.19', 41.2, F),
    tf(18.8, 575.7, '2026', 16.9, F),
  ])
}

describe('extractTableFromPages — stacked header and wrapped records', () => {
  const result = extractTableFromPages([stackedHeaderPage()])

  it('assembles the stacked header into one row of titles', () => {
    expect(result.tableDetected).toBe(true)
    expect(result.headers).toEqual([
      'Value Date', 'Transaction Date', 'Reference Number', 'Transaction Details',
      'Credit', 'Debit', 'Balance',
    ])
  })

  it('folds each three-line record into one transaction', () => {
    expect(result.rows).toHaveLength(3)
  })

  it('rejoins a date split across the lines above and below the amounts', () => {
    // `01-Aug-` renders above the amount line and `2026` below it.
    expect(result.rows.map(r => r[0])).toEqual(['01-Aug-2026', '01-Aug-2026', '02-Aug-2026'])
  })

  it('keeps the amount line together with its wrapped narration', () => {
    expect(result.rows[0][3]).toBe(
      'IP:AKINTOLA TIMILEYIN ASHADE-MOBILE TRF TO WBP Tithe-Timileyin Akintola THE STANDING CHURCH INTERN',
    )
    expect(result.rows[0][4]).toBe('123,000.00')
    expect(result.rows[0][6]).toBe('2,997,721.37')
  })

  it('routes the debit to the debit column', () => {
    expect(result.rows[2][4]).toBe('')
    expect(result.rows[2][5]).toBe('1,106.31')
    expect(result.rows[2][6]).toBe('3,018,678.19')
  })

  it('still prefers the transaction header over the summary block', () => {
    expect(result.headers).not.toContain('Opening Balance')
    expect(result.rows.some(r => r.includes('3,046,178.19'))).toBe(false)
  })
})

// ── Letter-spaced titles ───────────────────────────────────────────────────────

describe('collapseLetterSpacing', () => {
  it('rejoins characters emitted one per token', () => {
    expect(collapseLetterSpacing('R e f e r e n c e')).toBe('Reference')
    expect(collapseLetterSpacing('R e f e r e n c e Number')).toBe('Reference Number')
  })

  it('leaves ordinary titles and short words alone', () => {
    expect(collapseLetterSpacing('Transaction Details')).toBe('Transaction Details')
    expect(collapseLetterSpacing('A B Bank')).toBe('A B Bank')
  })
})

// ── Page provenance feeding the furniture scrubber ─────────────────────────────

/**
 * Mirrors the Parallex statement's real failure: the bank prints its support
 * code and helpline *inside the date column's horizontal bounds* at the foot of
 * every page, so column geometry cannot separate them from the date — they are
 * genuinely in that column. Only the fact that they recur on every page marks
 * them as furniture, which is what `rowPages` carries.
 */
function parallexFooterPage(pageNo: number, dates: string[]): PdfPageItems {
  const items: PdfTextItem[] = [
    t(52, 100, 'Transaction Date', 76), t(150, 100, 'Amount Debit', 63),
    t(230, 100, 'Amount Credit', 66), t(320, 100, 'Current Balance', 72),
    t(400, 100, 'Narration', 43),
  ]
  dates.forEach((d, i) => {
    const y = 120 + i * 15
    items.push(t(52, y, d, 53), t(155, y, '0.00', 20),
               t(235, y, '5,010.75', 40), t(325, y, '16,017.15', 45),
               t(400, y, `USSD:TRF TO THE STANDING CHURCH ${i}`, 180))
  })
  // Footer, rendered under the date column — same band as the last row.
  const footY = 120 + dates.length * 15
  items.push(t(52, footY, '(0700PARALLEX)', 70))
  items.push(t(52, footY + 12, '070072725539', 62))
  items.push(t(400, footY, `Page: ${pageNo} of 3`, 50))
  return page(items, 792)
}

describe('extractTableFromPages — page provenance', () => {
  const pages = [
    parallexFooterPage(1, ['01/08/2026', '02/08/2026']),
    parallexFooterPage(2, ['03/08/2026', '04/08/2026']),
    parallexFooterPage(3, ['05/08/2026', '06/08/2026']),
  ]
  const result = extractTableFromPages(pages)

  it('reports a source page for every row', () => {
    expect(result.rowPages).toHaveLength(result.rows.length)
    expect(new Set(result.rowPages).size).toBeGreaterThan(1)
  })

  it('attributes rows to the page they were read from', () => {
    // Two transactions per page, in order.
    expect(result.rowPages).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('lets the scrubber strip a support code that column geometry cannot', () => {
    // Without provenance the helpline and support code are indistinguishable
    // from a reference number, so Tier 2 leaves them — this is the regression
    // that put "(0700PARALLEX) 070072725539" in the date cell.
    const withProvenance = stripPageFurniture(result.rows, result.rowPages)
    for (const row of withProvenance.rows) {
      expect(row[0]).not.toMatch(/PARALLEX|070072725539/)
    }
    expect(withProvenance.removedFragments).toContain('(0700PARALLEX)')
    expect(withProvenance.removedFragments).toContain('070072725539')

    // Negative control: the same rows without provenance keep the furniture.
    // This is precisely the bug — parsePDF used to call the scrubber this way.
    const withoutProvenance = stripPageFurniture(result.rows)
    expect(withoutProvenance.rows.some(r => /PARALLEX|070072725539/.test(r[0]))).toBe(true)
  })

  it('leaves the dates themselves intact', () => {
    const withProvenance = stripPageFurniture(result.rows, result.rowPages)
    expect(withProvenance.rows.map(r => r[0])).toEqual([
      '01/08/2026', '02/08/2026', '03/08/2026', '04/08/2026', '05/08/2026', '06/08/2026',
    ])
  })
})
