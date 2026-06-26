import type { UserRole } from '../types'

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  accountant: 'Accountant',
  auditor: 'Auditor',
  viewer: 'Viewer',
}

export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-primary-100 text-primary',
  accountant: 'bg-accent-light text-accent',
  auditor: 'bg-teal-100 text-teal-700',
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
