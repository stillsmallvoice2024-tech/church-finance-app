// ── Page IDs ─────────────────────────────────────────────────────────────────
// One entry per route that can have a tour, empty state, or help article.
export type PageId =
  | 'dashboard'
  | 'inflows'
  | 'outflows'
  | 'categories'
  | 'foreign-currency'
  | 'intra-flow'
  | 'reports'
  | 'financial-report'
  | 'dynamic-reports'
  | 'settings'
  | 'pending-deductions'
  | 'import'
  | 'setup'
  | 'users'
  | 'change-log'
  | 'percentage-allocations'
  | 'specific-givings'
  | 'savings-portions'
  | 'category-ledger'
  | 'bank-ledger'
  | 'bank-deposits'
  | 'intrabank-transfers'
  | 'refunds'
  | 'reversals'
  | 'receipts'
  | 'reconciliation'

// ── Tour IDs ─────────────────────────────────────────────────────────────────
export type TourId =
  | 'dashboardTour'
  | 'banksTour'
  | 'inflowsTour'
  | 'outflowsTour'
  | 'importTour'
  | 'categoriesTour'
  | 'setupTour'
  | 'reportsTour'
  | 'settingsTour'
  | 'usersTour'
  | 'reconciliationTour'

// ── Tour Definitions ──────────────────────────────────────────────────────────
export type TourStepPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface TourStep {
  /** Unique within the tour. Used to track re-measure on step change. */
  id: string
  /**
   * CSS selector for the element to spotlight.
   * Convention: `[data-tour="<name>"]` attributes added to page elements in Phase 3.
   * When the element is not found the card falls back to centered.
   */
  target: string
  title: string
  content: string
  placement?: TourStepPlacement
  /** Extra padding around the spotlight cutout in px. Defaults to 8. */
  spotlightPadding?: number
}

export interface TourDefinition {
  id: TourId
  pageId: PageId
  title: string
  description: string
  steps: TourStep[]
}

// ── Help ──────────────────────────────────────────────────────────────────────
export type HelpCategory =
  | 'getting-started'
  | 'transactions'
  | 'banks'
  | 'categories'
  | 'reports'
  | 'settings'
  | 'import'
  | 'team'

export interface HelpArticle {
  id: string
  title: string
  summary: string
  /** Markdown body */
  content: string
  tags: string[]
  category: HelpCategory
  relatedPageId?: PageId
  updatedAt: string
}

export interface FAQEntry {
  id: string
  question: string
  /** Markdown answer */
  answer: string
  category: HelpCategory
  tags: string[]
}

export interface ReleaseNote {
  version: string
  date: string
  title: string
  highlights: string[]
  /** Optional extended markdown details */
  details?: string
}

// ── Checklist ─────────────────────────────────────────────────────────────────
/** Shape of real data fed to completionCheck functions. Populated from Supabase in Phase 2. */
export interface ChecklistData {
  hasDepartments: boolean
  hasBankAccounts: boolean
  hasIncomeTypes: boolean
  hasOutflowTypes: boolean
  hasCategories: boolean
  hasImportedStatement: boolean
  hasInvitedMember: boolean
}

export interface ChecklistItem {
  id: string
  label: string
  description?: string
  /** Lucide icon name resolved at render time via an icon map. */
  iconName: string
  required: boolean
  /** Pure function — returns true when this item is complete. */
  completionCheck: (data: ChecklistData) => boolean
  action: { label: string; href: string }
}

// ── Empty States ──────────────────────────────────────────────────────────────
export interface EmptyStateDefinition {
  pageId: PageId
  iconName: string
  title: string
  description: string
  action?: {
    label: string
    /** Navigation href (used by React Router Link) */
    href?: string
    /** Tour to launch when clicked */
    tourId?: TourId
  }
}

// ── Announcements ─────────────────────────────────────────────────────────────
export interface AnnouncementDefinition {
  /** Stable unique key, stored in user_preferences.announcements_read[] */
  id: string
  version: string
  date: string
  title: string
  summary: string
  /** Optional tour to launch from "Show me" button */
  tourId?: TourId
}

// ── Setup Wizard ──────────────────────────────────────────────────────────────
export type WizardStepId =
  | 'org-details'
  | 'org-type'
  | 'departments'
  | 'banks'
  | 'income-types'
  | 'outflow-types'
  | 'categories'
  | 'distribution-rules'
  | 'special-rules'
  | 'team-members'
  | 'import-statement'
  | 'finish'

export interface WizardStepDefinition {
  id: WizardStepId
  title: string
  description: string
  estimatedMinutes: number
  required: boolean
  /** Required steps cannot be skipped */
  skippable: boolean
}

// ── User Preferences ──────────────────────────────────────────────────────────
/** Shape stored in user_preferences.preferences JSONB column. */
export interface UserPreferences {
  tours_completed: TourId[]
  first_visit_pages: PageId[]
  /** Index of the current setup wizard step (0-based) */
  wizard_step: number
  wizard_completed: boolean
  checklist_dismissed: boolean
  /** announcement.id values the user has acknowledged */
  announcements_read: string[]
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  tours_completed: [],
  first_visit_pages: [],
  wizard_step: 0,
  wizard_completed: false,
  checklist_dismissed: false,
  announcements_read: [],
}
