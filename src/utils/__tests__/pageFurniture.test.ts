import { describe, it, expect } from 'vitest'
import { stripPageFurniture } from '../pageFurniture'

// ── The reported contamination ─────────────────────────────────────────────────

/**
 * Reproduces the Parallex statement: an OCR pass folded the page footer into the
 * last transaction row of each page, scattering it across three columns.
 */
function parallexRows(): { rows: string[][]; rowPages: number[] } {
  const clean = (n: number): string[] => [
    `1${n}/01/2026`, '10/01/2026', '0.00', '107,000.00', '128,624.50',
    'TRANSFER FROM THE STANDING CHURCH INTERNATIONAL TOOLUWAMAYOKUN ODUNAYO OMITOYIN 107000.00 MOBILE TR',
  ]
  // The last row on each page carries the footer merged into its cells.
  const contaminated = (page: number): string[] => [
    '12/01/2026 (0700PARALLEX) 070072725539',
    '10/01/2026',
    '1,010.75',
    'customercare@parallexbank.com 0.00',
    '127,613.75',
    `Page: ${page} of 8 MOB:TRF TO THE STANDING CHURCH INTERNATIONAL`,
  ]
  const rows: string[][] = []
  const rowPages: number[] = []
  for (let p = 1; p <= 8; p++) {
    rows.push(clean(p)); rowPages.push(p)
    rows.push(contaminated(p)); rowPages.push(p)
  }
  return { rows, rowPages }
}

describe('stripPageFurniture — footer merged into a transaction row', () => {
  const { rows, rowPages } = parallexRows()
  const result = stripPageFurniture(rows, rowPages)

  it('keeps every transaction row', () => {
    expect(result.rows).toHaveLength(16)
    expect(result.keptIndices).toHaveLength(16)
  })

  it('strips the support code and helpline from the date cell', () => {
    expect(result.rows[1][0]).toBe('12/01/2026')
  })

  it('strips the support e-mail while keeping the amount beside it', () => {
    expect(result.rows[1][3]).toBe('0.00')
  })

  it('strips the page marker while keeping the narration beside it', () => {
    expect(result.rows[1][5]).toBe('MOB:TRF TO THE STANDING CHURCH INTERNATIONAL')
  })

  it('leaves uncontaminated rows byte-identical', () => {
    expect(result.rows[0]).toEqual(rows[0])
  })

  it('reports what it removed', () => {
    expect(result.removedFragments).toContain('customercare@parallexbank.com')
    expect(result.removedFragments).toContain('(0700PARALLEX)')
    expect(result.removedFragments.some(f => /^Page: \d of 8$/.test(f))).toBe(true)
  })
})

// ── Multiline safety: the hard constraint ──────────────────────────────────────

describe('stripPageFurniture — genuine multi-line cells are untouched', () => {
  it('preserves a wrapped narration spanning several lines', () => {
    const rows = [[
      '12/01/2026',
      'TRANSFER FROM THE STANDING CHURCH INTERNATIONAL\nTOOLUWAMAYOKUN ODUNAYO OMITOYIN 107000.00 MOBILE TR',
      '107,000.00',
    ]]
    const out = stripPageFurniture(rows, [1])
    expect(out.rows[0][1]).toBe(
      'TRANSFER FROM THE STANDING CHURCH INTERNATIONAL TOOLUWAMAYOKUN ODUNAYO OMITOYIN 107000.00 MOBILE TR',
    )
    expect(out.removedFragments).toEqual([])
  })

  it('preserves a long reference number that looks like a helpline', () => {
    // A 12-digit reference appears once, so it is never corroborated as furniture.
    const rows = [
      ['12/01/2026', 'NIP TRANSFER', '000013202608021', '5,000.00'],
      ['13/01/2026', 'POS PURCHASE', '000013202608099', '2,000.00'],
    ]
    const out = stripPageFurniture(rows, [1, 2])
    expect(out.rows[0][2]).toBe('000013202608021')
    expect(out.rows[1][2]).toBe('000013202608099')
  })

  it('keeps a digit run that recurs but on only one page', () => {
    // Same value twice on one page is a repeated transaction, not a footer.
    const rows = [
      ['12/01/2026', 'STANDING ORDER 070072725539', '1,000.00'],
      ['12/01/2026', 'STANDING ORDER 070072725539', '1,000.00'],
    ]
    const out = stripPageFurniture(rows, [1, 1])
    expect(out.rows[0][1]).toBe('STANDING ORDER 070072725539')
  })

  it('leaves Tier 2 shapes alone with no page evidence at all', () => {
    const rows = [['12/01/2026', 'PAYMENT 070072725539', '1,000.00']]
    const out = stripPageFurniture(rows)
    expect(out.rows[0][1]).toBe('PAYMENT 070072725539')
  })
})

// ── Tier 1 applies without corroboration ───────────────────────────────────────

describe('stripPageFurniture — unambiguous furniture', () => {
  it('removes page markers, e-mails and URLs even on a single page', () => {
    const rows = [[
      'Page 1 of 3 12/01/2026',
      'SALARY support@bank.com',
      'https://bank.com/statements 500.00',
    ]]
    const out = stripPageFurniture(rows)
    expect(out.rows[0]).toEqual(['12/01/2026', 'SALARY', '500.00'])
  })

  it('drops a row that was nothing but furniture', () => {
    const rows = [
      ['12/01/2026', 'SALARY', '500.00'],
      ['Page 2 of 3', 'customercare@bank.com', 'www.bank.com'],
      ['13/01/2026', 'RENT', '900.00'],
    ]
    const out = stripPageFurniture(rows, [1, 1, 2])
    expect(out.rows).toEqual([
      ['12/01/2026', 'SALARY', '500.00'],
      ['13/01/2026', 'RENT', '900.00'],
    ])
    expect(out.keptIndices).toEqual([0, 2])
  })

  it('handles an empty input', () => {
    expect(stripPageFurniture([])).toEqual({ rows: [], keptIndices: [], removedFragments: [] })
  })
})

// ── Cross-page corroboration ───────────────────────────────────────────────────

describe('stripPageFurniture — cross-page corroboration', () => {
  it('strips a bare domain once it recurs across pages', () => {
    const rows = [
      ['12/01/2026', 'SALARY parallexbank.com', '500.00'],
      ['13/01/2026', 'RENT parallexbank.com', '900.00'],
    ]
    const out = stripPageFurniture(rows, [1, 2])
    expect(out.rows[0][1]).toBe('SALARY')
    expect(out.rows[1][1]).toBe('RENT')
  })

  it('requires a majority of pages on longer documents', () => {
    // Present on 2 of 6 pages — below the 60% threshold, so it stays.
    const rows = Array.from({ length: 6 }, (_, i) => [
      `1${i}/01/2026`, i < 2 ? 'TRANSFER 070072725539' : 'TRANSFER', '100.00',
    ])
    const out = stripPageFurniture(rows, [1, 2, 3, 4, 5, 6])
    expect(out.rows[0][1]).toBe('TRANSFER 070072725539')
  })
})
