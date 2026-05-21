import { normalizeId } from './normalizeId'

// ── Types ─────────────────────────────────────────────────────────────────────

type NarrationRule = (s: string) => string

// ── Helpers ───────────────────────────────────────────────────────────────────

// Title-cases a string: "SHOPRITE IKEJA" → "Shoprite Ikeja"
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/(?:^|[\s/])\S/g, c => c.toUpperCase())
}

// ── Slash-segment extraction ──────────────────────────────────────────────────
// When the first slash-segment is a known channel prefix, strip it and
// strip the last segment if it looks like a reference token.
//
// "TRF MOBILE/Fuel 30/Bvshrjrb"            → "Fuel 30"
// "USSD TRANSFER/Shoprite Ikeja/993828"     → "Shoprite Ikeja"
// "APP PAYMENT/DSTV Subscription/REF88281"  → "DSTV Subscription"
// "School Fees/May Session"                 → unchanged (no channel prefix)

const SLASH_CHANNEL_PREFIX_RE = /^(?:TRF|USSD|APP|WEB|MOB(?:ILE)?|NIP|FIP)\b/i

function extractSlashSegments(s: string): string {
  if (!s.includes('/')) return s
  const parts = s.split('/').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return s
  // Only proceed if the first segment is a recognised channel prefix
  if (!SLASH_CHANNEL_PREFIX_RE.test(parts[0])) return s

  // Strip first (channel) segment; strip last segment if 3+ parts (assumed reference)
  const middle = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1)
  return middle.length > 0 ? middle.join(' / ') : s
}

// ── VAT / COMM prefix extraction ──────────────────────────────────────────────
// Detects VAT or COMMISSION as a logical prefix and returns the label + remainder.
//
// "VAT ON NIP TRANSFER TO JOHN DOE"        → { label: 'VAT',  remainder: 'NIP TRANSFER TO JOHN DOE' }
// "COMMISSION FOR NIP TRANSFER TO JOHN"    → { label: 'COMM', remainder: 'NIP TRANSFER TO JOHN' }
// "VAT - To Gtb/Fuel Purchase/John Doe"    → { label: 'VAT',  remainder: 'To Gtb/Fuel Purchase/John Doe' }
// "COMM - To pay/Volunteers Tag/Alice A."  → { label: 'COMM', remainder: 'To pay/Volunteers Tag/Alice A.' }

function extractSpecialPrefix(s: string): { label: string; remainder: string } | null {
  if (/^VAT\b/i.test(s)) {
    return {
      label: 'VAT',
      // handles "VAT ON …", "VAT FOR …", and "VAT - …" separator formats
      remainder: s.replace(/^VAT(?:\s*-\s*|\s+(?:ON|FOR|FROM|CHARGE[SD]?)?\s*)/i, '').trim(),
    }
  }
  if (/^COMM(?:ISSION)?\b/i.test(s)) {
    return {
      label: 'COMM',
      // handles "COMM ON …", "COMMISSION FOR …", and "COMM - …" separator formats
      remainder: s.replace(/^COMM(?:ISSION)?(?:\s*-\s*|\s+(?:ON|FOR|FROM|CHARGE[SD]?)?\s*)/i, '').trim(),
    }
  }
  return null
}

// ── Transfer pattern ──────────────────────────────────────────────────────────
// Detects NIP / TRF / TRANSFER narrations and extracts the target name.
//
// "NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL"  → "Transfer - John Doe"
// "MOB NIP TRF TO GTB JOHN REF:992883"             → "Transfer - GTB John"
// "TRANSFER TO JOHN DOE"                           → "Transfer - John Doe"

