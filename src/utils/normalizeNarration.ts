import { normalizeId } from './normalizeId'

// ── Rule types ────────────────────────────────────────────────────────────────

type NarrationRule = (s: string) => string

// ── Rules ─────────────────────────────────────────────────────────────────────

// Matches leading bank routing prefixes: "NIP/", "USSD/VFD/", "FIP/NIP/", etc.
const BANK_PREFIX_RE = /^(?:[A-Z]{2,8}\/)+/

function stripInvisibleChars(s: string): string {
  return normalizeId(s)
}

function stripBankPrefixes(s: string): string {
  return s.replace(BANK_PREFIX_RE, '')
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s{2,}/g, ' ').trim()
}

function normalizeCasing(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

const RULES: NarrationRule[] = [
  stripInvisibleChars,
  stripBankPrefixes,
  collapseWhitespace,
  normalizeCasing,
]

// ── Public API ────────────────────────────────────────────────────────────────

// Produces a clean display_description from raw bank narration.
// NEVER used for duplicate detection, reconciliation, or audit matching —
// those paths must use raw bank_description / description fields directly.
export function normalizeNarration(raw: string | null | undefined): string {
  if (!raw?.trim()) return ''
  let s = raw
  for (const rule of RULES) {
    s = rule(s)
    if (!s) return ''
  }
  return s
}
