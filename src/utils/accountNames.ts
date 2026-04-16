// Mirrors the rows in supabase/seed.sql — used for dropdowns and display labels.

export interface AccountEntry {
  code: string
  name: string
  category: 'income' | 'expense' | 'savings' | 'ministry' | 'special' | 'foreign'
}

export const ACCOUNT_NAMES: AccountEntry[] = [
  { code: '1',   name: 'Tithe Account',                   category: 'income'   },
  { code: '2',   name: 'Tithe Account 2',                  category: 'income'   },
  { code: '3',   name: 'Rentals, Transport & Imprest',      category: 'expense'  },
  { code: '5',   name: 'Maintenance',                       category: 'expense'  },
  { code: '6',   name: 'Crusades',                          category: 'expense'  },
  { code: '10',  name: 'Fuel',                              category: 'expense'  },
  { code: '12',  name: 'Dominion Convention',               category: 'expense'  },
  { code: '13',  name: 'Supernatural Life Conference',      category: 'expense'  },
  { code: '14',  name: 'Heart Enlargement Speciale',        category: 'expense'  },
  { code: '15',  name: 'Prosperity Convention',             category: 'expense'  },
  { code: '20',  name: 'Monthly Savings',                   category: 'savings'  },
  { code: '25',  name: 'Capital Project',                   category: 'savings'  },
  { code: '29',  name: 'General Inflow',                    category: 'income'   },
  { code: '33',  name: 'Welfare & Givings',                 category: 'expense'  },
  { code: '35',  name: 'Allowances',                        category: 'expense'  },
  { code: '42',  name: 'Publicity & Subscriptions',         category: 'expense'  },
  { code: '45',  name: 'Workers Trust Fund',                category: 'savings'  },
  { code: '50',  name: 'Heart Enlargement Ministry (HEM)',  category: 'ministry' },
  { code: '51',  name: 'HEM Lagos',                         category: 'ministry' },
  { code: '60',  name: 'Available Investment',              category: 'savings'  },
  { code: '100', name: 'Prophets Seed',                     category: 'special'  },
  { code: '200', name: 'Zonal Crusades',                    category: 'ministry' },
]

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
