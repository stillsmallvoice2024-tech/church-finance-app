import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { TypeColorPicker, TYPE_PRESET_COLORS } from '../ui/TypeColorPicker'
import { SearchableSelect } from '../ui/SearchableSelect'
import { useBanks } from '../../hooks/useBanks'
import {
  saveOutflowType,
  syncOutflowTypeCategoryMappings,
  fetchOutflowTypeMappings,
  type OutflowType,
} from '../../hooks/useOutflowTypes'
import {
  fetchManualOutflowRules,
  saveManualOutflowRules,
  type ManualOutflowRuleType,
} from '../../hooks/useOutflowClassificationRules'
import { useCategories } from '../../hooks/useCategories'

interface RuleDraft {
  rule_type:  ManualOutflowRuleType
  rule_value: string
}

const EMPTY_RULE: RuleDraft = { rule_type: 'keyword', rule_value: '' }

interface Props {
  open:        boolean
  onClose:     () => void
  onSaved:     () => void
  editRecord?: OutflowType | null
}

export function AddOutflowTypeModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit   = !!editRecord
  const isLocked = !!editRecord?.is_locked

  const { categories } = useCategories()
  const { banks } = useBanks()   // org-scoped — RLS + explicit org_id filter (see useBanks.ts)

  const [name,            setName]            = useState('')
  const [color,           setColor]           = useState(TYPE_PRESET_COLORS[0])
  const [linkedCatIds,       setLinkedCatIds]       = useState<string[]>([])
  const [rules,              setRules]              = useState<RuleDraft[]>([EMPTY_RULE])
  const [originalName,       setOriginalName]       = useState('')
  const [loading,            setLoading]            = useState(false)
  const [error,              setError]              = useState<string | null>(null)
  const [linkedCatsModified, setLinkedCatsModified] = useState(false)

  // Dirty detection
  const initialRef = useRef({ name: '', color: TYPE_PRESET_COLORS[0] })
  const initialRulesRef = useRef<RuleDraft[]>([EMPTY_RULE])
  const modalRef = useRef<ModalHandle>(null)
  const isDirty =
    name !== initialRef.current.name ||
    color !== initialRef.current.color ||
    linkedCatsModified ||
    JSON.stringify(rules) !== JSON.stringify(initialRulesRef.current)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLinkedCatsModified(false)
    if (editRecord) {
      setName(editRecord.name)
      setOriginalName(editRecord.name)
      setColor(editRecord.color)
      initialRef.current = { name: editRecord.name, color: editRecord.color }
      setRules([EMPTY_RULE])
      initialRulesRef.current = [EMPTY_RULE]
      // Load current mappings
      fetchOutflowTypeMappings(editRecord.id).then(ids => setLinkedCatIds(ids))
      // Load this type's own recognition rules (empty when the migration isn't applied)
      fetchManualOutflowRules(editRecord.id).then(rs => {
        const drafts: RuleDraft[] = rs.length > 0
          ? rs.map(r => ({ rule_type: r.rule_type as ManualOutflowRuleType, rule_value: r.rule_value }))
          : [EMPTY_RULE]
        setRules(drafts)
        initialRulesRef.current = drafts
      })
    } else {
      setName('')
      setOriginalName('')
      setColor(TYPE_PRESET_COLORS[0])
      setLinkedCatIds([])
      setRules([EMPTY_RULE])
      initialRef.current = { name: '', color: TYPE_PRESET_COLORS[0] }
      initialRulesRef.current = [EMPTY_RULE]
    }
  }, [open, editRecord])

  const addRule    = () => setRules(prev => [...prev, { ...EMPTY_RULE }])
  const removeRule = (i: number) => setRules(prev => prev.filter((_, idx) => idx !== i))
  const updateRule = (i: number, patch: Partial<RuleDraft>) =>
    setRules(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const handleToggleCategory = (catId: string) => {
    setLinkedCatsModified(true)
    setLinkedCatIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (isLocked) return
    setLoading(true); setError(null)
    try {
      const nameChanged = isEdit && name.trim() !== originalName
      const savedId = await saveOutflowType(
        { name: name.trim(), color },
        editRecord?.id,
        nameChanged // markManuallyRenamed — user explicitly renamed
      )
      await syncOutflowTypeCategoryMappings(savedId, linkedCatIds)
      // Rules last: on a database without the outflow_classification_rules
      // migration this throws, and name/color/category links are already saved.
      await saveManualOutflowRules(savedId, rules.filter(r => r.rule_value.trim()))
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={() => modalRef.current?.requestClose()} disabled={loading}
        className="px-4 min-h-[44px] text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
        Cancel
      </button>
      {!isLocked && (
        <button type="submit" form="outflow-type-form" disabled={loading}
          className="px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
          {loading && <ButtonSpinner />}
          {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Type'}
        </button>
      )}
    </div>
  )

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Outflow Type' : 'Add Outflow Type'}
      size="max-w-lg"
      isDirty={isDirty && !isLocked}
      disableClose={loading}
      footer={footerEl}
    >
      <form id="outflow-type-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        {isLocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            This is a system type and cannot be edited.
          </div>
        )}

        <Field label="Name *">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Medical, Transport, Utilities"
            className={inputCls(!name.trim() && !!error)}
            autoFocus
            disabled={isLocked}
          />
        </Field>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-600">Color</p>
          <TypeColorPicker value={color} onChange={setColor} disabled={isLocked} />
        </div>

        {/* Recognition rules — auto-assign this type on import */}
        {!isLocked && (
          <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500">Recognition Rules</p>
              <button
                type="button" onClick={addRule}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-light transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add rule
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Debit rows on import are auto-assigned this outflow type when any rule fires.
              You can always change the type on the row before importing.
            </p>
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={rule.rule_type}
                    onChange={e => updateRule(i, {
                      rule_type:  e.target.value as ManualOutflowRuleType,
                      rule_value: '', // previous value doesn't carry meaning across types
                    })}
                    className="shrink-0 px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="keyword">Keyword</option>
                    <option value="bank">Bank</option>
                  </select>
                  {rule.rule_type === 'bank' ? (
                    <SearchableSelect
                      value={rule.rule_value}
                      onChange={v => updateRule(i, { rule_value: v })}
                      options={banks.map(b => ({ value: b.id, label: b.name }))}
                      placeholder="— Select bank —"
                      className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  ) : (
                    <input
                      type="text"
                      value={rule.rule_value}
                      onChange={e => updateRule(i, { rule_value: e.target.value })}
                      placeholder="e.g. fuel, diesel"
                      className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  )}
                  <button
                    type="button" onClick={() => removeRule(i)}
                    className="p-1 text-gray-400 hover:text-danger rounded transition-colors"
                    disabled={rules.length === 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              <span className="font-medium">Keyword:</span> matched against the transaction description
              (case-insensitive).<br />
              <span className="font-medium">Bank:</span> debit rows imported for the selected bank get this type
              automatically — overrides keyword matches, so it fits a bank account dedicated to one purpose.
            </p>
          </div>
        )}

        {/* Linked categories */}
        {categories.length > 0 && !isLocked && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">
              Linked Categories
              <span className="ml-1 text-gray-400 font-normal">(suggested default when category is selected)</span>
            </p>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {categories.map(cat => (
                <label key={cat.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={linkedCatIds.includes(cat.id)}
                    onChange={() => handleToggleCategory(cat.id)}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                  <span className="text-sm text-gray-700">{cat.name}</span>
                </label>
              ))}
            </div>
            {linkedCatIds.length > 0 && (
              <p className="text-xs text-gray-500">
                {linkedCatIds.length} categor{linkedCatIds.length === 1 ? 'y' : 'ies'} linked
              </p>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
