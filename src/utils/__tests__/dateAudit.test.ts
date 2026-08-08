import { describe, it, expect } from 'vitest'
import { auditDateColumn, type DateSymptom } from '../dateAudit'

/** A clean month of DD/MM/YYYY dates to pad the fixtures out. */
const clean = (n = 12) =>
  Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, '0')}/05/2026`)

const symptoms = (cells: unknown[]): DateSymptom[] =>
  auditDateColumn(cells, 'DD/MM/YYYY').findings.map(f => f.symptom)

const findingFor = (cells: unknown[], s: DateSymptom) =>
  auditDateColumn(cells, 'DD/MM/YYYY').findings.find(f => f.symptom === s)

describe('auditDateColumn', () => {
  it('passes a clean statement with nothing to report', () => {
    const audit = auditDateColumn(clean(), 'DD/MM/YYYY')
    expect(audit.findings).toEqual([])
    expect(audit.blocking).toBe(false)
    expect(audit.total).toBe(12)
  })

  it('ignores empty cells rather than counting them as failures', () => {
    const audit = auditDateColumn([...clean(), '', null, undefined], 'DD/MM/YYYY')
    expect(audit.total).toBe(12)
    expect(audit.findings).toEqual([])
  })

  // The real failures, each reproduced from the input that caused it.

  // parseDate now refuses these outright rather than silently inventing
  // 1905-07-18 / 2026-01-01 / 2001-01-05 — `parsed` is null in every case here.
  // The audit's job is to say WHICH kind of null it is, from the raw shape.

  it('catches a bare year stored as a number, which used to parse to 1905', () => {
    const f = findingFor([...clean(), 2026], 'year-as-serial')
    expect(f?.count).toBe(1)
    expect(f?.blocking).toBe(true)
    expect(f?.samples[0]).toMatchObject({ raw: '2026', parsed: null })
  })

  it('catches a bare year stored as text, which used to invent 1 January', () => {
    const f = findingFor([...clean(), '2026'], 'bare-year')
    expect(f?.count).toBe(1)
    expect(f?.blocking).toBe(true)
    expect(f?.samples[0]).toMatchObject({ raw: '2026', parsed: null })
  })

  it('catches a day and month with no year, which used to default to 2001', () => {
    const f = findingFor([...clean(), '5-Jan', '22-Dec'], 'missing-year')
    expect(f?.count).toBe(2)
    expect(f?.blocking).toBe(true)
    expect(f?.samples.every(s => s.parsed === null)).toBe(true)
  })

  // parseDate now accepts -, . and 2-digit years alongside / and 4-digit years
  // — these used to be exactly the formats that silently dropped a row.
  it('no longer flags dash, dot or 2-digit-year separators as unparseable', () => {
    expect(symptoms(['18-07-2025', '18/07/25', '18.07.2025'])).toEqual([])
  })

  it('catches genuinely unrecognisable cells, which would drop the row silently', () => {
    const f = findingFor([...clean(), 'not a date', 'abc', '07/2025'], 'unparsed')
    expect(f?.count).toBe(3)
    expect(f?.blocking).toBe(true)
    expect(f?.samples.every(s => s.parsed === null)).toBe(true)
  })

  it('rejects a calendar-invalid date rather than silently correcting it', () => {
    const f = findingFor([...clean(), '32/13/2025', '29/02/2025'], 'unparsed')
    expect(f?.count).toBe(2)
    expect(f?.blocking).toBe(true)
  })

  // A genuine 2001 date must not be mistaken for the JS default.
  it('does not flag a date that really is in 2001', () => {
    expect(symptoms(['01/01/2001', '02/01/2001', '03/01/2001', '04/01/2001']))
      .not.toContain('missing-year')
  })

  it('reports the row number so the cell can be found in the file', () => {
    const f = findingFor([...clean(4), '5-Jan'], 'missing-year')
    expect(f?.samples[0].row).toBe(5)
  })

  it('caps samples but keeps the full count', () => {
    const f = findingFor([...clean(), ...Array(40).fill('5-Jan')], 'missing-year')
    expect(f?.count).toBe(40)
    expect(f?.samples).toHaveLength(5)
  })

  describe('out-of-range', () => {
    it('warns without blocking, since it is inference not certainty', () => {
      const f = findingFor([...clean(), '01/05/2019'], 'out-of-range')
      expect(f?.count).toBe(1)
      expect(f?.blocking).toBe(false)
      expect(auditDateColumn([...clean(), '01/05/2019'], 'DD/MM/YYYY').blocking).toBe(false)
    })

    it('judges against the statement\'s own span, not a fixed year', () => {
      // A statement legitimately covering 2019 is clean on its own terms.
      const old = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}/05/2019`)
      expect(symptoms(old)).toEqual([])
    })

    it('leaves a full year of dates alone', () => {
      const year = Array.from({ length: 12 }, (_, i) => `15/${String(i + 1).padStart(2, '0')}/2026`)
      expect(symptoms(year)).toEqual([])
    })

    it('stays quiet on a handful of rows, where a span cannot be established', () => {
      expect(symptoms(['01/05/2026', '02/05/2026'])).toEqual([])
    })
  })

  it('honours the chosen format when deciding what parsed', () => {
    // 05/11 is 5 November read as DD/MM, 11 May read as MM/DD. Neither is a
    // finding — the point is that the audit uses the user's choice.
    expect(auditDateColumn(clean(), 'MM/DD/YYYY').findings).toEqual([])
  })

  it('orders findings with the certain failures first', () => {
    const cells = [...clean(), 'not a date', 2026, '2026', '5-Jan', '01/05/2019']
    expect(symptoms(cells)).toEqual([
      'unparsed', 'year-as-serial', 'bare-year', 'missing-year', 'out-of-range',
    ])
  })
})
