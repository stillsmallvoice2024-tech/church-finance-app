import { useState, useEffect, useRef } from 'react'
import type { ModalHandle } from '../ui/Modal'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { TechDetails } from '../ui/TechDetails'
import { TypeColorPicker, TYPE_PRESET_COLORS } from '../ui/TypeColorPicker'
import {
  saveIncomeType, useSpecialConfigGroupOptions,
  type IncomeType, type IncomeTypeInput,
} from '../../hooks/useIncomeTypes'

const MIGRATION_SQL =
`CREATE TABLE IF NOT EXISTS public.income_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text,
  color             text NOT NULL DEFAULT '#6366f1',
  special_config_id uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.income_type_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_type_id uuid NOT NULL REFERENCES public.income_types(id) ON DELETE CASCADE,
  rule_type      text NOT NULL CHECK (rule_type IN ('keyword','stage_code')),
  rule_value     text NOT NULL,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS income_type_id uuid
    REFERENCES public.income_types(id) ON DELETE SET NULL;

-- RLS policies (required for authenticated users to read/write)
ALTER TABLE public.income_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_type_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON public.income_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON public.income_type_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);`

// ── Rule row type ──────────────────────────────────────────────────────────────

interface RuleDraft {
  rule_type:  'keyword' | 'stage_code'
  rule_value: string
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open:        boolean
  onClose:     () => void
  onSaved:     () => void
  editRecord?: IncomeType | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AddIncomeTypeModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit = !!editRecord
  const { options: groupOptions, reload: reloadSpecialGroups } = useSpecialConfigGroupOptions()

  const [name,                setName]                = useState('')
  const [description,         setDescription]         = useState('')
  const [color,               setColor]               = useState(TYPE_PRESET_COLORS[0])
  const [specialConfigGroup,  setSpecialConfigGroup]  = useState('')
  const [rules,          setRules]          = useState<RuleDraft[]>([{ rule_type: 'keyword', rule_value: '' }])
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  const isMigrationError = !!error && /relation.*does not exist|does not exist/i.test(error)

  // Dirty detection — compare to snapshot taken on open
  const initialRef = useRef({ name: '', description: '', color: TYPE_PRESET_COLORS[0], specialConfigGroup: '' })
  const modalRef = useRef<ModalHandle>(null)
  const isDirty =
    name !== initialRef.current.name ||
    description !== initialRef.current.description ||
    color !== initialRef.current.color ||
    specialConfigGroup !== initialRef.current.specialConfigGroup

  // Populate form when editing
  useEffect(() => {
    if (!open) return
    reloadSpecialGroups()
    setError(null)
    if (editRecord) {
      setName(editRecord.name)
      setDescription(editRecord.description ?? '')
      setColor(editRecord.color)
      setSpecialConfigGroup(editRecord.special_config_group_id ?? '')
      setRules(
        editRecord.rules.length > 0
          ? editRecord.rules.map(r => ({ rule_type: r.rule_type, rule_value: r.rule_value }))
          : [{ rule_type: 'keyword', rule_value: '' }]
      )
      initialRef.current = {
        name: editRecord.name,
        description: editRecord.description ?? '',
        color: editRecord.color,
        specialConfigGroup: editRecord.special_config_group_id ?? '',
      }
    } else {
      setName(''); setDescription(''); setColor(TYPE_PRESET_COLORS[0])
      setSpecialConfigGroup('')
      setRules([{ rule_type: 'keyword', rule_value: '' }])
      initialRef.current = { name: '', description: '', color: TYPE_PRESET_COLORS[0], specialConfigGroup: '' }
    }
  }, [open, editRecord])

  const addRule = () => setRules(prev => [...prev, { rule_type: 'keyword', rule_value: '' }])
  const removeRule = (i: number) => setRules(prev => prev.filter((_, idx) => idx !== i))
  const updateRule = (i: number, patch: Partial<RuleDraft>) =>
    setRules(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(null)
    try {
      const input: IncomeTypeInput = {
        name:             name.trim(),
        description:      description.trim() || undefined,
        color,
        special_config_group_id: specialConfigGroup || null,
        rules:            rules.filter(r => r.rule_value.trim()),
      }
      await saveIncomeType(input, editRecord?.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const footerEl = (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={() => modalRef.current?.requestClose()}
        disabled={saving}
        className="px-4 min-h-[44px] text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
      >
        {saving && <ButtonSpinner />}
        {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Income Type'}
      </button>
    </div>
  )

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Income Type' : 'Add Income Type'}
      size="max-w-lg"
      isDirty={isDirty}
      disableClose={saving}
      footer={footerEl}
    >
      <div className="space-y-4">

        {/* Error / Migration hint */}
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="flex-1">
              {isMigrationError
                ? (
                  <>
                    <p>Income types aren't fully set up yet. Ask your administrator to enable this feature, then try again.</p>
                    <TechDetails>{MIGRATION_SQL}</TechDetails>
                  </>
                )
                : error}
            </div>
          </div>
        )}

        {/* Name */}
        <Field label="Name *">
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Sunday Tithe"
            className={inputCls(!name.trim() && !!error)}
          />
        </Field>

        {/* Description */}
        <Field label="Description">
          <input
            type="text" value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Optional note about this income type"
            className={inputCls(false)}
          />
        </Field>

        {/* Color */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-600">Color</p>
          <TypeColorPicker value={color} onChange={setColor} />
        </div>

        {/* Recognition Rules */}
        <div className="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recognition Rules</p>
            <button
              type="button" onClick={addRule}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-light transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add rule
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            Rules run top-to-bottom. A transaction matches this type if ANY rule fires.
          </p>
          <div className="space-y-2">
            {rules.map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={rule.rule_type}
                  onChange={e => updateRule(i, { rule_type: e.target.value as 'keyword' | 'stage_code' })}
                  className="shrink-0 px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="keyword">Keyword</option>
                  <option value="stage_code">Stage Code</option>
                </select>
                <input
                  type="text"
                  value={rule.rule_value}
                  onChange={e => updateRule(i, { rule_value: e.target.value })}
                  placeholder={rule.rule_type === 'keyword' ? 'e.g. tithe, tith' : 'e.g. Tithe Fund'}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
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
          <p className="text-[11px] text-gray-400">
            <span className="font-medium">Keyword:</span> substring match on description (case-insensitive).<br />
            <span className="font-medium">Stage Code:</span> exact match on the transaction's Stage Code 1 / category.
          </p>
        </div>

        {/* Linked special config group */}
        <Field label="Auto-apply Config Group (optional)">
          <select
            value={specialConfigGroup}
            onChange={e => setSpecialConfigGroup(e.target.value)}
            className={`${inputCls(false)} bg-white`}
          >
            <option value="">— None —</option>
            {groupOptions.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {specialConfigGroup && (
            <p className="text-[11px] text-gray-400 mt-1">
              When this income type is selected on a transaction, the active version of this config group will be auto-applied.
            </p>
          )}
        </Field>

      </div>
    </Modal>
  )
}

