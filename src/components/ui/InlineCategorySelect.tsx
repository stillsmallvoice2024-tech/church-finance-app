import { useState, useRef, useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { useAddCategory } from '../../hooks/useMutations'

interface Props {
  value:      string
  onChange:   (name: string) => void
  categories: { id: string; name: string }[]
  onRefresh:  () => void | Promise<void>
  selectCls?: string
  disabled?:  boolean
}

export function InlineCategorySelect({ value, onChange, categories, onRefresh, selectCls, disabled }: Props) {
  const [adding,    setAdding]    = useState(false)
  const [newName,   setNewName]   = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { mutate: addCategory, loading: saving } = useAddCategory()

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const handleSave = async () => {
    const name = newName.trim()
    if (!name) return
    setSaveError(null)
    try {
      await addCategory({ name })
      await onRefresh()
      onChange(name)
      setAdding(false)
      setNewName('')
    } catch (e: unknown) {
      setSaveError((e as { message?: string })?.message ?? 'Failed to create category')
    }
  }

  const handleCancel = () => {
    setAdding(false)
    setNewName('')
    setSaveError(null)
  }

  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleSave() }
              if (e.key === 'Escape') handleCancel()
            }}
            placeholder="New category name…"
            className="flex-1 px-2 py-1.5 text-sm border border-primary/60 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !newName.trim()}
            className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 transition-colors"
            title="Save category"
          >
            {saving
              ? <span className="block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Check className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === '__new__') {
          setAdding(true)
        } else {
          onChange(e.target.value)
        }
      }}
      disabled={disabled}
      className={selectCls ?? 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white'}
    >
      <option value="">Select category…</option>
      {categories.map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
      <option value="__new__">＋ Add new category…</option>
    </select>
  )
}
