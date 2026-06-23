import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle } from 'lucide-react'
import type { ModalHandle } from '../ui/Modal'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { ASSET_TYPES, saveAsset, type Asset } from '../../hooks/useAssets'

// ── Schema ─────────────────────────────────────────────────────────────────────

const schema = z.object({
  name:              z.string().min(1, 'Name is required'),
  asset_type:        z.string().min(1, 'Type is required'),
  cost:              z.coerce.number().min(0, 'Cost must be ≥ 0'),
  purchase_date:     z.string().min(1, 'Purchase date is required'),
  useful_life_years: z.coerce.number().min(0).nullish().transform(v => v || null),
  salvage_value:     z.coerce.number().min(0).default(0),
  notes:             z.string().optional().transform(v => v || null),
})

type FormValues = z.infer<typeof schema>

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open:         boolean
  onClose:      () => void
  onSaved:      () => void
  editRecord?:  Asset | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AddAssetModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit = !!editRecord
  const modalRef = useRef<ModalHandle>(null)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', asset_type: 'Equipment', cost: 0,
      purchase_date: '', useful_life_years: null, salvage_value: 0, notes: '',
    },
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editRecord) {
      reset({
        name:              editRecord.name,
        asset_type:        editRecord.asset_type,
        cost:              editRecord.cost,
        purchase_date:     editRecord.purchase_date,
        useful_life_years: editRecord.useful_life_years,
        salvage_value:     editRecord.salvage_value,
        notes:             editRecord.notes ?? '',
      })
    } else {
      reset({
        name: '', asset_type: 'Equipment', cost: 0,
        purchase_date: '', useful_life_years: null, salvage_value: 0, notes: '',
      })
    }
  }, [open, editRecord, reset])

  const onSubmit = async (values: FormValues) => {
    setSaving(true); setError(null)
    try {
      await saveAsset(
        {
          name:              values.name,
          asset_type:        values.asset_type,
          cost:              values.cost,
          purchase_date:     values.purchase_date,
          useful_life_years: values.useful_life_years ?? null,
          salvage_value:     values.salvage_value,
          notes:             values.notes ?? null,
        },
        editRecord?.id,
      )
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
        type="submit"
        form="add-asset-form"
        disabled={saving}
        className="flex items-center gap-2 px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
      >
        {saving && <ButtonSpinner />}
        {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Asset'}
      </button>
    </div>
  )

  return (
    <Modal
      ref={modalRef}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Asset' : 'Add Asset'}
      size="max-w-lg"
      isDirty={isDirty}
      disableClose={saving}
      footer={footerEl}
    >
      <form id="add-asset-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Name *" error={errors.name?.message}>
              <input
                {...register('name')}
                placeholder="e.g. Projector, Church Van"
                className={inputCls(!!errors.name)}
              />
            </Field>
          </div>

          <Field label="Type *" error={errors.asset_type?.message}>
            <select {...register('asset_type')} className={`${inputCls(!!errors.asset_type)} bg-white`}>
              {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Purchase Date *" error={errors.purchase_date?.message}>
            <input type="date" {...register('purchase_date')} className={inputCls(!!errors.purchase_date)} />
          </Field>

          <Field label="Cost *" error={errors.cost?.message}>
            <input type="number" step="0.01" min="0" {...register('cost')} className={inputCls(!!errors.cost)} />
          </Field>

          <Field label="Salvage Value" error={errors.salvage_value?.message}>
            <input type="number" step="0.01" min="0" {...register('salvage_value')} className={inputCls(!!errors.salvage_value)} />
          </Field>

          <Field label="Useful Life (years)" error={errors.useful_life_years?.message}>
            <input
              type="number" step="0.5" min="0"
              placeholder="Leave blank if not depreciated"
              {...register('useful_life_years')}
              className={inputCls(!!errors.useful_life_years)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            {...register('notes')}
            rows={2}
            placeholder="Optional notes"
            className={inputCls(false)}
          />
        </Field>

      </form>
    </Modal>
  )
}
