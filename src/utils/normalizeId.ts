// Strips invisible Unicode characters (soft hyphen U+00AD, NBSP U+00A0,
// zero-width U+200B–U+200D, line/para separators U+2028–U+2029, BOM U+FEFF),
// applies NFC normalization, collapses whitespace, and trims.
// Case is preserved — bank-provided transaction IDs are case-sensitive.
export function normalizeId(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\u00ad|\u00a0|\u200b|\u200c|\u200d|\u2028|\u2029|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
