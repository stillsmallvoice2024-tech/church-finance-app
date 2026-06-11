import { useEffect, useState, useCallback, Fragment, useMemo } from 'react'
import { LayoutList, AlertCircle, RefreshCw, Percent, Gift, Archive, Layers, ArrowLeftRight, ChevronRight, ChevronDown, Globe, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react'
import { isNonContributing } from '../utils/transactionTypes'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useCategories, useCategoryGroups } from '../hooks/useCategories'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency, formatDate, getCurrencyLocale } from '../utils/formatters'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { allocatePercent } from '../utils/financeMath'
import { fetchAllRows } from '../utils/fetchAllRows'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows, directionLabel } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { useFXTransactions, type FXTransaction } from '../hooks/useFX'
import { useBanks } from '../hooks/useBanks'

// ── Sort field definitions ────────────────────────────────────────────────────

const SUMMARY_COLUMNS: TableColumnDef<CategoryRow>[] = [
  { key: 'name',                label: 'Category',         sortType: 'text',    primary: true, accessor: r => r.name },
  { key: 'percentage',          label: 'Share %',          sortType: 'numeric', primary: true, accessor: r => r.percentage ?? 0 },
  { key: 'percentageAllocated', label: 'Regular Funds',    sortType: 'numeric', primary: true },
  { key: 'specificSeed',        label: 'Designated Gifts', sortType: 'numeric', primary: true },
  { key: 'savingsNet',          label: 'Savings Balance',  sortType: 'numeric', primary: true, accessor: r => r.savingsIn - r.savingsOut },
]

const LEDGER_COLUMNS: TableColumnDef<LedgerRow>[] = [
  { key: 'date',        label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'inflow',      label: 'Inflow',      sortType: 'numeric', primary: true, accessor: r => r.inflow > 0 ? String(r.inflow) : '' },
  { key: 'outflow',     label: 'Outflow',     sortType: 'numeric', primary: true, accessor: r => r.outflow > 0 ? String(r.outflow) : '' },
  { key: 'balance',     label: 'Balance',     sortType: 'numeric', primary: true },
  { key: 'description', label: 'Description',                      accessor: r => r.description },
]

const SUMMARY_SORT_FIELDS = deriveSortFields(SUMMARY_COLUMNS)
const LEDGER_SORT_FIELDS   = deriveSortFields(LEDGER_COLUMNS)

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategoryRow {
  name:                string
  percentage:          number | null
  percentageAllocated: number
  specificSeed:        number
  savingsIn:           number
  savingsOut:          number
}

interface IntraflowMeta {
  intraflowId:  string
  fromCategory: string
  fromPortion:  string
  toCategory:   string
  toPortion:    string
  note:         string | null
  status:       string | null
}

interface LedgerRow {
  id:               string
  date:             string
  description:      string
  inflow:           number
  outflow:          number
  balance:          number
  intraflowMeta?:   IntraflowMeta
  isReversalCredit?: boolean
}

type ViewMode      = 'summary' | 'ledger' | 'fx'
type Portion       = 'All' | 'Percentage' | 'Specific Seed' | 'Savings'
type LedgerPortion = 'Percentage' | 'Specific Seed' | 'Savings'

const PORTIONS: Portion[]             = ['All', 'Percentage', 'Specific Seed', 'Savings']
const LEDGER_PORTIONS: LedgerPortion[] = ['Percentage', 'Specific Seed', 'Savings']

