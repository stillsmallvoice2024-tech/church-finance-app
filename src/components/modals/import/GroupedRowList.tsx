import { useMemo, useState } from 'react'
import { ChevronDown, Sparkles, BookmarkPlus } from 'lucide-react'
import { CollapsibleSection } from '../../ui/CollapsibleSection'
import { PaginationBar } from '../../ui/PaginationBar'
import { groupImportRows, splitGroups, type ImportRowGroup } from '../../../utils/groupImportRows'
import type { ImportRow } from '../../../types/importRow'

// ── Grouped configuration view ───────────────────────────────────────────────
//
// A 10,000-row statement usually holds only 50–200 distinct narration patterns.
// Configuring patterns instead of rows is the difference between a few dozen
// interactions and several thousand.
//
// Display contract — the raw statement text is never replaced:
//   • the header shows the cleaned pattern used for bucketing, WITH the full
//     raw description of a sample row directly beneath it
//   • expanding a group lists its rows, each showing its OWN raw description
//   • this view is opt-in; table view is unchanged and remains the default

export interface GroupFieldOption { value: string; label: string }

interface GroupedRowListProps {
  rows: ImportRow[]
  /** Rendered per group; lets the caller supply inflow vs outflow controls. */
  renderControls: (group: ImportRowGroup) => React.ReactNode
  /** Formats a group's summed amount. */
  formatAmount: (n: number) => string
  selectedRis: Set<number>
  onToggleGroup: (ris: number[], selected: boolean) => void
  /** Persist this group as a reusable classification rule. */
  onSaveAsRule?: (group: ImportRowGroup) => void
  savingRuleKey?: string | null
  emptyLabel: string
}

const GROUPS_PER_PAGE = 25

export function GroupedRowList({
  rows,
  renderControls,
  formatAmount,
  selectedRis,
  onToggleGroup,
  onSaveAsRule,
  savingRuleKey,
  emptyLabel,
}: GroupedRowListProps) {
  const groups = useMemo(() => groupImportRows(rows), [rows])
  const { needsAttention, sorted } = useMemo(() => splitGroups(groups), [groups])

  if (groups.length === 0) {
    return <div className="py-8 text-center text-xs text-gray-500">{emptyLabel}</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        {groups.length.toLocaleString()} pattern{groups.length === 1 ? '' : 's'} across{' '}
        {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}. Configuring a pattern
        applies to every row in it.
      </p>

      <GroupSection
        title={`Needs attention (${needsAttention.length})`}
        tone="attention"
        groups={needsAttention}
        defaultOpen
        renderControls={renderControls}
        formatAmount={formatAmount}
        selectedRis={selectedRis}
        onToggleGroup={onToggleGroup}
        onSaveAsRule={onSaveAsRule}
        savingRuleKey={savingRuleKey}
      />

      <GroupSection
        title={`Sorted (${sorted.length})`}
        tone="sorted"
        groups={sorted}
        defaultOpen={needsAttention.length === 0}
        renderControls={renderControls}
        formatAmount={formatAmount}
        selectedRis={selectedRis}
        onToggleGroup={onToggleGroup}
        onSaveAsRule={onSaveAsRule}
        savingRuleKey={savingRuleKey}
      />
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────

interface GroupSectionProps extends Omit<GroupedRowListProps, 'rows' | 'emptyLabel'> {
  title: string
  tone: 'attention' | 'sorted'
  groups: ImportRowGroup[]
  defaultOpen: boolean
}

function GroupSection({
  title, tone, groups, defaultOpen, renderControls, formatAmount,
  selectedRis, onToggleGroup, onSaveAsRule, savingRuleKey,
}: GroupSectionProps) {
  const [page, setPage] = useState(0)

  if (groups.length === 0) return null

  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE))
  const safePage   = Math.min(page, totalPages - 1)
  const paged      = groups.slice(safePage * GROUPS_PER_PAGE, (safePage + 1) * GROUPS_PER_PAGE)

  return (
    <CollapsibleSection label={title} defaultOpen={defaultOpen}>
      <div className="space-y-2">
        {paged.map(group => (
          <GroupCard
            key={group.key}
            group={group}
            tone={tone}
            renderControls={renderControls}
            formatAmount={formatAmount}
            selectedRis={selectedRis}
            onToggleGroup={onToggleGroup}
            onSaveAsRule={onSaveAsRule}
            savingRuleKey={savingRuleKey}
          />
        ))}
      </div>
      <PaginationBar
        page={safePage}
        pageSize={GROUPS_PER_PAGE}
        total={groups.length}
        onPageChange={setPage}
        variant="compact"
      />
    </CollapsibleSection>
  )
}

// ── Single group ─────────────────────────────────────────────────────────────

interface GroupCardProps extends Omit<GroupSectionProps, 'groups' | 'title' | 'defaultOpen'> {
  group: ImportRowGroup
}

function GroupCard({
  group, tone, renderControls, formatAmount,
  selectedRis, onToggleGroup, onSaveAsRule, savingRuleKey,
}: GroupCardProps) {
  const [expanded, setExpanded] = useState(false)

  const allSelected = group.ris.every(ri => selectedRis.has(ri))
  const someSelected = !allSelected && group.ris.some(ri => selectedRis.has(ri))

  return (
    <div className={`rounded-lg border overflow-hidden ${
      tone === 'attention' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-start gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={allSelected}
          ref={el => { if (el) el.indeterminate = someSelected }}
          onChange={e => onToggleGroup(group.ris, e.target.checked)}
          className="w-3.5 h-3.5 mt-1 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-800 truncate">{group.label}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
              {group.count.toLocaleString()} row{group.count === 1 ? '' : 's'}
            </span>
            <span className="text-[11px] text-gray-500 shrink-0">{formatAmount(group.total)}</span>
          </div>
          {/* Full statement text, verbatim — the cleaned label above is only a
              bucketing key and must never stand in for the real description. */}
          <p className="mt-0.5 text-[11px] text-gray-400 truncate" title={group.sampleRaw}>
            {group.sampleRaw}
          </p>
        </div>

        {onSaveAsRule && group.configured && (
          <button
            type="button"
            onClick={() => onSaveAsRule(group)}
            disabled={savingRuleKey === group.key}
            title="Remember this configuration for future imports"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
          >
            <BookmarkPlus className="w-3 h-3" />
            {savingRuleKey === group.key ? 'Saving…' : 'Save as rule'}
          </button>
        )}

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
          title={expanded ? 'Hide rows' : 'Show rows'}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
        {renderControls(group)}
        {tone === 'sorted' && (
          <Sparkles className="w-3 h-3 text-indigo-400" aria-label="Auto-classified" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-white/60 max-h-52 overflow-y-auto divide-y divide-gray-100">
          {group.rows.map(row => (
            <div key={`${row.kind}-${row.ri}`} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={selectedRis.has(row.ri)}
                onChange={e => onToggleGroup([row.ri], e.target.checked)}
                className="w-3 h-3 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0"
              />
              <span className="text-gray-400 font-mono shrink-0">{row.ri + 1}</span>
              <span className="text-gray-400 shrink-0">{row.date}</span>
              {/* Each row shows its OWN raw description in full. */}
              <span className="text-gray-700 truncate flex-1" title={row.description}>
                {row.description || '—'}
              </span>
              <span className="text-gray-600 font-medium shrink-0">{formatAmount(row.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
