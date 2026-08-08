import { describe, it, expect } from 'vitest'
import { detectDateFormat } from '../detectDateFormat'

describe('detectDateFormat', () => {
  it('detects DD/MM/YYYY from a first component over 12', () => {
    // 18 cannot be a month, so it must be the day: day comes first.
    const r = detectDateFormat(['01/05/2026', '18/07/2025', '03/03/2026'])
    expect(r).toMatchObject({ kind: 'decided', format: 'DD/MM/YYYY', a: 18, b: 7 })
  })

  it('detects MM/DD/YYYY from a second component over 12', () => {
    // 25 cannot be a month, so it must be the day: day comes second.
    const r = detectDateFormat(['05/01/2026', '07/25/2025'])
    expect(r).toMatchObject({ kind: 'decided', format: 'MM/DD/YYYY', a: 7, b: 25 })
  })

  it('reports which row and which two numbers decided it', () => {
    const r = detectDateFormat(['01/05/2026', '18/07/2025'])
    if (r.kind !== 'decided') throw new Error('expected decided')
    expect(r.row).toBe(2)
  })

  // The case the user specifically raised: every date has both components
  // <= 12, so nothing in the file can settle it. Must not guess.
  it('reports ambiguous when nothing in the column can decide', () => {
    const r = detectDateFormat(['05/07/2026', '01/05/2026', '03/03/2026'])
    expect(r.kind).toBe('ambiguous')
  })

  it('reports excel-serial for numeric date cells — no format question at all', () => {
    expect(detectDateFormat([45808, 45809, 45810]).kind).toBe('excel-serial')
  })

  it('reports iso for YYYY-MM-DD cells — no format question at all', () => {
    expect(detectDateFormat(['2026-07-18', '2026-07-19']).kind).toBe('iso')
  })

  it('reports no-evidence for an empty or unusable column', () => {
    expect(detectDateFormat([]).kind).toBe('no-evidence')
    expect(detectDateFormat(['', null, undefined]).kind).toBe('no-evidence')
    expect(detectDateFormat(['not a date', 'also not']).kind).toBe('no-evidence')
  })

  it('one decisive row is enough even among mostly ambiguous ones', () => {
    const r = detectDateFormat(['01/05/2026', '02/06/2026', '18/07/2025', '03/03/2026'])
    expect(r).toMatchObject({ kind: 'decided', format: 'DD/MM/YYYY' })
  })

  it('the first decisive row wins, not the last', () => {
    // Row 2 says MM/DD (25 in 2nd position); a later contradiction should not
    // overwrite it — real statements do not mix formats, so first evidence
    // stands and any conflict is a file-format problem outside this scope.
    const r = detectDateFormat(['01/01/2026', '07/25/2025', '18/07/2025'])
    expect(r).toMatchObject({ format: 'MM/DD/YYYY' })
  })
})
