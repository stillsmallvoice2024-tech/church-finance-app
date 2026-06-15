import type { WizardStepDefinition } from '../../types/onboarding'

export const WIZARD_STEPS: WizardStepDefinition[] = [
  {
    id: 'org-details',
    title: 'Organisation Details',
    description: 'Confirm your organisation name and set a default currency.',
    estimatedMinutes: 1,
    required: true,
    skippable: false,
  },
  {
    id: 'departments',
    title: 'Departments & Units',
    description: 'Add the ministry departments or teams in your organisation.',
    estimatedMinutes: 2,
    required: true,
    skippable: false,
  },
  {
    id: 'banks',
    title: 'Bank Accounts',
    description: 'Register every bank account your organisation uses.',
    estimatedMinutes: 2,
    required: true,
    skippable: false,
  },
  {
    id: 'income-types',
    title: 'Income Types',
    description: 'Create categories for your inflows — tithes, offerings, donations, etc.',
    estimatedMinutes: 2,
    required: true,
    skippable: false,
  },
  {
    id: 'outflow-types',
    title: 'Outflow Types',
    description: 'Create categories for your expenditure — salaries, utilities, events, etc.',
    estimatedMinutes: 2,
    required: true,
    skippable: false,
  },
  {
    id: 'categories',
    title: 'Funds',
    description: 'Set up the funds or pots your church manages — General Fund, Building Fund, Welfare, etc.',
    estimatedMinutes: 2,
    required: true,
    skippable: false,
  },
  {
    id: 'team-members',
    title: 'Team Members',
    description: 'Invite your finance team and assign them appropriate roles.',
    estimatedMinutes: 3,
    required: false,
    skippable: true,
  },
  {
    id: 'import-statement',
    title: 'Import First Statement',
    description: 'Upload your first bank statement to populate your transaction history.',
    estimatedMinutes: 5,
    required: false,
    skippable: true,
  },
  {
    id: 'finish',
    title: 'You\'re All Set!',
    description: 'Your organisation is ready. Here\'s what to explore next.',
    estimatedMinutes: 0,
    required: false,
    skippable: false,
  },
]

export const WIZARD_TOTAL_MINUTES = WIZARD_STEPS.reduce(
  (sum, s) => sum + s.estimatedMinutes,
  0,
)
