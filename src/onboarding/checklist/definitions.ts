import type { ChecklistItem } from '../../types/onboarding'

/**
 * Checklist items in display order.
 * completionCheck receives live data from Supabase — no manual tracking.
 * iconName values are Lucide icon names resolved in the component layer.
 */
export const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'create-department',
    label: 'Create a department',
    description: 'Add your first team, unit, or department',
    iconName: 'Building2',
    required: true,
    completionCheck: (d) => d.hasDepartments,
    action: { label: 'Go to Setup', href: '/settings?tab=setup' },
  },
  {
    id: 'add-bank-account',
    label: 'Add a bank account',
    description: 'Register the bank accounts your organisation uses',
    iconName: 'Landmark',
    required: true,
    completionCheck: (d) => d.hasBankAccounts,
    action: { label: 'Go to Setup', href: '/settings?tab=setup' },
  },
  {
    id: 'create-income-type',
    label: 'Create an income type',
    description: 'Add labels for your inflows (e.g. Donations, Grants, Membership Dues)',
    iconName: 'ArrowDownCircle',
    required: true,
    completionCheck: (d) => d.hasIncomeTypes,
    action: { label: 'Go to Setup', href: '/settings?tab=setup' },
  },
  {
    id: 'create-outflow-type',
    label: 'Create an outflow type',
    description: 'Add categories for your expenditure (e.g. Salaries, Utilities)',
    iconName: 'ArrowUpCircle',
    required: true,
    completionCheck: (d) => d.hasOutflowTypes,
    action: { label: 'Go to Setup', href: '/settings?tab=setup' },
  },
  {
    id: 'create-category',
    label: 'Set up your funds',
    description: 'Create the funds your organisation manages (e.g. General Fund, Programs, Field Work)',
    iconName: 'Tag',
    required: true,
    completionCheck: (d) => d.hasCategories,
    action: { label: 'Go to Categories', href: '/categories' },
  },
  {
    id: 'import-statement',
    label: 'Import your first statement',
    description: 'Upload a bank statement to bring in your transactions',
    iconName: 'Upload',
    required: false,
    completionCheck: (d) => d.hasImportedStatement,
    action: { label: 'Go to Import', href: '/import' },
  },
  {
    id: 'invite-member',
    label: 'Invite a team member',
    description: 'Give your team access to the finance records',
    iconName: 'UserPlus',
    required: false,
    completionCheck: (d) => d.hasInvitedMember,
    action: { label: 'Go to Team Members', href: '/users' },
  },
]
