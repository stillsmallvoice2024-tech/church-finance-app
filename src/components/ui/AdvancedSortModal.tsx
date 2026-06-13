import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import type { SortField, SortDirection, AdvancedSortLevel } from '../../utils/sortUtils'
import { directionLabel } from '../../utils/sortUtils'

const MAX_LEVELS = 3

interface Props {
  open: boolean
  onClose: () => void
  sortFields: SortField[]
  levels: AdvancedSortLevel[]
  onApply: (levels: AdvancedSortLevel[]) => void
}

export function AdvancedSortModal({ open, onClose, sortFields, levels, onApply }: Props) {
  const [local, setLocal] = useState<AdvancedSortLevel[]>([])

  useEffect(() => {
    if (open) setLocal(levels.length > 0 ? [...levels] : [{ key: sortFields[0]?.key ?? '', dir: 'desc' }])
  }, [open])

  function updateLevel(i: number, patch: Partial<AdvancedSortLevel>) {
    setLocal(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  function removeLevel(i: number) {
    setLocal(prev => prev.filter((_, idx) => idx !== i))
  }

  function addLevel() {
    const usedKeys = new Set(local.map(l => l.key))
    const next = sortFields.find(f => !usedKeys.has(f.key)) ?? sortFields[0]
    if (!next) return
    setLocal(prev => [...prev, { key: next.key, dir: 'desc' }])
  }

  function handleApply() {
    const valid = local.filter(l => l.key)
    onApply(valid)
    onClose()
  }

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => { onApply([]); onClose() }}
        className="text-xs text-gray-500 hover:text-gray-600 transition-colors"
      >
        Clear all
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleApply}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium">
          Apply
        </button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="Advanced Sort" size="max-w-sm" footer={footer}>
      <div className="space-y-2.5">
        <p className="text-xs text-gray-500">Sort by up to {MAX_LEVELS} fields in priority order.</p>

        {local.map((level, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 w-4 shrink-0 text-center">{i + 1}</span>

            <select
              value={level.key}
              onChange={e => updateLevel(i, { key: e.target.value })}
              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            >
              {sortFields.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
              {(['desc', 'asc'] as SortDirection[]).map(d => {
                const field = sortFields.find(f => f.key === level.key) ?? sortFields[0]
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => updateLevel(i, { dir: d })}
                    className={`px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      level.dir === d
                        ? 'bg-primary text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {directionLabel(field?.type ?? 'text', d).split(' ')[0]}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => removeLevel(i)}
              disabled={local.length === 1}
              className="shrink-0 p-1 text-gray-400 hover:text-danger transition-colors disabled:opacity-30"
              aria-label="Remove level"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {local.length < MAX_LEVELS && (
          <button
            type="button"
            onClick={addLevel}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add sort level
          </button>
        )}
      </div>
    </Modal>
  )
}
