import { useState, useRef, useEffect, useId } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value:             string
  onChange:          (value: string) => void
  options:           SelectOption[]
  placeholder?:      string
  disabled?:         boolean
  className?:        string
  wrapperClassName?: string
}

const DEFAULT_CLS =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white'

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '— Select —',
  disabled,
  className,
  wrapperClassName,
}: Props) {
  const [open,        setOpen]        = useState(false)
  const [query,       setQuery]       = useState('')
  const [highlighted, setHighlighted] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const listRef      = useRef<HTMLUListElement>(null)
  const listId       = useId()

  const selectedLabel = options.find(o => o.value === value)?.label ?? value
  const textCls = (className ?? DEFAULT_CLS).match(/\btext-\S+/)?.[0] ?? 'text-sm'

  const hasQuery  = query.trim() !== ''
  const filtered  = hasQuery
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  // When query is empty the placeholder item occupies index 0; options start at 1.
  // When query is non-empty the placeholder is hidden; options start at 0.
  const offset   = hasQuery ? 0 : 1
  const totalOpts = filtered.length + offset

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

  const pick = (v: string) => {
    onChange(v)
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
        if (!hasQuery && highlighted === 0) {
          pick('')
        } else if (highlighted >= 0 && highlighted < totalOpts) {
          const opt = filtered[highlighted - offset]
          if (opt) pick(opt.value)
        }
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'Tab':
        if (open) close()
        break
    }
  }

  return (
    <div ref={containerRef} className={`relative${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>
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
        value={open ? query : selectedLabel}
        placeholder={open ? 'Type to search…' : placeholder}
        className={className ?? DEFAULT_CLS}
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
          aria-label="Options"
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 sm:max-h-60 max-sm:max-h-[40dvh] overflow-y-auto overscroll-contain bg-white border border-gray-200 rounded-lg shadow-lg py-1"
        >
          {/* Placeholder / clear option — only when not filtering */}
          {!hasQuery && (
            <li
              id={`${listId}-0`}
              role="option"
              aria-selected={value === ''}
              onMouseDown={e => { e.preventDefault(); pick('') }}
              onMouseEnter={() => setHighlighted(0)}
              className={`px-3 py-2 ${textCls} cursor-pointer select-none text-gray-400 italic ${
                highlighted === 0 ? 'bg-primary/10' : 'hover:bg-gray-50'
              }`}
            >
              {placeholder}
            </li>
          )}

          {filtered.length === 0 && (
            <li className={`px-3 py-2 ${textCls} text-gray-400 italic`} role="presentation">
              No matches
            </li>
          )}

          {filtered.map((opt, i) => {
            const idx = i + offset
            return (
              <li
                key={opt.value || `opt-${i}`}
                id={`${listId}-${idx}`}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={e => { e.preventDefault(); pick(opt.value) }}
                onMouseEnter={() => setHighlighted(idx)}
                className={`flex items-start px-3 py-2 ${textCls} cursor-pointer select-none ${
                  idx === highlighted
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                {opt.value === value
                  ? <Check className="w-3.5 h-3.5 text-primary shrink-0 mr-2 mt-0.5" />
                  : <span className="w-3.5 shrink-0 mr-2 mt-0.5" />}
                <span className="min-w-0 break-words leading-snug">{opt.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
