import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { saveOutflowType, type OutflowType } from '../../hooks/useOutflowTypes'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6',
  '#ec4899', '#64748b', '#0ea5e9', '#a16207',
]

interface Props {
  open:         boolean
  onClose:      () => void
  onSaved:      () => void
  editRecord?:  OutflowType | null
}

export function AddOutflowTypeModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit = !!editRecord

  const [name,    setName]    = useState('')
  const [color,   setColor]   = useState(PRESET_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editRecord) {
      setName(editRecord.name)
      setColor(editRecord.color)
    } else {
      setName('')
      setColor(PRESET_COLORS[0])
    }
  }, [open, editRecord])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true); setError(null)
    try {
      await saveOutflowType({ name: name.trim(), color }, editRecord?.id)
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
      <button type="button" onClick={onClose} disabled={loading}
        className="px-4 min-h-[44px] text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
        Cancel
      </button>
      <button type="submit" form="outflow-type-form" disabled={loading}
        className="px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Type'}
      </button>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Outflow Type' : 'Add Outflow Type'} size="max-w-sm" footer={footerEl}>
      <form id="outflow-type-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <Field label="Name *">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Medical, Transport, Utilities"
            className={inputCls(!name.trim() && !!error)}
            autoFocus
          />
        </Field>

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Color</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-5 h-5 rounded-full border border-gray-200 shrink-0" style={{ backgroundColor: color }} />
            <input
              type="text"
              value={color}
              onChange={e => setColor(e.target.value)}
              placeholder="#hex"
              className="flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
