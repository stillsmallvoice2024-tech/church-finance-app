import { describe, it, expect } from 'vitest'
import { normalizeBankName, bankNameExists, nextAvailableBankName } from '../bankNameDedupe'

describe('normalizeBankName', () => {
  it('is case- and whitespace-insensitive, matching public.normalize_bank_name', () => {
    expect(normalizeBankName('  GT  Bank ')).toBe('gt bank')
    expect(normalizeBankName('GTBank')).toBe(normalizeBankName('gtbank'))
  })
})

describe('bankNameExists', () => {
  it('matches regardless of case and internal spacing', () => {
    expect(bankNameExists('gtbank', ['GTBank'])).toBe(true)
    expect(bankNameExists('GT  Bank', ['gt bank'])).toBe(true)
  })

  it('does not match a different bank', () => {
    expect(bankNameExists('Access Bank', ['GTBank'])).toBe(false)
  })

  it('treats a blank name as no conflict — the form rejects it separately', () => {
    expect(bankNameExists('   ', ['GTBank'])).toBe(false)
  })
})

describe('nextAvailableBankName', () => {
  it('appends " - 1" for the first collision', () => {
    expect(nextAvailableBankName('GTBank', ['GTBank'])).toBe('GTBank - 1')
  })

  it('increments past suffixes already in use', () => {
    expect(nextAvailableBankName('GTBank', ['GTBank', 'GTBank - 1', 'GTBank - 2']))
      .toBe('GTBank - 3')
  })

  // A deleted bank leaves a gap: group size would suggest an already-taken name.
  it('fills the lowest free suffix rather than counting the group', () => {
    expect(nextAvailableBankName('GTBank', ['GTBank', 'GTBank - 2'])).toBe('GTBank - 1')
  })

  it('ignores case when checking whether a suffix is taken', () => {
    expect(nextAvailableBankName('GTBank', ['GTBank', 'gtbank - 1'])).toBe('GTBank - 2')
  })

  it('collapses whitespace in the base name', () => {
    expect(nextAvailableBankName('  GT  Bank  ', ['GT Bank'])).toBe('GT Bank - 1')
  })
})
