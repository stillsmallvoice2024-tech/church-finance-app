export interface AccountEntry {
  code: string
  name: string
  category: 'income' | 'expense' | 'savings' | 'ministry' | 'special' | 'foreign'
}

export const ACCOUNT_NAMES: AccountEntry[] = []

/** O(1) code → name lookup */
export const ACCOUNT_NAME_MAP = new Map<string, string>(
  ACCOUNT_NAMES.map(a => [a.code, a.name]),
)

/** Returns "35 — Allowances" or just the code if unknown, or "—" for null. */
export function accountLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const name = ACCOUNT_NAME_MAP.get(code)
  return name ? `${code} — ${name}` : code
}
