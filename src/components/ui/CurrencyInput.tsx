import { useEffect, useRef, useState } from 'react'
import { formatCurrency, parseCurrency } from '../../utils/currency'

interface Props {
  value?:       number | string | null
  onChange:     (value: number | undefined) => void
  placeholder?: string
  className?:   string
  disabled?:    boolean
  min?:         number
  step?:        string
}

/**
 * Text input that displays a comma-formatted number while the user types.
 * Calls onChange with the parsed numeric value (or undefined when blank).
 * Syncs to external `value` changes (e.g. form reset).
 */
export function CurrencyInput({ value, onChange, placeholder = '0.00', className = '', disabled, min, step }: Props) {
  const externalNum = value !== undefined && value !== null && value !== '' ? Number(value) : undefined
  const [display, setDisplay] = useState<string>(
    externalNum !== undefined ? formatCurrency(externalNum) : '',
  )
  // Track whether the user is currently typing to avoid clobbering cursor
  const typingRef = useRef(false)

  // Sync when external value changes (form reset, edit populate)
  useEffect(() => {
    if (typingRef.current) return
    const ext = value !== undefined && value !== null && value !== '' ? Number(value) : undefined
    setDisplay(ext !== undefined && !isNaN(ext) ? formatCurrency(ext) : '')
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    typingRef.current = true
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    // allow only one decimal point
    const parts = raw.split('.')
    const clean  = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw
    const [integer, decimal] = clean.split('.')
    const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal !== undefined ? `.${decimal}` : '')
    setDisplay(formatted)
    onChange(parseCurrency(formatted))
  }

  const handleBlur = () => {
    typingRef.current = false
    // normalise: remove trailing dot, re-format
    const num = parseCurrency(display)
    setDisplay(num !== undefined ? formatCurrency(num) : '')
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      min={min}
      data-step={step}
    />
  )
}
