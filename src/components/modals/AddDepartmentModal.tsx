import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { saveDepartment, type Department } from '../../hooks/useDepartments'

interface Props {
  open:        boolean
  onClose:     () => void
  onSaved:     () => void
  editRecord?: Department | null
}

export function AddDepartmentModal({ open, onClose, onSaved, editRecord }: Props) {
  const isEdit = !!editRecord

  const [name,        setName]        = useState('')
  const [code,        setCode]        = useState('')
  const [description, setDescription] = useState('')
  const [active,      setActive]      = useState(true)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const initialRef = useRef({ name: '', code: '', description: '', active: true })
  const isDirty =
    name        !== initialRef.current.name        ||
    code        !== initialRef.current.code        ||
    description !== initialRef.current.description ||
    active      !== initialRef.current.active

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editRecord) {
      const init = {
        name:        editRecord.name,
        code:        editRecord.code        ?? '',
        description: editRecord.description ?? '',
        active:      editRecord.active,
      }
      setName(init.name)
      setCode(init.code)
      setDescription(init.description)
      setActive(init.active)
      initialRef.current = init
    } else {
      const init = { name: '', code: '', description: '', active: true }
      setName(''); setCode(''); setDescription(''); setActive(true)
      initialRef.current = init
    }
  }, [open, editRecord])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true); setError(null)
    try {
      await saveDepartment({ name, code, description, active }, editRecord?.id)
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
      <button type="submit" form="department-form" disabled={loading}
        className="px-5 min-h-[44px] text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2">
        {loading && <ButtonSpinner />}
        {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Department'}
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Department / Unit' : 'Add Department / Unit'}
      size="max-w-md"
      isDirty={isDirty}
      footer={footerEl}
    >
      <form id="department-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <Field label="Name *">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Finance, Administration, Welfare"
            className={inputCls(!name.trim() && !!error)}
            autoFocus
          />
        </Field>

        <Field label="Code">
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="e.g. FIN, ADM, WLF (optional)"
            className={inputCls(false)}
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description…"
            className={`${inputCls(false)} resize-none`}
          />
        </Field>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          <span className="text-sm font-medium text-gray-700">Active</span>
          <span className="text-xs text-gray-400">(inactive departments are hidden from transaction forms)</span>
        </label>
      </form>
    </Modal>
  )
}
