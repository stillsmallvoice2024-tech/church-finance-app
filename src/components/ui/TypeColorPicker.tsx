import { useRef } from 'react'
import { Pipette } from 'lucide-react'

export const TYPE_PRESET_COLORS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#0ea5e9', // Sky
  '#06b6d4', // Cyan
  '#14b8a6', // Teal
  '#10b981', // Green
  '#84cc16', // Lime
  '#f59e0b', // Amber
  '#f97316', // Orange
  '#ef4444', // Red
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#64748b', // Slate
  '#a16207', // Brown
]

interface TypeColorPickerProps {
  value:     string
  onChange:  (color: string) => void
  disabled?: boolean
}

export function TypeColorPicker({ value, onChange, disabled }: TypeColorPickerProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const safePickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'

  return (
    <div className="space-y-2">
      {/* Preset swatches + native picker trigger */}
      <div className="flex flex-wrap gap-2 items-center">
        {TYPE_PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => !disabled && onChange(c)}
            disabled={disabled}
            title={c}
            className={`w-7 h-7 touch-target rounded-full border-2 transition-transform disabled:opacity-50 ${
              value.toLowerCase() === c.toLowerCase()
                ? 'border-gray-800 scale-110'
                : 'border-transparent hover:scale-110'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        {/* Native color picker */}
        <div className="relative w-7 h-7" title="Custom color">
          <input
            ref={pickerRef}
            type="color"
            value={safePickerValue}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            aria-label="Custom color"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full rounded-full disabled:pointer-events-none"
          />
          <div
            className={`w-7 h-7 rounded-full border-2 border-dashed flex items-center justify-center pointer-events-none ${
              disabled
                ? 'opacity-50 border-gray-300 bg-gray-50'
                : 'border-gray-400 bg-gray-50'
            }`}
          >
            <Pipette className="w-3 h-3 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Hex input + preview */}
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-full border border-gray-200 shrink-0"
          style={{ backgroundColor: value }}
        />
        <input
          type="text"
          value={value}
          onChange={e => !disabled && onChange(e.target.value)}
          placeholder="#rrggbb"
          disabled={disabled}
          className="flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:bg-gray-50"
        />
      </div>
    </div>
  )
}
