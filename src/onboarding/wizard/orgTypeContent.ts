export type OrgType = 'church' | 'ngo' | 'school' | 'project'

export interface OrgTypeContent {
  label: string
  tagline: string
  teamRoleLabel: string
  departmentStarters: string[]
  departmentPlaceholder: string
  incomeTypeStarters: string[]
  incomeTypePlaceholder: string
  outflowTypeStarters: string[]
  outflowTypePlaceholder: string
  categoryStarters: string[]
}

export const ORG_TYPE_CONTENT: Record<OrgType, OrgTypeContent> = {
  church: {
    label: 'Church / Faith Community',
    tagline: 'Worship communities, congregations, and faith-based groups',
    teamRoleLabel: 'treasurer, accountant, or pastor',
    departmentStarters: ['Youth Ministry', 'Administration', 'Choir', "Women's Fellowship", 'Ushering'],
    departmentPlaceholder: 'e.g. Youth Ministry, Choir, Administration…',
    incomeTypeStarters: ['Tithes', 'Sunday Offering', 'Midweek Offering', 'Donations', 'Building Levy'],
    incomeTypePlaceholder: 'e.g. Tithes, Offerings, Donations…',
    outflowTypeStarters: ['Salaries', 'Utilities', 'Outreach', 'Events', 'Maintenance'],
    outflowTypePlaceholder: 'e.g. Salaries, Utilities, Outreach…',
    categoryStarters: ['General Fund', 'Building Fund', 'Welfare', 'Missions', 'Youth Fund', 'Special Projects'],
  },
  ngo: {
    label: 'NGO / Non-Profit',
    tagline: 'Humanitarian, advocacy, and development organisations',
    teamRoleLabel: 'treasurer, finance officer, or program director',
    departmentStarters: ['Programs', 'Finance', 'Field Operations', 'Admin', 'Monitoring & Evaluation'],
    departmentPlaceholder: 'e.g. Programs, Field Operations, Admin…',
    incomeTypeStarters: ['Grants', 'Donor Contributions', 'Government Funding', 'Fundraising Events', 'Membership Dues'],
    incomeTypePlaceholder: 'e.g. Grants, Donor Contributions, Fundraising…',
    outflowTypeStarters: ['Field Operations', 'Staff Costs', 'Administration', 'Travel', 'Supplies & Equipment'],
    outflowTypePlaceholder: 'e.g. Field Operations, Staff Costs, Travel…',
    categoryStarters: ['General Fund', 'Programs', 'Field Work', 'Welfare & Relief', 'Reserve Fund', 'Special Projects'],
  },
  school: {
    label: 'School / Institution',
    tagline: 'Schools, colleges, training centres, and academies',
    teamRoleLabel: 'bursar, accountant, or administrator',
    departmentStarters: ['Academic', 'Administration', 'Sports', 'Library', 'ICT & Facilities'],
    departmentPlaceholder: 'e.g. Academic, Administration, Sports…',
    incomeTypeStarters: ['School Fees', 'Grants', 'Bursaries', 'Boarding Fees', 'Uniform & Book Sales'],
    incomeTypePlaceholder: 'e.g. School Fees, Grants, Boarding Fees…',
    outflowTypeStarters: ['Staff Salaries', 'Facilities & Maintenance', 'Learning Materials', 'Utilities', 'Events'],
    outflowTypePlaceholder: 'e.g. Staff Salaries, Materials, Utilities…',
    categoryStarters: ['General Fund', 'Bursary', 'Facilities', 'Sports & Activities', 'Development', 'Reserve Fund'],
  },
  project: {
    label: 'Project-Based Organisation',
    tagline: 'Construction, consulting, creative, and contract-based work',
    teamRoleLabel: 'project accountant, finance officer, or director',
    departmentStarters: ['Engineering / Technical', 'Finance', 'Procurement', 'Operations', 'Admin'],
    departmentPlaceholder: 'e.g. Engineering, Procurement, Operations…',
    incomeTypeStarters: ['Client Payments', 'Grants', 'Retainers', 'Milestone Payments', 'Contract Fees'],
    incomeTypePlaceholder: 'e.g. Client Payments, Milestone Payments…',
    outflowTypeStarters: ['Labour', 'Materials', 'Equipment', 'Logistics', 'Subcontractors'],
    outflowTypePlaceholder: 'e.g. Labour, Materials, Logistics…',
    categoryStarters: ['Project Fund', 'Operations', 'Contingency', 'Equipment', 'Working Capital', 'Special Projects'],
  },
}

export const DEFAULT_ORG_TYPE_CONTENT: OrgTypeContent = {
  label: '',
  tagline: '',
  teamRoleLabel: 'treasurer, accountant, or director',
  departmentStarters: ['Finance', 'Operations', 'Programs', 'Field Teams', 'Administration'],
  departmentPlaceholder: 'e.g. Finance, Operations, Programs…',
  incomeTypeStarters: ['Donations', 'Grants', 'Membership Dues', 'Fundraising Events', 'Government Funding'],
  incomeTypePlaceholder: 'e.g. Donations, Grants, Membership Dues…',
  outflowTypeStarters: ['Staff Salaries', 'Utilities', 'Operations', 'Field Work', 'Supplies'],
  outflowTypePlaceholder: 'e.g. Staff Salaries, Utilities, Operations…',
  categoryStarters: ['General Fund', 'Operations', 'Programs', 'Welfare & Relief', 'Field Work', 'Reserve Fund'],
}

export function getOrgTypeContent(orgType: string | null | undefined): OrgTypeContent {
  if (orgType && orgType in ORG_TYPE_CONTENT) {
    return ORG_TYPE_CONTENT[orgType as OrgType]
  }
  return DEFAULT_ORG_TYPE_CONTENT
}
