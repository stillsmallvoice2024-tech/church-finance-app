import type { UserRole } from '../types'

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  accountant: 'Accountant',
  viewer: 'Viewer',
}

export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-primary-100 text-primary',
  accountant: 'bg-accent-light text-accent',
  viewer: 'bg-gray-100 text-gray-600',
}


export const INFLOW_CATEGORIES = [
  'Tithes',
  'Offerings',
  'Donations',
  'Special Collections',
  'Project Contributions',
  'Bank Interest',
  'Other Income',
]

export const OUTFLOW_CATEGORIES = [
  'Salaries',
  'Utilities',
  'Rent / Lease',
  'Ministry Activities',
  'Outreach',
  'Maintenance',
  'Equipment',
  'Office Supplies',
  'Travel',
  'Other Expenses',
]

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'foreign', label: 'Foreign Currency' },
  { value: 'special', label: 'Special Project' },
]

// ── Budget portions (stage_code_2) ────────────────────────────────────────────
//
// The stored values are historical (`Percentage Allocation`, `Specific Seed`)
// and MUST NOT change — they are written to inflow/outflow rows and read by the
// allocation engine and reports. Only the labels are current.
//
// The same value→label mapping was previously copy-pasted into AddIntraFlowModal,
// BulkEditIntraFlowModal, BulkEditOutflowModal, AddBankModal and Categories;
// the import wizard shipped a sixth copy that showed the raw values instead.
export const BUDGET_PORTIONS = [
  { value: 'Percentage Allocation', label: 'Regular Funds'   },
  { value: 'Specific Seed',         label: 'Designated Gift' },
  { value: 'Savings',               label: 'Savings'         },
] as const

export const BUDGET_PORTION_LABELS: Record<string, string> =
  Object.fromEntries(BUDGET_PORTIONS.map(p => [p.value, p.label]))
