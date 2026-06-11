import type { EmptyStateDefinition } from '../../types/onboarding'

/**
 * Empty-state definitions keyed by pageId.
 * Phase 6 wires these into page components.
 * iconName values are Lucide icon names resolved in the component layer.
 */
export const EMPTY_STATES: EmptyStateDefinition[] = [
  {
    pageId: 'inflows',
    iconName: 'ArrowDownCircle',
    title: 'No income recorded yet',
    description: 'Income appears here after you import a bank statement. Each transaction is automatically matched to its bank and category.',
    action: { label: 'Import a Statement', href: '/import' },
  },
  {
    pageId: 'outflows',
    iconName: 'ArrowUpCircle',
    title: 'No expenses recorded yet',
    description: 'Expenses appear here after you import a bank statement. Each transaction is automatically matched to its bank and category.',
    action: { label: 'Import a Statement', href: '/import' },
  },
  {
    pageId: 'bank-ledger',
    iconName: 'Landmark',
    title: 'No bank accounts yet',
    description: 'Bank accounts appear here once transactions with a bank name are recorded. Add your first bank in Setup to get started.',
    action: { label: 'Go to Setup', href: '/setup' },
  },
  {
    pageId: 'categories',
    iconName: 'Tag',
    title: 'No categories yet',
    description: 'Create income and outflow types to classify your transactions.',
    action: { label: 'Add Category', href: '/setup' },
  },
  {
    pageId: 'reports',
    iconName: 'BarChart2',
    title: 'No data to report',
    description:
      'Import some transactions first, then return here to generate financial reports.',
    action: { label: 'Import Statement', href: '/import' },
  },
  {
    pageId: 'users',
    iconName: 'Users',
    title: 'No team members yet',
    description: 'Invite your finance team to give them access to this organisation.',
    action: { label: 'Invite Member', href: '/users' },
  },
  {
    pageId: 'import',
    iconName: 'Upload',
    title: 'No statements imported yet',
    description:
      'Upload a bank statement to import transactions automatically. Excel and CSV files are supported.',
  },
  {
    pageId: 'receipts',
    iconName: 'Receipt',
    title: 'No receipts yet',
    description: 'Receipts attached to transactions will appear here.',
  },
  {
    pageId: 'refunds',
    iconName: 'RotateCcw',
    title: 'No refunds recorded',
    description: 'Refund transactions will appear here once recorded.',
  },
  {
    pageId: 'reversals',
    iconName: 'CornerUpLeft',
    title: 'No reversals recorded',
    description: 'Reversed transactions will appear here once recorded.',
  },
  {
    pageId: 'bank-deposits',
    iconName: 'Banknote',
    title: 'No bank deposits yet',
    description: 'Record a bank deposit to track cash or cheque lodgements.',
  },
  {
    pageId: 'intrabank-transfers',
    iconName: 'ArrowLeftRight',
    title: 'No intra-bank transfers yet',
    description: 'Record transfers between your own accounts here.',
  },
  {
    pageId: 'savings-portions',
    iconName: 'PiggyBank',
    title: 'No savings funds yet',
    description: 'Savings fund balances build up automatically as inflows are distributed. Set up a distribution rule that includes a savings share to get started.',
  },
  {
    pageId: 'specific-givings',
    iconName: 'Gift',
    title: 'No designated gifts yet',
    description: 'Gifts given for a specific purpose — like a building project or mission — will appear here once recorded.',
  },
]

const EMPTY_STATE_MAP = new Map<string, EmptyStateDefinition>(
  EMPTY_STATES.map((e) => [e.pageId, e]),
)

export function getEmptyState(pageId: string): EmptyStateDefinition | undefined {
  return EMPTY_STATE_MAP.get(pageId)
}