const TRANSFER_KEYWORD_RE = /\b(?:TRANSFER|TRF)\b/i
// Captures the name after TO, stopping before a noise keyword or end of string
const TO_NAME_RE = /\bTO\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s+(?:REF[#:\s]?\S*|\d{5,}|SUCCESSFUL|FAILED|SESSION|STAN|TRACE|RRN|TID|ACCT|CHANNEL|VIA)|\s*$)/i

function matchTransferPattern(s: string): string | null {
  if (!TRANSFER_KEYWORD_RE.test(s)) return null
  const m = s.match(TO_NAME_RE)
  if (!m) return null
  return `Transfer - ${toTitleCase(m[1].trim())}`
}

// ── POS pattern ───────────────────────────────────────────────────────────────
// "POS PAYMT SHOPRITE IKEJA TERMINAL 22391"   → "POS - Shoprite Ikeja"
// "POS PURCHASE DOMINOS PIZZA"                → "POS - Dominos Pizza"

const POS_PREFIX_RE = /^POS\s+(?:PAYMT|PAYMENT|PMT|TRANS(?:ACTION)?|PURCHASE|DEBIT)?\s*/i
const POS_TRAILING_RE = /\s+(?:TERMINAL|TID|RRN|STAN|REF|TRACE|ACCT)(?:\s+\S+)?\s*$/gi

function matchPosPattern(s: string): string | null {
  if (!/^POS\b/i.test(s)) return null
  const merchant = s
    .replace(POS_PREFIX_RE, '')
    .replace(POS_TRAILING_RE, '')
    .trim()
  return merchant ? `POS - ${toTitleCase(merchant)}` : 'POS'
}

// ── Trailing noise strips ──────────────────────────────────────────────────────
// Iteratively removes known noise suffixes:
// SUCCESSFUL, FAILED, SESSION ID xxxxx, REF xxx, STAN/TRACE/RRN/TID/ACCT codes,
// bare long numbers (reference IDs ≥ 6 digits).

const TRAILING_NOISE_RES: RegExp[] = [
  /\s+SUCCESSFUL\s*$/i,
  /\s+FAILED\s*$/i,
  /\s+SESSION\s+ID[:\s]*\S*\s*$/i,
  /\s+REF(?:ERENCE)?[#:\s]?\S+\s*$/i,
  /\s+TRACE\s*\d+\s*$/i,
  /\s+STAN\s*\d+\s*$/i,
  /\s+RRN\s*\S+\s*$/i,
  /\s+TID\s*\S+\s*$/i,
  /\s+ACCT\s*\S+\s*$/i,
  /\s+\d{6,}\s*$/,
]

function stripTrailingNoise(s: string): string {
  let prev = ''
  while (prev !== s) {
    prev = s
    for (const re of TRAILING_NOISE_RES) s = s.replace(re, '')
  }
  return s.trim()
}

// ── Leading keyword strips ────────────────────────────────────────────────────
// Iteratively removes standalone channel/routing words from the start.
// Applied ONLY after pattern matching fails (transfer/POS patterns run first).

const LEADING_KEYWORD_RE = /^(?:NIP|MOB(?:ILE)?|USSD|APP|WEB|TRF|TRANSFER|BANK|ALERT|NOTIFY|CHANNEL|TXN|TRANSACTION)\s+/i

function stripLeadingKeywords(s: string): string {
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(LEADING_KEYWORD_RE, '')
  }
  return s.trim()
}

// ── Semantic slash-segment extractor ─────────────────────────────────────────
// For slash-separated narrations that contain a leading transfer/channel prefix
// ("To pay", "To Gtb", "To Opay", "To Kuda", etc.) and/or a trailing
// payee/beneficiary name.
//
// Rules:
//   1. If the first segment is "To <word>" (routing label), strip it.
//   2. If a prefix was stripped AND ≥2 segments remain AND the last segment
//      looks like a person/beneficiary name, strip the last segment too.
//   3. Plain slash narrations with no routing prefix are returned unchanged
//      (safety rule — "School Fees/May Session" must not be modified).
//
// Examples:
//   "To pay/Volunteers Tag - God-encounters Benin/Alice Oyepeju Adeoti"
//     → "Volunteers Tag - God-encounters Benin"
//   "To Gtb/Fuel Purchase/John Doe"       → "Fuel Purchase"
//   "To Opay/Monthly Salary/Chinedu Okafor" → "Monthly Salary"
//   "To Gtb/Monthly Salary"               → "Monthly Salary"  (2 parts, no trailing strip)
//   "To pay/Church Tithes"                → "Church Tithes"
//   "School Fees/May Session"             → "School Fees/May Session"  (no prefix → untouched)

// Any segment that is "To" followed by exactly one word — routing/channel label
// Covers: To pay, To Gtb, To Opay, To PalmPay, To Kuda, To Moniepoint,
//         To Access, To Uba, To Zenith, To Firstbank, To Sterling, To Fidelity
const TRANSFER_ROUTING_PREFIX_RE = /^to\s+\S+$/i

// Heuristic: 2–5 space-separated tokens each starting with an uppercase letter,
// no digits. Matches personal names ("Alice Oyepeju Adeoti", "John Doe") and
// entity names ("Adebayo Enterprises Ltd").
function looksLikePersonOrBeneficiary(s: string): boolean {
if (!s || /\d/.test(s)) return false

const words = s.trim().split(/\s+/)
if (words.length < 2 || words.length > 5) return false

// Strong business/activity keywords → NOT a beneficiary
const BUSINESS_HINTS = [
'fuel',
'purchase',
'subscription',
'salary',
'school',
'fees',
'tag',
'event',
'church',
'tithes',
'offering',
'rent',
'invoice',
'payment',
'shop',
'supermarket',
'ikeja',
'benin',
'conference',
'donation',
]

const lower = s.toLowerCase()

if (BUSINESS_HINTS.some(k => lower.includes(k))) {
return false
}

// Personal-name heuristic:
// 2–4 words
// mostly alphabetic
// each starts uppercase
// avoids slash/business phrases
return words.every(w => /^[A-Z][a-z'.-]+$/.test(w))
}

function extractSemanticSlashSegment(s: string): string {
  if (!s.includes('/')) return s
  const parts = s.split('/').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return s

  const hasTransferPrefix = TRANSFER_ROUTING_PREFIX_RE.test(parts[0])
  const start = hasTransferPrefix ? 1 : 0
  if (start >= parts.length) return s

  const remaining = parts.slice(start)

  // Only strip trailing payee when a transfer prefix was present,
  // at least 2 segments remain, and the last looks like a person/beneficiary.
  if (
    hasTransferPrefix &&
    remaining.length > 1 &&
    looksLikePersonOrBeneficiary(remaining[remaining.length - 1])
  ) {
    remaining.pop()
  }

  return remaining.length > 0 ? remaining.join(' - ') : s
}

// ── Target extractor (for use inside VAT / COMM context) ─────────────────────
// Returns just the merchant/person name without a "Transfer -" or "POS -" prefix,
// because the outer label (VAT / COMM) already provides that structure.
//
// "NIP TRANSFER TO JOHN DOE" → "John Doe"
// "POS PAYMT SHOPRITE"       → "Shoprite"
// "To pay/Volunteers Tag - God-encounters Benin/Alice Oyepeju Adeoti"
//                            → "Volunteers Tag - God-encounters Benin"

function extractTargetName(s: string): string {
  // Handle slash patterns: strip routing prefix and trailing payee/beneficiary
  s = extractSemanticSlashSegment(s)

  if (TRANSFER_KEYWORD_RE.test(s)) {
    const m = s.match(TO_NAME_RE)
    if (m) return toTitleCase(m[1].trim())
  }
  if (/^POS\b/i.test(s)) {
    const merchant = s.replace(POS_PREFIX_RE, '').replace(POS_TRAILING_RE, '').trim()
    return toTitleCase(merchant)
  }
  let t = stripTrailingNoise(s)
  t = stripLeadingKeywords(t)
  t = t.replace(/\s{2,}/g, ' ').trim()
  return t || s  // preserve original casing if it's already clean
}

// ── Core normalization (after special-prefix extraction) ──────────────────────

function cleanCoreNarration(s: string): string {
  // Transfer pattern takes priority — returns "Transfer - Name" if matched
  const transfer = matchTransferPattern(s)
  if (transfer) return transfer

  // POS pattern — returns "POS - Merchant" if matched
  const pos = matchPosPattern(s)
  if (pos) return pos

  // General cleanup path
  s = stripTrailingNoise(s)
  s = stripLeadingKeywords(s)
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s ? toTitleCase(s) : ''
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
//
// Examples (raw → display_description):
//   "NIP TRANSFER TO JOHN DOE REF 48291 SUCCESSFUL"                         → "Transfer - John Doe"
//   "POS PAYMT SHOPRITE IKEJA TERMINAL 22391"                               → "POS - Shoprite Ikeja"
//   "MOB NIP TRF TO GTB JOHN REF:992883"                                    → "Transfer - GTB John"
//   "VAT ON NIP TRANSFER TO JOHN DOE"                                       → "VAT - John Doe"
//   "VAT ON POS PAYMT SHOPRITE"                                             → "VAT - Shoprite"
//   "COMMISSION ON TRANSFER TO JANE"                                        → "COMM - Jane"
//   "COMMISSION FOR NIP TRANSFER TO JOHN"                                   → "COMM - John"
//   "COMMISSION ON To pay/Volunteers Tag - God-encounters Benin/Alice A."   → "COMM - Volunteers Tag - God-encounters Benin"
//   "VAT ON To Gtb/Monthly Salary/REF123"                                   → "VAT - Monthly Salary"
//   "COMM - To pay/Volunteers Tag - God-encounters Benin/Alice Oyepeju Adeoti" → "COMM - Volunteers Tag - God-encounters Benin"
//   "VAT - To Gtb/Fuel Purchase/John Doe"                                   → "VAT - Fuel Purchase"
//   "TRF MOBILE/Fuel 30/Bvshrjrb"                                          → "Fuel 30"
//   "USSD TRANSFER/Shoprite Ikeja/993828"                                   → "Shoprite Ikeja"
//   "APP PAYMENT/DSTV Subscription/REF88281"                               → "DSTV Subscription"
//   "School Fees/May Session"                                               → "School Fees/May Session"
//
// NEVER used for duplicate detection, reconciliation, or audit matching.
// All those paths must use raw description / bank_description fields directly.

export function normalizeNarration(raw: string | null | undefined): string {
  const fallback = raw?.trim() ?? ''
  if (!fallback) return ''

  let s = normalizeId(raw!)         // strip invisible chars, NFC, collapse whitespace
  if (!s) return fallback

  s = extractSlashSegments(s)        // "TRF MOBILE/Fuel 30/Hash" → "Fuel 30"

  const special = extractSpecialPrefix(s)
  if (special) {
    const target = extractTargetName(special.remainder)
    return (target ? `${special.label} - ${target}` : special.label) || fallback
  }

  return cleanCoreNarration(s) || fallback
}

// Exported individually for unit testing
export const _internal: Record<string, NarrationRule | ((s: string) => string | null)> = {
  extractSlashSegments,
  extractSemanticSlashSegment,
  cleanCoreNarration,
}
