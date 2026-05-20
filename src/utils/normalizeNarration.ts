import { normalizeId } from './normalizeId'

// Matches leading bank routing prefixes like "NIP/", "USSD/VFD/", "FIP/NIP/"
const BANK_PREFIX_RE = /^(?:[A-Z]{2,8}\/)+/

export function normalizeNarration(raw: string | null | undefined): string {
  if (!raw?.trim()) return ''
  let s = normalizeId(raw)
  s = s.replace(BANK_PREFIX_RE, '')
  s = s.replace(/\s{2,}/g, ' ').trim()
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
