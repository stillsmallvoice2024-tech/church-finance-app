import { useState, useRef, useEffect, useId } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { useAddCategory } from '../../hooks/useMutations'

interface Props {
  value:      string
  onChange:   (name: string) => void
  categories: { id: string; name: string }[]
  onRefresh:  () => void | Promise<void>
  selectCls?: string
  disabled?:  boolean
}

const DEFAULT_CLS =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white'

export function InlineCategorySelect({
  value,
  onChange,
  categories,
  onRefresh,
  selectCls,
  disabled,
}: Props) {
  // ── Add-new-category mode (preserved from original) ────────────────────────
  const [adding,    setAdding]    = useState(false)
  const [newName,   setNewName]   = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const newCatInputRef = useRef<HTMLInputElement>(null)

  const { mutate: addCategory, loading: saving } = useAddCategory()

  useEffect(() => {
    if (adding) newCatInputRef.current?.focus()
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

  // ── Combobox state ─────────────────────────────────────────────────────────
  const [open,        setOpen]        = useState(false)
  const [query,       setQuery]       = useState('')
  const [highlighted, setHighlighted] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const listRef      = useRef<HTMLUListElement>(null)
  const listId       = useId()

  // Case-insensitive substring filtering
  const filtered = query.trim()
    ? categories.filter(c =>
        c.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : categories

  const ADD_NEW_IDX = filtered.length   // index of the "Add new" entry
  const totalOpts   = filtered.length + 1

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
        setHighlighted(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlighted < 0 || !listRef.current) return
    ;(listRef.current.children[highlighted] as HTMLElement | undefined)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, open])

  const openList = () => {
    if (disabled) return
    setQuery('')
    setHighlighted(-1)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setQuery('')
    setHighlighted(-1)
  }

  const pick = (name: string) => {
    onChange(name)
    close()
  }

  const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) { openList(); return }
        setHighlighted((h: number) => (h < 0 ? 0 : Math.min(h + 1, totalOpts - 1)))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) { openList(); return }
        setHighlighted((h: number) => (h <= 0 ? 0 : h - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (!open) { openList(); return }
        if (highlighted === ADD_NEW_IDX) {
          close()
          setAdding(true)
        } else if (highlighted >= 0 && highlighted < filtered.length) {
          pick(filtered[highlighted].name)
        }
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'Tab':
        if (open) close()   // let default Tab behaviour propagate
        break
    }
  }

  // ── Add-new mode UI (unchanged from original) ──────────────────────────────
  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            ref={newCatInputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); handleSave() }
              if (e.key === 'Escape') handleCancel()
            }}
            placeholder="New category name…"
            className="flex-1 px-2 py-1.5 text-sm border border-primary/60 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !newName.trim()}
            className="touch-target p-1.5 rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 transition-colors"
            title="Save category"
          >
            {saving
              ? <span className="block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Check className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Cancel" aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      </div>
    )
  }

  // ── Combobox UI ────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined
        }
        disabled={disabled}
        autoComplete="off"
        value={open ? query : value}
        placeholder={open ? 'Type to search…' : 'Select category…'}
        className={selectCls ?? DEFAULT_CLS}
        style={{ paddingRight: '2rem' }}
        onClick={() => { if (!open) openList() }}
        onFocus={() => { if (!open) openList() }}
        onChange={e => {
          setQuery(e.target.value)
          setHighlighted(-1)
          if (!open) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      <ChevronDown
        aria-hidden
        className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none transition-transform duration-150 ${
          open ? 'rotate-180' : ''
        }`}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Categories"
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 sm:max-h-60 max-sm:max-h-[40dvh] overflow-y-auto overscroll-contain bg-white border border-gray-200 rounded-lg shadow-lg py-1"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-400 italic" role="presentation">
              No matches
            </li>
          )}

          {filtered.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={c.name === value}
              onMouseDown={e => { e.preventDefault(); pick(c.name) }}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex items-start px-3 py-2 text-sm cursor-pointer select-none ${
                i === highlighted
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-800 hover:bg-gray-50'
              }`}
            >
              {c.name === value
                ? <Check className="w-3.5 h-3.5 text-primary shrink-0 mr-2 mt-0.5" />
                : <span className="w-3.5 shrink-0 mr-2 mt-0.5" />}
              <span className="min-w-0 break-words leading-snug">{c.name}</span>
            </li>
          ))}

          <li
            id={`${listId}-${ADD_NEW_IDX}`}
            role="option"
            aria-selected={false}
            onMouseDown={e => { e.preventDefault(); close(); setAdding(true) }}
            onMouseEnter={() => setHighlighted(ADD_NEW_IDX)}
            className={`px-3 py-2 text-sm cursor-pointer select-none text-primary font-medium border-t border-gray-100 ${
              highlighted === ADD_NEW_IDX ? 'bg-primary/10' : 'hover:bg-gray-50'
            }`}
          >
            ＋ Add new category…
          </li>
        </ul>
      )}
    </div>
  )
}
