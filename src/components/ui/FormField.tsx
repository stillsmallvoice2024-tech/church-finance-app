import React, { useId, type ReactNode } from 'react'

export function inputCls(hasError: boolean): string {
  return `w-full px-3 py-2 min-h-[44px] text-sm border rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 bg-white ${
    hasError ? 'border-red-400 focus:border-red-400' : 'border-gray-300 focus:border-primary'
  }`
}

// For filter/search inputs that don't need error-state styling
export const filterInputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none transition-colors focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

interface FieldProps {
  label: string
  error?: string
  children: ReactNode
}

export function Field({ label, error, children }: FieldProps) {
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

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600" htmlFor={uid}>
        {label}
      </label>
      {enhanced}
      {error && (
        <p id={errorId} className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
