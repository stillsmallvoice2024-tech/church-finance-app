import React, { useId, type ReactNode } from 'react'
import { HelpTooltip } from './HelpTooltip'

// 16px font below sm prevents iOS Safari auto-zoom on input focus
export function inputCls(hasError: boolean): string {
  return `w-full px-3 py-2 min-h-[44px] text-base sm:text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
    hasError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-primary'
  }`
}

// For filter/search inputs that don't need error-state styling
export const filterInputCls = 'w-full px-3 py-2 text-base sm:text-sm border border-gray-300 rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

/** Quick date presets for entry forms — most records are "today" or "last Sunday". */
export function DateQuickChips({ onPick }: { onPick: (iso: string) => void }) {
  const iso = (d: Date) => {
    const tz = d.getTimezoneOffset() * 60000
    return new Date(d.getTime() - tz).toISOString().slice(0, 10)
  }
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const lastSunday = new Date(today); lastSunday.setDate(today.getDate() - ((today.getDay() + 7) % 7 || 7))
  const chips: Array<[string, string]> = [
    ['Today', iso(today)],
    ['Yesterday', iso(yesterday)],
    ['Last Sunday', iso(lastSunday)],
  ]
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {chips.map(([label, value]) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(value)}
          className="px-2.5 py-1 min-h-[28px] text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Scroll + focus the first invalid field inside the closest form/modal panel.
 * Pass as the onInvalid handler to react-hook-form's handleSubmit:
 *   handleSubmit(onSubmit, focusFirstInvalid)
 */
export function focusFirstInvalid() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"], form [aria-invalid="true"]')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    }
  })
}

interface FieldProps {
  label: string
  /** Optional tooltip shown next to the label. */
  help?: string
  error?: string
  children: ReactNode
}

export function Field({ label, help, error, children }: FieldProps) {
  const uid = useId()
  const errorId = `${uid}-error`

  const enhanced = React.Children.map(children, (child, i) => {
    if (i === 0 && React.isValidElement(child)) {
      const props = child.props as Record<string, unknown>
      const existing = props['aria-describedby'] as string | undefined
      const describedBy = [existing, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
      return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        id: props.id ?? uid,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })
    }
    return child
  })

  // Required marker: a trailing " *" in the label renders as a prominent
  // danger-coloured asterisk with an SR-only "(required)" announcement, so the
  // required convention is visually + semantically consistent across every form.
  const isRequired = typeof label === 'string' && label.trimEnd().endsWith('*')
  const labelText  = isRequired ? label.replace(/\s*\*\s*$/, '') : label

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-gray-600" htmlFor={uid}>
          {labelText}
          {isRequired && (
            <>
              <span aria-hidden="true" className="text-danger ml-0.5">*</span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
        {help && <HelpTooltip content={help} placement="right" iconSize="w-3 h-3" />}
      </div>
      {enhanced}
      {error && (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
