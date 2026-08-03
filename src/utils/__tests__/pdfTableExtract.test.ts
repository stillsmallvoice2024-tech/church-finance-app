import { describe, it, expect } from 'vitest'
import {
  extractTableFromPages,
  mergeRowFragments,
  cleanHeaderCell,
  isDateLike,
  isAmountLike,
  type PdfPageItems,
  type PdfTextItem,
} from '../pdfTableExtract'

// ── Fixture helpers ────────────────────────────────────────────────────────────

const FONT = 10
const CHAR_W = 5.4

/** Places a text run at (x, y) with a width derived from its length. */
function t(x: number, y: number, text: string, width?: number): PdfTextItem {
  const w = width ?? text.length * CHAR_W
  return { x, xEnd: x + w, y, height: FONT, text }
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
    const p = page([
      t(20, 100, 'alpha', 30), t(200, 100, 'beta', 25),
      t(20, 120, 'gamma', 32), t(200, 120, 'delta', 28),
    ])
    const r = extractTableFromPages([p])
    expect(r.tableDetected).toBe(false)
    expect(r.rows.length).toBeGreaterThan(0)
  })

  it('returns empty output for an empty document', () => {
    expect(extractTableFromPages([page([])])).toEqual({ headers: [], rows: [], tableDetected: false })
  })
})
