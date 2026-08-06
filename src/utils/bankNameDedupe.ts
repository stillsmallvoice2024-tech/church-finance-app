// Bank names are unique per organisation (banks_org_name_unique). The database
// is the authority, but a raw 23505 is a poor way to learn that — and simply
// rejecting the name is wrong too, because "two accounts at the same bank" is a
// normal thing for a church to have.
//
// So the UI asks for a differentiator first, and falls back to appending
// " - 1", " - 2", … when the user doesn't supply one.

// Mirrors public.normalize_bank_name: case- and whitespace-insensitive.
export function normalizeBankName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function bankNameExists(name: string, existingNames: string[]): boolean {
  const target = normalizeBankName(name)
  if (!target) return false
  return existingNames.some(n => normalizeBankName(n) === target)
}

/**
 * Smallest free "<base> - N" (N starting at 1) that no existing bank holds.
 *
 * Counting suffixes rather than reusing the group size matters when a bank has
 * been deleted: with "GTBank" and "GTBank - 2" present, the group size is 2 and
 * would suggest the already-taken "GTBank - 2".
 */
export function nextAvailableBankName(base: string, existingNames: string[]): string {
  const trimmed = base.replace(/\s+/g, ' ').trim()
  let n = 1
  while (bankNameExists(`${trimmed} - ${n}`, existingNames)) n++
  return `${trimmed} - ${n}`
}
