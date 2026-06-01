import { useEffect, useRef, useState } from 'react'
import { Modal, type ModalHandle } from '../ui/Modal'
import { Field, inputCls } from '../ui/FormField'
import { ButtonSpinner } from '../ui/ButtonSpinner'
import { TypeColorPicker, TYPE_PRESET_COLORS } from '../ui/TypeColorPicker'
import {
  saveOutflowType,
  syncOutflowTypeCategoryMappings,
  fetchOutflowTypeMappings,
  type OutflowType,
} from '../../hooks/useOutflowTypes'
import { useCategories } from '../../hooks/useCategories'

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

  const [name,            setName]            = useState('')
  const [color,           setColor]           = useState(TYPE_PRESET_COLORS[0])
  const [linkedCatIds,    setLinkedCatIds]    = useState<string[]>([])
  const [originalName,    setOriginalName]    = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  // Dirty detection
  const initialRef = useRef({ name: '', color: TYPE_PRESET_COLORS[0] })
  const modalRef = useRef<ModalHandle>(null)
  const isDirty = name !== initialRef.current.name || color !== initialRef.current.color

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editRecord) {
      setName(editRecord.name)
      setOriginalName(editRecord.name)
      setColor(editRecord.color)
      initialRef.current = { name: editRecord.name, color: editRecord.color }
      // Load current mappings
      fetchOutflowTypeMappings(editRecord.id).then(ids => setLinkedCatIds(ids))
    } else {
      setName('')
      setOriginalName('')
      setColor(TYPE_PRESET_COLORS[0])
      setLinkedCatIds([])
      initialRef.current = { name: '', color: TYPE_PRESET_COLORS[0] }
    }
  }, [open, editRecord])

  const handleToggleCategory = (catId: string) => {
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
      size="max-w-md"
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
              <p className="text-xs text-gray-400">
                {linkedCatIds.length} categor{linkedCatIds.length === 1 ? 'y' : 'ies'} linked
              </p>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