// Display labels only — internal values above are unchanged (used as DB keys).
const PORTION_LABELS: Record<Portion, string> = {
  'All':           'All',
  'Percentage':    'Regular Funds',
  'Specific Seed': 'Designated Gifts',
  'Savings':       'Savings',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CategoryLedger() {
  usePageTitle('Category Accounts')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()

  const { categories }                           = useCategories()
  const { groups }                               = useCategoryGroups()
  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()
  const outflowVersion   = useTransactionSyncStore(s => s.outflowVersion)
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)
  const inflowVersion    = useTransactionSyncStore(s => s.inflowVersion)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  // Summary state
  const [rows,    setRows]    = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Ledger state
  const [ledgerRows,       setLedgerRows]       = useState<LedgerRow[]>([])
  const [ledgerLoading,    setLedgerLoading]    = useState(false)
  const [ledgerError,      setLedgerError]      = useState<string | null>(null)
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null)

  // UI state
  const [viewMode,       setViewMode]       = useState<ViewMode>('summary')
  const [activePortion,  setActivePortion]  = useState<Portion>('All')
  const [activeCategory, setActiveCategory] = useState('')
  const [ledgerPortion,  setLedgerPortion]  = useState<LedgerPortion>('Percentage')

  // FX tab state
  const [filterFxCcy, setFilterFxCcy] = useState<string>('')
  const { transactions: fxTransactions, summaries: fxSummaries, loading: fxLoading, error: fxError, refetch: refetchFx } =
    useFXTransactions(filterFxCcy || undefined)
  const { banks } = useBanks()

  // Sum of FX bank opening balances for the selected currency (shown as B/F row)
  const fxOpeningBalance = useMemo(() => {
    if (!filterFxCcy) return 0
    return banks
      .filter(b => b.is_foreign_currency && b.currency === filterFxCcy && (b.starting_balance ?? 0) > 0)
      .reduce((sum, b) => sum + (b.starting_balance ?? 0), 0)
  }, [banks, filterFxCcy])
  const fxViewState = useDataViewState({
    storageKey:      'cl-fx',
    defaultSortKey:  'date',
    defaultSortDir:  'desc',
    defaultPageSize: 25,
  })

  // Data controls state — persisted per view
  const summaryViewState = useDataViewState({
    storageKey:     'cl-summary',
    defaultSortKey: 'name',
    defaultSortDir: 'desc',
  })
  const ledgerViewState = useDataViewState({
    storageKey:      'cl-ledger',
    defaultSortKey:  'date',
    defaultSortDir:  'desc',
    defaultPageSize: 25,
  })

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  // ── Summary load ─────────────────────────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [seedRes, seedOutRes, savInRes, savOutRes, allInflowRes, cobRes, intraFlowRes, pctOutRes] = await Promise.all([
      fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, amount').eq('stage_code_2', 'Specific Seed')),
      fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role').eq('stage_code_2', 'Specific Seed')),
      fetchAllRows(() => supabase.from('inflow_transactions').select('stage_code_1, amount').eq('stage_code_2', 'Savings')),
      fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role').eq('stage_code_2', 'Savings')),
      fetchAllRows(() => supabase.from('inflow_transactions').select('date, amount, stage_code_2, allocation_config_id, transaction_type, offset_role')),
      supabase.from('category_opening_balances').select('budget_portion, amount, categories(name)'),
      fetchAllRows(() => supabase.from('intra_flows').select('account_from, account_from_stage2, account_to, account_to_stage2, total_amount').eq('status', 'active')),
      fetchAllRows(() => supabase.from('outflow_transactions').select('stage_code_1, amount_disbursed, offset_role')
        .not('stage_code_2', 'eq', 'Specific Seed')
        .not('stage_code_2', 'eq', 'Savings')),
    ])

    if (seedRes.error || seedOutRes.error || savInRes.error || savOutRes.error || allInflowRes.error || pctOutRes.error) {
      setError(
        seedRes.error?.message ?? seedOutRes.error?.message ?? savInRes.error?.message ??
        savOutRes.error?.message ?? allInflowRes.error?.message ??
        pctOutRes.error?.message ?? 'Failed to load',
      )
      setLoading(false)
      return
    }

    const cobRows = cobRes.error ? [] : (cobRes.data ?? [])

    const today  = new Date().toISOString().slice(0, 10)
    const active = configs
      .filter(c => c.start_date <= today && c.status === 'locked')
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

    const pctMap = new Map<string, number>()
    if (active) {
      for (const r of active.rows) pctMap.set(r.category_name, Number(r.percentage ?? 0))
    }

    const map = new Map<string, Omit<CategoryRow, 'name' | 'percentage' | 'percentageAllocated'>>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { specificSeed: 0, savingsIn: 0, savingsOut: 0 })
      return map.get(cat)!
    }

    for (const r of seedRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').specificSeed += Number(r.amount)
    }
    for (const r of seedOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      const amt = Number(r.amount_disbursed || 0)
      const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
      ensure(cat).specificSeed += isOffset ? amt : -amt
    }
    for (const r of savInRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsIn += Number(r.amount)
    }
    for (const r of savOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      const amt = Number(r.amount_disbursed || 0)
      const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
      ensure(cat).savingsOut += isOffset ? -amt : amt
    }

    for (const ob of cobRows) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const row = ensure(catName)
      if (ob.budget_portion === 'Specific Seed') row.specificSeed += Number(ob.amount)
      else if (ob.budget_portion === 'Savings') row.savingsIn += Number(ob.amount)
    }

    const allocMap = new Map<string, number>()
    for (const r of allInflowRes.data ?? []) {
      if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue
      if (isNonContributing(r)) continue
      const configId = r.allocation_config_id as string | null
      const cfg = configId
        ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date as string))
        : getConfigForDate(configs, r.date as string)
      if (!cfg) continue
      for (const catRow of cfg.rows) {
        let allocated: number
        if (catRow.amount != null && catRow.amount > 0) {
          allocated = catRow.amount
        } else if (catRow.percentage) {
          allocated = allocatePercent(Number(r.amount), catRow.percentage)
        } else {
          continue
        }
        if (catRow.budget_portion === 'Specific Seed') {
          ensure(catRow.category_name).specificSeed += allocated
        } else if (catRow.budget_portion === 'Savings') {
          ensure(catRow.category_name).savingsIn += allocated
        } else {
          allocMap.set(catRow.category_name, (allocMap.get(catRow.category_name) ?? 0) + allocated)
        }
      }
    }

    for (const ob of cobRows) {
      if (ob.budget_portion !== 'Percentage Allocation') continue
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      allocMap.set(catName, (allocMap.get(catName) ?? 0) + Number(ob.amount))
    }

    // Intraflow adjustments: internal transfers shift balances between categories.
    // FROM = debit, TO = credit. Net across all categories is always zero.
    for (const r of intraFlowRes.error ? [] : (intraFlowRes.data ?? [])) {
      const amount = Number(r.total_amount)
      if (amount <= 0) continue
      const fromCat   = (r.account_from       as string | null) || ''
      const fromStage = (r.account_from_stage2 as string | null) || ''
      const toCat     = (r.account_to         as string | null) || ''
      const toStage   = (r.account_to_stage2   as string | null) || ''
      // Circular reallocation: same category+portion on both sides — net zero, skip
      if (fromCat === toCat && fromStage === toStage) continue
      if (fromCat) {
        if (fromStage === 'Percentage Allocation') allocMap.set(fromCat, (allocMap.get(fromCat) ?? 0) - amount)
        else { const row = ensure(fromCat); if (fromStage === 'Specific Seed') row.specificSeed -= amount; else if (fromStage === 'Savings') row.savingsIn -= amount }
      }
      if (toCat) {
        if (toStage === 'Percentage Allocation') allocMap.set(toCat, (allocMap.get(toCat) ?? 0) + amount)
        else { const row = ensure(toCat); if (toStage === 'Specific Seed') row.specificSeed += amount; else if (toStage === 'Savings') row.savingsIn += amount }
      }
    }

    const pctOutMap = new Map<string, number>()
    for (const r of pctOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      const amt = Number(r.amount_disbursed || 0)
      const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
      pctOutMap.set(cat, (pctOutMap.get(cat) ?? 0) + (isOffset ? -amt : amt))
    }

    const allNames = new Set<string>([
      ...categories.map(c => c.name),
      ...pctMap.keys(),
      ...map.keys(),
      ...allocMap.keys(),
    ])

    const result: CategoryRow[] = [...allNames].map(name => {
      const d = map.get(name) ?? { specificSeed: 0, savingsIn: 0, savingsOut: 0 }
      return {
        name,
        percentage:          pctMap.has(name) ? pctMap.get(name)! : null,
        percentageAllocated: (allocMap.get(name) ?? 0) - (pctOutMap.get(name) ?? 0),
        ...d,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    setRows(result)
    setLoading(false)
  }, [categories, configs])

  useEffect(() => { loadSummary() }, [loadSummary, inflowVersion, outflowVersion, intraflowVersion])

  // ── Ledger load ───────────────────────────────────────────────────────────────

  const loadLedger = useCallback(async () => {
    if (!activeCategory) return
    setLedgerLoading(true)
    setLedgerError(null)

    try {
      const inRows:  LedgerRow[] = []
      const outRows: LedgerRow[] = []

      if (ledgerPortion === 'Percentage') {
        const [inflowRes, outflowRes] = await Promise.all([
          fetchAllRows(() => supabase.from('inflow_transactions')
            .select('id, date, description, amount, stage_code_2, allocation_config_id, transaction_type, offset_role')
            .order('date')),
          fetchAllRows(() => supabase.from('outflow_transactions')
            .select('id, date, description, amount_disbursed, stage_code_2, offset_role')
            .eq('stage_code_1', activeCategory)
            .order('date')),
        ])
        if (inflowRes.error) throw inflowRes.error
        if (outflowRes.error) throw outflowRes.error

        for (const r of inflowRes.data ?? []) {
          if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue
          if (isNonContributing(r)) continue
          const configId = r.allocation_config_id as string | null
          const cfg = configId
            ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date as string))
            : getConfigForDate(configs, r.date as string)
          const catRow = cfg?.rows.find(c => c.category_name === activeCategory && (c.budget_portion === 'Percentage' || c.budget_portion === 'Percentage Allocation' || !c.budget_portion))
          if (!catRow) continue
          let allocated: number
          if (catRow.amount != null && catRow.amount > 0) {
            allocated = catRow.amount
          } else if (catRow.percentage) {
            allocated = allocatePercent(Number(r.amount), catRow.percentage)
          } else {
            continue
          }
          if (allocated <= 0) continue
          inRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      allocated,
            outflow:     0,
            balance:     0,
          })
        }

        for (const r of outflowRes.data ?? []) {
          if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue
          const amt = Number(r.amount_disbursed || 0)
          if (amt <= 0) continue
          const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
          if (isOffset) {
            inRows.push({
              id:               r.id as string,
              date:             r.date as string,
              description:      (r.description as string | null) || '—',
              inflow:           amt,
              outflow:          0,
              balance:          0,
              isReversalCredit: true,
            })
          } else {
            outRows.push({
              id:          r.id as string,
              date:        r.date as string,
              description: (r.description as string | null) || '—',
              inflow:      0,
              outflow:     amt,
              balance:     0,
            })
          }
        }
      } else {
        const sc2 = ledgerPortion
        const [inflowRes, outflowRes, cfgInflowRes] = await Promise.all([
          fetchAllRows(() => supabase.from('inflow_transactions')
            .select('id, date, description, amount')
            .eq('stage_code_2', sc2)
            .eq('stage_code_1', activeCategory)
            .order('date')),
          fetchAllRows(() => supabase.from('outflow_transactions')
            .select('id, date, description, amount_disbursed, offset_role')
            .eq('stage_code_2', sc2)
            .eq('stage_code_1', activeCategory)
            .order('date')),
          // Config-split inflows where this category's row has matching budget_portion
          fetchAllRows(() => supabase.from('inflow_transactions')
            .select('id, date, description, amount, allocation_config_id')
            .not('allocation_config_id', 'is', null)
            .is('stage_code_2', null)
            .order('date')),
        ])
        if (inflowRes.error) throw inflowRes.error
        if (outflowRes.error) throw outflowRes.error

        for (const r of inflowRes.data ?? []) {
          inRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      Number(r.amount),
            outflow:     0,
            balance:     0,
          })
        }
        for (const r of outflowRes.data ?? []) {
          const amt = Number(r.amount_disbursed || 0)
          const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
          if (isOffset) {
            inRows.push({
              id:               r.id as string,
              date:             r.date as string,
              description:      (r.description as string | null) || '—',
              inflow:           amt,
              outflow:          0,
              balance:          0,
              isReversalCredit: true,
            })
          } else {
            outRows.push({
              id:          r.id as string,
              date:        r.date as string,
              description: (r.description as string | null) || '—',
              inflow:      0,
              outflow:     amt,
              balance:     0,
            })
          }
        }
        // Config-split: allocations routed to this category+portion via config rows
        for (const r of cfgInflowRes.error ? [] : (cfgInflowRes.data ?? [])) {
          const cfg = configs.find(c => c.id === (r.allocation_config_id as string))
          const catRow = cfg?.rows.find(c => c.category_name === activeCategory && c.budget_portion === sc2)
          if (!catRow) continue
          let allocated: number
          if (catRow.amount != null && catRow.amount > 0) {
            allocated = catRow.amount
          } else if (catRow.percentage) {
            allocated = allocatePercent(Number(r.amount), catRow.percentage)
          } else {
            continue
          }
          if (allocated <= 0) continue
          inRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      allocated,
            outflow:     0,
            balance:     0,
          })
        }
      }

      const catRecord = categories.find(c => c.name === activeCategory)
      const portionMap: Record<LedgerPortion, string> = {
        'Percentage':    'Percentage Allocation',
        'Specific Seed': 'Specific Seed',
        'Savings':       'Savings',
      }
      const portionStage2 = portionMap[ledgerPortion]

      const [cobLedger, intraFromRes, intraToRes] = await Promise.all([
        catRecord
          ? supabase.from('category_opening_balances')
              .select('amount')
              .eq('category_id', catRecord.id)
              .eq('budget_portion', portionStage2)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from('intra_flows')
          .select('id, date, description, total_amount, account_to, account_to_stage2, status')
          .eq('account_from', activeCategory)
          .eq('account_from_stage2', portionStage2)
          .eq('status', 'active')
          .order('date'),
        supabase.from('intra_flows')
          .select('id, date, description, total_amount, account_from, account_from_stage2, status')
          .eq('account_to', activeCategory)
          .eq('account_to_stage2', portionStage2)
          .eq('status', 'active')
          .order('date'),
      ])
      if (intraFromRes.error) throw intraFromRes.error
      if (intraToRes.error) throw intraToRes.error

      const bfRow: LedgerRow[] = []
      const bfAmt = cobLedger?.data?.amount ? Number(cobLedger.data.amount) : 0
      if (bfAmt !== 0) {
        bfRow.push({
          id:          'bal-bf',
          date:        '0000-01-01',
          description: 'Balance Brought Forward',
          inflow:      bfAmt,
          outflow:     0,
          balance:     0,
        })
      }

      // FROM this category = debit (outflow); TO this category = credit (inflow)
      for (const r of intraFromRes.data ?? []) {
        const amount = Number(r.total_amount)
        if (amount <= 0) continue
        outRows.push({
          id:          `if-out-${r.id}`,
          date:        r.date as string,
          description: `Transfer → ${r.account_to}${r.account_to_stage2 ? ' (' + r.account_to_stage2 + ')' : ''}${r.description ? ': ' + r.description : ''}`,
          inflow:      0,
          outflow:     amount,
          balance:     0,
          intraflowMeta: {
            intraflowId:  r.id as string,
            fromCategory: activeCategory,
            fromPortion:  portionStage2,
            toCategory:   (r.account_to   as string) ?? '',
            toPortion:    (r.account_to_stage2 as string) ?? '',
            note:         (r.description  as string | null) ?? null,
            status:       (r.status       as string | null) ?? null,
          },
        })
      }
      for (const r of intraToRes.data ?? []) {
        const amount = Number(r.total_amount)
        if (amount <= 0) continue
        inRows.push({
          id:          `if-in-${r.id}`,
          date:        r.date as string,
          description: `Transfer ← ${r.account_from}${r.account_from_stage2 ? ' (' + r.account_from_stage2 + ')' : ''}${r.description ? ': ' + r.description : ''}`,
          inflow:      amount,
          outflow:     0,
          balance:     0,
          intraflowMeta: {
            intraflowId:  r.id as string,
            fromCategory: (r.account_from       as string) ?? '',
            fromPortion:  (r.account_from_stage2 as string) ?? '',
            toCategory:   activeCategory,
            toPortion:    portionStage2,
            note:         (r.description  as string | null) ?? null,
            status:       (r.status       as string | null) ?? null,
          },
        })
      }

      // balance is intentionally 0 here — ledgerFilteredWithBalance owns all balance computation
      const combined = [...bfRow, ...inRows, ...outRows].sort((a, b) => a.date.localeCompare(b.date) || (a.inflow > 0 ? -1 : 1))
      setLedgerRows(combined)
    } catch (e: unknown) {
      setLedgerError(e instanceof Error ? e.message : 'Failed to load ledger')
    } finally {
      setLedgerLoading(false)
    }
  }, [activeCategory, ledgerPortion, configs])

  useEffect(() => {
    if (viewMode === 'ledger' && activeCategory) loadLedger()
  }, [viewMode, activeCategory, ledgerPortion, loadLedger, inflowVersion, outflowVersion, intraflowVersion])

  // Reset ledger page + expansion when category or portion changes
  const { setPage: setLedgerPage } = ledgerViewState
  useEffect(() => {
    setLedgerPage(0)
    setExpandedLedgerId(null)
  }, [activeCategory, ledgerPortion, setLedgerPage])

  // ── Derived — Summary ─────────────────────────────────────────────────────────

  // Category names that have a foreign currency assigned — excluded from NGN totals
  const fxCategoryNames = useMemo(
    () => new Set(categories.filter(c => c.currency).map(c => c.name)),
    [categories],
  )

  const filteredRows = useMemo(
    () => rows.filter(r => {
      const catOk = !activeCategory || r.name === activeCategory
      const portOk =
        activePortion === 'All'           ? true :
        activePortion === 'Percentage'    ? r.percentageAllocated !== 0 :
        activePortion === 'Specific Seed' ? r.specificSeed > 0 :
        /* Savings */                       r.savingsIn > 0 || r.savingsOut > 0
      return catOk && portOk
    }),
    [rows, activeCategory, activePortion],
  )

  const summarySearchFiltered = useMemo(
    () => searchRows(filteredRows, SUMMARY_COLUMNS, summaryViewState.search, summaryViewState.searchCol),
    [filteredRows, summaryViewState.search, summaryViewState.searchCol],
  )

  const getSummaryValue = (row: CategoryRow, key: string) => {
    if (key === 'name')                return row.name
    if (key === 'percentage')          return row.percentage ?? -Infinity
    if (key === 'percentageAllocated') return row.percentageAllocated
    if (key === 'specificSeed')        return row.specificSeed
    if (key === 'savingsNet')          return row.savingsIn - row.savingsOut
    return null
  }

  const summarySorted = useMemo(() => {
    const adv = summaryViewState.advancedSort
    if (adv.length > 0) return multiSortRows(summarySearchFiltered, getSummaryValue, adv, SUMMARY_SORT_FIELDS)
    return sortRows(summarySearchFiltered, getSummaryValue, summaryViewState.sortKey, summaryViewState.sortDir, SUMMARY_SORT_FIELDS)
  }, [summarySearchFiltered, summaryViewState.sortKey, summaryViewState.sortDir, summaryViewState.advancedSort])

  const summaryPage = useMemo(
    () => summarySorted.slice(
      summaryViewState.page * summaryViewState.pageSize,
      (summaryViewState.page + 1) * summaryViewState.pageSize,
    ),
    [summarySorted, summaryViewState.page, summaryViewState.pageSize],
  )

  const totals = useMemo(
    () => summarySorted.filter(r => !fxCategoryNames.has(r.name)).reduce(
      (acc, r) => ({
        pct:   acc.pct   + (r.percentage ?? 0),
        alloc: acc.alloc + r.percentageAllocated,
        seed:  acc.seed  + r.specificSeed,
        sav:   acc.sav   + (r.savingsIn - r.savingsOut),
      }),
      { pct: 0, alloc: 0, seed: 0, sav: 0 },
    ),
    [summarySorted, fxCategoryNames],
  )

  const globalTotals = useMemo(
    () => rows.filter(r => !fxCategoryNames.has(r.name)).reduce(
      (acc, r) => ({
        alloc: acc.alloc + r.percentageAllocated,
        seed:  acc.seed  + r.specificSeed,
        sav:   acc.sav   + (r.savingsIn - r.savingsOut),
      }),
      { alloc: 0, seed: 0, sav: 0 },
    ),
    [rows, fxCategoryNames],
  )

  // Currency for the currently selected ledger category (FX categories carry their own)
  const ledgerDisplayCurrency = useMemo(
    () => categories.find(c => c.name === activeCategory)?.currency ?? baseCurrencyCode,
    [categories, activeCategory, baseCurrencyCode],
  )

  // ── Derived — Ledger ──────────────────────────────────────────────────────────

  const ledgerFiltered = useMemo(
    () => {
      const q = ledgerViewState.search.trim().toLowerCase()
      if (!q) return ledgerRows
      return ledgerRows.filter(r =>
        r.id === 'bal-bf' ||
        searchRows([r], LEDGER_COLUMNS, q, ledgerViewState.searchCol).length > 0
      )
    },
    [ledgerRows, ledgerViewState.search, ledgerViewState.searchCol],
  )

  // Balance invariant — order matters:
  // 1. Sort a copy by date ASC (inflows before outflows on same date)
  // 2. Compute cumulative running balance oldest→newest; record each row's chronological seq
  // 3. Freeze balance + seq onto each row by ID
  // 4. ledgerSorted applies display sort AFTER using seq as tiebreaker:
  //    DESC → reverse-chronological within date (last event at top); ASC → chronological
  const { ledgerFilteredWithBalance, closingBalance, seqById } = useMemo(() => {
    const chronological = [...ledgerFiltered].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.inflow > 0 ? -1 : 1),
    )
    let running = 0
    const balanceById = new Map<string, number>()
    const seqById     = new Map<string, number>()
    for (let i = 0; i < chronological.length; i++) {
      const row = chronological[i]
      running += row.inflow - row.outflow
      balanceById.set(row.id, running)
      seqById.set(row.id, i)
    }
    return {
      ledgerFilteredWithBalance: ledgerFiltered.map(row => ({ ...row, balance: balanceById.get(row.id)! })),
      closingBalance: running,
      seqById,
    }
  }, [ledgerFiltered])

  const getLedgerValue = (row: LedgerRow, key: string) => {
    if (key === 'date')        return row.date
    if (key === 'inflow')      return row.inflow
    if (key === 'outflow')     return row.outflow
    if (key === 'balance')     return row.balance
    if (key === 'description') return row.description
    return null
  }

  const ledgerSorted = useMemo(() => {
    const adv = ledgerViewState.advancedSort
    if (adv.length > 0) return multiSortRows(ledgerFilteredWithBalance, getLedgerValue, adv, LEDGER_SORT_FIELDS)
    if (ledgerViewState.sortKey === 'date') {
      const dir = ledgerViewState.sortDir
      return [...ledgerFilteredWithBalance].sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date)
        if (dateCmp !== 0) return dir === 'desc' ? -dateCmp : dateCmp
        const seqA = seqById.get(a.id) ?? 0
        const seqB = seqById.get(b.id) ?? 0
        return dir === 'desc' ? seqB - seqA : seqA - seqB
      })
    }
    return sortRows(ledgerFilteredWithBalance, getLedgerValue, ledgerViewState.sortKey, ledgerViewState.sortDir, LEDGER_SORT_FIELDS)
  }, [ledgerFilteredWithBalance, seqById, ledgerViewState.sortKey, ledgerViewState.sortDir, ledgerViewState.advancedSort])

  const ledgerPagedRows = useMemo(
    () => ledgerSorted.slice(
      ledgerViewState.page * ledgerViewState.pageSize,
      (ledgerViewState.page + 1) * ledgerViewState.pageSize,
    ),
    [ledgerSorted, ledgerViewState.page, ledgerViewState.pageSize],
  )

  const ledgerTotals = useMemo(
    () => ledgerRows.reduce(
      (acc, r) => ({ inflow: acc.inflow + r.inflow, outflow: acc.outflow + r.outflow }),
      { inflow: 0, outflow: 0 },
    ),
    [ledgerRows],
  )

  const activeLedgerField = LEDGER_SORT_FIELDS.find(f => f.key === ledgerViewState.sortKey)

  const CL_CSV_FILE = `category-ledger-${new Date().toISOString().slice(0, 10)}.csv`
  const SUMMARY_CSV_HEADERS = ['Category', '% Alloc', `${baseCurrencySymbol} Allocation`, 'Specific Seed', 'Savings Net']
  const summaryCsvRow = (r: CategoryRow) => [r.name, r.percentage ?? '', r.percentageAllocated, r.specificSeed, r.savingsIn - r.savingsOut]
  const LEDGER_CSV_HEADERS = ['Date', 'Description', `Inflow (${baseCurrencySymbol})`, `Outflow (${baseCurrencySymbol})`, `Balance (${baseCurrencySymbol})`]
  const ledgerCsvRow = (r: LedgerRow) => [r.date, r.description ?? '', r.inflow || '', r.outflow || '', r.balance]
  const handleExportView = () => {
    if (viewMode === 'summary') exportCSV(CL_CSV_FILE, SUMMARY_CSV_HEADERS, summaryPage.map(summaryCsvRow))
    else if (viewMode === 'ledger') exportCSV(CL_CSV_FILE, LEDGER_CSV_HEADERS, ledgerPagedRows.filter(r => r.id !== 'bal-bf').map(ledgerCsvRow))
    else exportCSV(CL_CSV_FILE, FX_CSV_HEADERS, fxTransactions.slice(fxViewState.page * fxViewState.pageSize, (fxViewState.page + 1) * fxViewState.pageSize).map(fxCsvRow))
  }
  const handleExportAll = () => {
    if (viewMode === 'summary') exportCSV(CL_CSV_FILE, SUMMARY_CSV_HEADERS, summarySorted.map(summaryCsvRow))
    else if (viewMode === 'ledger') exportCSV(CL_CSV_FILE, LEDGER_CSV_HEADERS, ledgerSorted.filter(r => r.id !== 'bal-bf').map(ledgerCsvRow))
    else exportCSV(CL_CSV_FILE, FX_CSV_HEADERS, fxTransactions.map(fxCsvRow))
  }
  const exportDisabled = viewMode === 'summary' ? summarySorted.length === 0 : viewMode === 'ledger' ? ledgerSorted.length === 0 : fxTransactions.length === 0

  const FX_CSV_HEADERS = ['Date', 'Currency', 'Reference', 'Narration', 'Deposit', 'Withdrawal', 'Balance']
  const fxCsvRow = (r: FXTransaction) => [r.date, r.currency, r.transaction_ref ?? '', r.narration ?? '', r.deposit || '', r.withdrawal || '', r.running_balance]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      <PageHelpBanner storageKey="help-dismissed-category-ledger" title="What is the Category Ledger?">
        The Category Ledger shows how outflow spending is distributed across budget categories (e.g. Salaries, Utilities, Ministry).
        Use the Summary view to see total spending per category, or switch to Ledger view to see individual transactions.
        Categories are set up in the Categories page and assigned to outflows at the time of recording.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Category Accounts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {viewMode === 'summary' ? 'Aggregated view of all fund balances per category' :
             viewMode === 'ledger'  ? 'Transaction-level view per category and fund type' :
                                      'Foreign-currency transaction history by currency'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('summary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                viewMode === 'summary' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" /> Summary
            </button>
            <button
              onClick={() => setViewMode('ledger')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${
                viewMode === 'ledger' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Ledger
            </button>
            <button
              onClick={() => setViewMode('fx')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${
                viewMode === 'fx' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Globe className="w-3.5 h-3.5" /> FX
            </button>
          </div>
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={exportDisabled} />
          <button
            onClick={() => viewMode === 'summary' ? loadSummary() : viewMode === 'ledger' ? loadLedger() : refetchFx()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* ── SUMMARY VIEW ──────────────────────────────────────────────────────────── */}
      {viewMode === 'summary' && (
        <>
          {/* Aggregate summary cards */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1.5 flex items-center gap-1">
                  <Percent className="w-3 h-3 shrink-0" /><span className="truncate">Regular Funds</span>
                </p>
                <p className="text-sm font-mono font-bold text-primary tabular-nums">{formatCurrency(globalTotals.alloc, baseCurrencyCode)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5 flex items-center gap-1">
                  <Gift className="w-3 h-3 shrink-0" /><span className="truncate">Designated Gifts</span>
                </p>
                <p className="text-sm font-mono font-bold text-amber-700 tabular-nums">{formatCurrency(globalTotals.seed, baseCurrencyCode)}</p>
              </div>
              <div className={`rounded-xl border px-3 py-3 min-w-0 overflow-hidden ${globalTotals.sav >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1 ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                  <Archive className="w-3 h-3 shrink-0" /><span className="truncate">Savings Balance</span>
                </p>
                <p className={`text-sm font-mono font-bold tabular-nums ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(globalTotals.sav, baseCurrencyCode)}</p>
              </div>
              <div className="rounded-xl bg-gray-800 border border-gray-700 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-300 mb-1.5 truncate">Grand Total</p>
                <p className="text-sm font-mono font-bold text-white tabular-nums">{formatCurrency(globalTotals.alloc + globalTotals.seed + globalTotals.sav, baseCurrencyCode)}</p>
              </div>
            </div>
          )}

          {/* Portion filter + Category selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {PORTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setActivePortion(p)}
                  className={`px-3 py-1.5 border-r last:border-r-0 border-gray-200 transition-colors ${
                    activePortion === p ? 'bg-primary text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {PORTION_LABELS[p]}
                </button>
              ))}
            </div>
            <SearchableSelect value={activeCategory} onChange={setActiveCategory}
              options={rows.map(r => ({ value: r.name, label: r.name }))}
              placeholder="All categories"
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700" />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          )}

          {!loading && !error && filteredRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <LayoutList className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">No categories found</p>
                <p className="text-sm text-gray-500 mt-1">Create categories and tag transactions with a category and fund type to populate this view.</p>
              </div>
            </div>
          )}

          {!loading && !error && filteredRows.length > 0 && (
            <>
            <div className="space-y-2">
              {/* Data Controls — immediately above table */}
              <DataControlsBar
                columns={SUMMARY_COLUMNS}
                sortKey={summaryViewState.sortKey}
                sortDir={summaryViewState.sortDir}
                onSort={summaryViewState.setSort}
                defaultSortKey="name"
                defaultSortDir="desc"
                search={summaryViewState.search}
                onSearchChange={summaryViewState.setSearch}
                searchPlaceholder="Search categories…"
                searchCol={summaryViewState.searchCol}
                onSearchColChange={summaryViewState.setSearchCol}
                advancedSort={summaryViewState.advancedSort}
                onAdvancedSort={summaryViewState.setAdvancedSort}
                pageSize={summaryViewState.pageSize}
                onPageSizeChange={summaryViewState.setPageSize}
              />

              {summarySorted.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                  <p className="text-sm text-gray-500">No categories match <span className="font-medium">"{summaryViewState.search}"</span></p>
                  <button
                    type="button"
                    onClick={() => summaryViewState.setSearch('')}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[0]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          className="px-5 py-3"
                        />
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[1]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3"
                        >
                          <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> Share %</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[2]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3 hidden md:table-cell"
                        >
                          <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> Regular Funds</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[3]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3 hidden md:table-cell"
                        >
                          <span className="flex items-center justify-end gap-1"><Gift className="w-3 h-3" /> Designated Gifts</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[4]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-5 py-3"
                        >
                          <span className="flex items-center justify-end gap-1"><Archive className="w-3 h-3" /> Savings Balance</span>
                        </SortableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(() => {
                        const nameToGroupId = new Map(categories.map(c => [c.name, c.group_id]))
                        const groupedSections = groups
                          .map(g => ({ group: g, rows: summaryPage.filter(r => nameToGroupId.get(r.name) === g.id) }))
                          .filter(s => s.rows.length > 0)
                        const ungroupedRows = summaryPage.filter(r => !nameToGroupId.get(r.name))

                        const CategoryDataRow = ({ row }: { row: CategoryRow }) => (
                          <tr className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 font-medium text-gray-800">{row.name}</td>
                            <td className="px-4 py-3 text-right">
                              {row.percentage !== null
                                ? <span className="font-mono font-semibold text-primary">{Number(row.percentage).toFixed(1)}%</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              {row.percentageAllocated > 0
                                ? <span className="font-mono text-primary">{formatCurrency(row.percentageAllocated, baseCurrencyCode)}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              {row.specificSeed > 0
                                ? <span className="font-mono text-amber-700">{formatCurrency(row.specificSeed, baseCurrencyCode)}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {row.savingsIn > 0 || row.savingsOut > 0
                                ? <span className={`font-mono font-semibold ${row.savingsIn - row.savingsOut >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(row.savingsIn - row.savingsOut, baseCurrencyCode)}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                          </tr>
                        )

                        const GroupSubtotalRow = ({ sectionRows, label }: { sectionRows: CategoryRow[]; label: string }) => {
                          const localRows = sectionRows.filter(r => !fxCategoryNames.has(r.name))
                          const sPct   = localRows.reduce((s, r) => s + (r.percentage ?? 0), 0)
                          const sAlloc = localRows.reduce((s, r) => s + r.percentageAllocated, 0)
                          const sSeed  = localRows.reduce((s, r) => s + r.specificSeed, 0)
                          const sSav   = localRows.reduce((s, r) => s + (r.savingsIn - r.savingsOut), 0)
                          return (
                            <tr className="bg-gray-50 border-t border-gray-100 text-xs font-semibold text-gray-600">
                              <td className="px-5 py-2 pl-8">↳ {label} subtotal</td>
                              <td className="px-4 py-2 text-right font-mono text-primary">{sPct > 0 ? `${sPct.toFixed(1)}%` : '—'}</td>
                              <td className="px-4 py-2 text-right font-mono text-primary hidden md:table-cell">{sAlloc > 0 ? formatCurrency(sAlloc, baseCurrencyCode) : '—'}</td>
                              <td className="px-4 py-2 text-right font-mono text-amber-700 hidden md:table-cell">{sSeed > 0 ? formatCurrency(sSeed, baseCurrencyCode) : '—'}</td>
                              <td className={`px-5 py-2 text-right font-mono ${sSav >= 0 ? 'text-success' : 'text-danger'}`}>{sSav !== 0 ? formatCurrency(sSav, baseCurrencyCode) : '—'}</td>
                            </tr>
                          )
                        }

                        return (
                          <>
                            {groupedSections.map(({ group, rows: gRows }) => (
                              <Fragment key={group.id}>
                                <tr className="bg-gray-100 border-y border-gray-200">
                                  <td colSpan={5} className="px-5 py-2">
                                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{group.name}</span>
                                  </td>
                                </tr>
                                {gRows.map(row => <CategoryDataRow key={row.name} row={row} />)}
                                <GroupSubtotalRow sectionRows={gRows} label={group.name} />
                              </Fragment>
                            ))}
                            {ungroupedRows.length > 0 && groupedSections.length > 0 && (
                              <tr className="bg-gray-100 border-y border-gray-200">
                                <td colSpan={5} className="px-5 py-2">
                                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Other</span>
                                </td>
                              </tr>
                            )}
                            {ungroupedRows.map(row => <CategoryDataRow key={row.name} row={row} />)}
                          </>
                        )
                      })()}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-xs">
                        <td className="px-5 py-3 text-gray-700">
                          Totals
                          {summaryViewState.search && (
                            <span className="ml-1.5 font-normal text-gray-400">({summarySorted.length} shown)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-primary">
                          {totals.pct > 0 ? `${totals.pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-primary hidden md:table-cell">
                          {totals.alloc > 0 ? formatCurrency(totals.alloc, baseCurrencyCode) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-700 hidden md:table-cell">
                          {totals.seed > 0 ? formatCurrency(totals.seed, baseCurrencyCode) : '—'}
                        </td>
                        <td className={`px-5 py-3 text-right font-mono ${totals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                          {formatCurrency(totals.sav, baseCurrencyCode)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
            <PaginationBar
              page={summaryViewState.page}
              pageSize={summaryViewState.pageSize}
              total={summarySorted.length}
              onPageChange={summaryViewState.setPage}
              variant="full"
            />
            </>
          )}
        </>
      )}

      {/* ── LEDGER VIEW ───────────────────────────────────────────────────────────── */}
      {viewMode === 'ledger' && (
        <>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3">
            <SearchableSelect value={activeCategory} onChange={setActiveCategory}
              options={rows.map(r => ({ value: r.name, label: r.name }))}
              placeholder="Select a category…"
              className="text-sm px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700 min-w-[180px]" />

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {LEDGER_PORTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setLedgerPortion(p)}
                  className={`px-3 py-2 border-r last:border-r-0 border-gray-200 transition-colors ${
                    ledgerPortion === p ? 'bg-primary text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {PORTION_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* No category selected */}
          {!activeCategory && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Layers className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-700">Select a category</p>
                <p className="text-sm text-gray-500 mt-1">Choose a category above to view its transaction ledger.</p>
              </div>
            </div>
          )}

          {/* Ledger error */}
          {activeCategory && ledgerError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{ledgerError}
            </div>
          )}

          {/* Loading */}
          {activeCategory && ledgerLoading && (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          )}

          {/* Ledger content */}
          {activeCategory && !ledgerLoading && !ledgerError && (
            <>
              {/* Summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1 truncate">{activeCategory}</p>
                  <p className="text-xs text-gray-500">{ledgerPortion} portion</p>
                </div>
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-success mb-1">Total Inflow</p>
                  <p className="text-sm font-mono font-semibold text-success tabular-nums">{formatCurrency(ledgerTotals.inflow, ledgerDisplayCurrency)}</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-danger mb-1">Total Outflow</p>
                  <p className="text-sm font-mono font-semibold text-danger tabular-nums">{formatCurrency(ledgerTotals.outflow, ledgerDisplayCurrency)}</p>
                </div>
              </div>

              {ledgerRows.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                  <Layers className="w-8 h-8 text-gray-300" />
                  <div>
                    <p className="text-sm font-medium text-gray-600">No transactions found</p>
                    <p className="text-xs text-gray-400 mt-0.5">No {ledgerPortion} transactions for {activeCategory}.</p>
                  </div>
                </div>
              )}

              {ledgerRows.length > 0 && (
                <div className="space-y-1.5">
                  {/* Data Controls — immediately above data */}
                  <DataControlsBar
                    columns={LEDGER_COLUMNS}
                    sortKey={ledgerViewState.sortKey}
                    sortDir={ledgerViewState.sortDir}
                    onSort={ledgerViewState.setSort}
                    defaultSortKey="date"
                    defaultSortDir="desc"
                    view={ledgerViewState.view}
                    onViewChange={ledgerViewState.setView}
                    search={ledgerViewState.search}
                    onSearchChange={ledgerViewState.setSearch}
                    searchPlaceholder="Search descriptions…"
                    searchCol={ledgerViewState.searchCol}
                    onSearchColChange={ledgerViewState.setSearchCol}
                    advancedSort={ledgerViewState.advancedSort}
                    onAdvancedSort={ledgerViewState.setAdvancedSort}
                    pageSize={ledgerViewState.pageSize}
                    onPageSizeChange={ledgerViewState.setPageSize}
                  />

                  {/* Top pagination — compact */}
                  <PaginationBar
                    page={ledgerViewState.page}
                    pageSize={ledgerViewState.pageSize}
                    total={ledgerSorted.length}
                    onPageChange={ledgerViewState.setPage}
                    variant="compact"
                  />

                  {/* No search results */}
                  {ledgerSorted.length === 0 && (
                    <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                      <p className="text-sm text-gray-500">No transactions match <span className="font-medium">"{ledgerViewState.search}"</span></p>
                      <button
                        type="button"
                        onClick={() => ledgerViewState.setSearch('')}
                        className="mt-2 text-xs text-primary hover:underline"
                      >
                        Clear search
                      </button>
                    </div>
                  )}

                  {/* TABLE display */}
                  {ledgerSorted.length > 0 && ledgerViewState.view === 'table' && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[0]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              className="px-4 py-3"
                            />
                            <th className="px-4 py-3 text-left font-medium">Description</th>
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[1]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-4 py-3"
                              inactiveCls="text-success/80 hover:text-success"
                            />
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[2]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-4 py-3"
                              inactiveCls="text-danger/80 hover:text-danger"
                            />
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[3]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-5 py-3"
                            />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {ledgerPagedRows.map(row => {
                            const isExpanded = expandedLedgerId === row.id
                            const meta = row.intraflowMeta
                            return (
                              <Fragment key={row.id}>
                                <tr className={`transition-colors ${row.id === 'bal-bf' ? 'bg-blue-50/60 font-medium' : row.isReversalCredit ? 'bg-amber-50/40 hover:bg-amber-50/60' : meta ? 'bg-indigo-50/30 hover:bg-indigo-50/60' : 'hover:bg-gray-50'}`}>
                                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{row.id === 'bal-bf' ? '—' : formatDate(row.date)}</td>
                                  <td className="px-4 py-3 text-gray-700 max-w-xs">
                                    <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                                    {row.isReversalCredit && (
                                      <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                        <RotateCcw className="w-3 h-3" />
                                        Reversal Credit
                                      </span>
                                    )}
                                    {meta && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedLedgerId(isExpanded ? null : row.id)}
                                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 hover:bg-indigo-100 transition-colors"
                                      >
                                        <ArrowLeftRight className="w-3 h-3" />
                                        Transfer
                                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                      </button>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-success">
                                    {row.inflow > 0 ? formatCurrency(row.inflow, ledgerDisplayCurrency) : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-danger">
                                    {row.outflow > 0 ? formatCurrency(row.outflow, ledgerDisplayCurrency) : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className={`px-5 py-3 text-right font-mono font-semibold ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                                    {formatCurrency(row.balance, ledgerDisplayCurrency)}
                                  </td>
                                </tr>
                                {meta && isExpanded && (
                                  <RowDetailPanel
                                    colSpan={5}
                                    items={buildIntraflowDetailItems(meta, row)}
                                  />
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-xs">
                            <td className="px-4 py-3 text-gray-700" colSpan={2}>Totals</td>
                            <td className="px-4 py-3 text-right font-mono text-success">{formatCurrency(ledgerTotals.inflow, ledgerDisplayCurrency)}</td>
                            <td className="px-4 py-3 text-right font-mono text-danger">{formatCurrency(ledgerTotals.outflow, ledgerDisplayCurrency)}</td>
                            <td className={`px-5 py-3 text-right font-mono ${closingBalance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                              {ledgerSorted.length > 0 ? formatCurrency(closingBalance, ledgerDisplayCurrency) : '—'}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* CARDS display */}
                  {ledgerSorted.length > 0 && ledgerViewState.view === 'cards' && (
                    <div className="space-y-3">
                      {activeLedgerField && (ledgerViewState.sortKey !== 'date' || ledgerViewState.sortDir !== 'asc' || ledgerViewState.search) && (
                        <p className="text-xs text-gray-400 px-0.5">
                          {ledgerViewState.search
                            ? `${ledgerSorted.length} result${ledgerSorted.length !== 1 ? 's' : ''} · `
                            : ''}
                          Sorted by {activeLedgerField.label} · {directionLabel(activeLedgerField.type, ledgerViewState.sortDir)}
                        </p>
                      )}
                      {ledgerPagedRows.map(row => {
                        const isExpanded = expandedLedgerId === row.id
                        const meta = row.intraflowMeta
                        return (
                          <div
                            key={row.id}
                            className={`rounded-xl border overflow-hidden shadow-sm ${
                              row.id === 'bal-bf'
                                ? 'bg-blue-50/60 border-blue-200'
                                : row.isReversalCredit
                                ? 'bg-amber-50/40 border-amber-200'
                                : meta
                                ? 'bg-indigo-50/30 border-indigo-200'
                                : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="px-4 pt-3.5 pb-3">
                              <p className={`text-[11px] font-semibold mb-1.5 ${
                                row.id === 'bal-bf'
                                  ? 'text-blue-500 uppercase tracking-wide'
                                  : 'text-gray-400'
                              }`}>
                                {row.id === 'bal-bf' ? 'Balance B/F' : formatDate(row.date)}
                              </p>
                              {row.id === 'bal-bf' ? (
                                <p className="text-sm font-semibold text-blue-800">{row.description}</p>
                              ) : (
                                <div className="text-sm">
                                  <DescriptionCell
                                    id={`card-${row.id}`}
                                    text={row.description}
                                    tooltip={descTooltip}
                                    setTooltip={setDescTooltip}
                                    textCls="text-gray-800"
                                  />
                                  {row.isReversalCredit && (
                                    <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                      <RotateCcw className="w-3 h-3" />
                                      Reversal Credit
                                    </span>
                                  )}
                                  {meta && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedLedgerId(isExpanded ? null : row.id)}
                                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 hover:bg-indigo-100 transition-colors"
                                    >
                                      <ArrowLeftRight className="w-3 h-3" />
                                      Transfer details
                                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {meta && isExpanded && (
                              <div className="px-4 pb-3 border-t border-indigo-100 bg-indigo-50/20">
                                <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-3">
                                  {buildIntraflowDetailItems(meta, row).filter(i => i.value !== null && i.value !== undefined && i.value !== '').map((item, idx) => (
                                    <div key={idx} className="min-w-0">
                                      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">{item.label}</p>
                                      {item.badge ? (
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${item.badge}`}>{item.value}</span>
                                      ) : (
                                        <p className="text-xs text-gray-700 break-words">{item.value}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className={`grid grid-cols-2 border-t px-4 py-3 ${
                              row.id === 'bal-bf'
                                ? 'border-blue-200/60 bg-blue-50/30'
                                : meta
                                ? 'border-indigo-100 bg-indigo-50/20'
                                : 'border-gray-100 bg-gray-50/40'
                            }`}>
                              <div className="min-w-0">
                                <p className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${
                                  row.inflow > 0 ? 'text-green-600/70' : 'text-red-600/70'
                                }`}>
                                  {row.id === 'bal-bf' ? 'B/F Amount' : (row.inflow > 0 ? 'Inflow' : 'Outflow')}
                                </p>
                                <p className={`text-sm font-mono font-bold tabular-nums ${
                                  row.inflow > 0 ? 'text-success' : 'text-danger'
                                }`}>
                                  {row.inflow > 0 ? formatCurrency(row.inflow, ledgerDisplayCurrency) : formatCurrency(row.outflow, ledgerDisplayCurrency)}
                                </p>
                              </div>
                              <div className="border-l border-gray-200/80 pl-4 min-w-0">
                                <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Balance</p>
                                <p className={`text-sm font-mono font-bold tabular-nums ${
                                  row.balance >= 0 ? 'text-gray-900' : 'text-danger'
                                }`}>
                                  {formatCurrency(row.balance, ledgerDisplayCurrency)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Bottom pagination — full */}
                  <PaginationBar
                    page={ledgerViewState.page}
                    pageSize={ledgerViewState.pageSize}
                    total={ledgerSorted.length}
                    onPageChange={ledgerViewState.setPage}
                    variant="full"
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── FX VIEW ────────────────────────────────────────────────────────────────── */}
      {viewMode === 'fx' && (
        <>
          {fxError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{fxError}
            </div>
          )}

          {/* Currency filter chips */}
          {fxSummaries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterFxCcy('')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  !filterFxCcy ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                All currencies
              </button>
              {fxSummaries.map(s => (
                <button
                  key={s.currency}
                  onClick={() => setFilterFxCcy(prev => prev === s.currency ? '' : s.currency)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filterFxCcy === s.currency ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.currency}
                </button>
              ))}
            </div>
          )}

          {/* Summary cards */}
          {fxLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : fxSummaries.length === 0 ? null : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {(filterFxCcy ? fxSummaries.filter(s => s.currency === filterFxCcy) : fxSummaries).map(s => (
                <div key={s.currency} className="rounded-xl border-2 border-gray-200 bg-white p-3 space-y-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{s.currency}</span>
                    <Globe className="w-4 h-4 text-gray-300" />
                  </div>
                  <p className="text-base font-bold text-gray-900 tabular-nums break-all">
                    {s.currency} {s.currentBalance.toLocaleString(getCurrencyLocale(s.currency), { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </p>
                  <div className="text-[11px] space-y-0.5">
                    <div className="flex items-center gap-1 text-success">
                      <TrendingUp className="w-3 h-3 shrink-0" />
                      {s.currency} {s.totalDeposits.toLocaleString(getCurrencyLocale(s.currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex items-center gap-1 text-danger">
                      <TrendingDown className="w-3 h-3 shrink-0" />
                      {s.currency} {s.totalWithdrawals.toLocaleString(getCurrencyLocale(s.currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Transactions table */}
          {fxLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 rounded bg-gray-100 animate-pulse" />)}
            </div>
          ) : fxTransactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Globe className="w-10 h-10 text-gray-300" />
              <p className="text-sm text-gray-500">No FX transactions found{filterFxCcy ? ` for ${filterFxCcy}` : ''}.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">
                  FX Transactions{filterFxCcy ? ` — ${filterFxCcy}` : ' (All currencies)'}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">CCY</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-success uppercase tracking-wide">Deposit</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-danger uppercase tracking-wide">Withdrawal</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Narration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* Opening balance B/F row — only when a single currency is selected */}
                    {filterFxCcy && fxOpeningBalance > 0 && fxViewState.page === 0 && (
                      <tr className="bg-blue-50/40">
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs italic">—</td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-mono font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{filterFxCcy}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-primary text-xs font-semibold">
                          {fxOpeningBalance.toLocaleString(getCurrencyLocale(filterFxCcy), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-300">—</td>
                        <td className="px-4 py-3 text-right text-xs text-gray-300">—</td>
                        <td className="px-4 py-3 text-xs text-gray-400 italic hidden md:table-cell">Balance Brought Forward</td>
                      </tr>
                    )}
                    {fxTransactions
                      .slice(fxViewState.page * fxViewState.pageSize, (fxViewState.page + 1) * fxViewState.pageSize)
                      .map(r => {
                        const fmt = (n: number) => n.toLocaleString(getCurrencyLocale(r.currency), { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                        return (
                          <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{formatDate(r.date)}</td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] font-mono font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{r.currency}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-success text-xs">
                              {r.deposit > 0 ? fmt(r.deposit) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-danger text-xs">
                              {r.withdrawal > 0 ? fmt(r.withdrawal) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-700 text-xs">
                              {fmt(r.running_balance)}
                            </td>
                            <td className="px-4 py-3 text-gray-600 text-xs hidden md:table-cell max-w-[220px] truncate">
                              {r.narration ?? '—'}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={fxViewState.page}
                pageSize={fxViewState.pageSize}
                total={fxTransactions.length}
                onPageChange={fxViewState.setPage}
                variant="full"
              />
            </div>
          )}
        </>
      )}

      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildIntraflowDetailItems(meta: IntraflowMeta, row: LedgerRow): DetailItem[] {
  const direction = row.outflow > 0 ? 'Debit (sent out)' : 'Credit (received)'
  const statusBadge =
    !meta.status || meta.status === 'active' ? 'bg-green-100 text-green-700' :
    meta.status === 'reversed'               ? 'bg-red-100 text-red-700'     :
                                               'bg-gray-100 text-gray-600'
  return [
    { label: 'Amount',    value: row.outflow > 0 ? `−${row.outflow.toLocaleString()}` : `+${row.inflow.toLocaleString()}`, mono: true },
    { label: 'Direction', value: direction },
    { label: 'From',      value: `${meta.fromCategory} › ${meta.fromPortion}` },
    { label: 'To',        value: `${meta.toCategory} › ${meta.toPortion}` },
    { label: 'Note',      value: meta.note, breakAll: true },
    { label: 'Status',    value: meta.status ?? 'active', badge: statusBadge },
  ]
}
