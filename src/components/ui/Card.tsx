import type { ReactNode, HTMLAttributes } from 'react'

type CardVariant = 'elevated' | 'outlined' | 'ghost' | 'brand'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  padding?: boolean
  variant?: CardVariant
}

/*
 * Dark mode "virtual light" trick: inset top shadow at 7% white simulates
 * ambient light catching the top edge of the card — makes surfaces feel
 * physical rather than flat. Combined with a deeper outer shadow for lift.
 */
const VARIANT_CLASSES: Record<CardVariant, string> = {
  elevated: [
    'bg-white',
    'shadow-card',
    'dark:bg-[#141416]',
    'dark:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.07),0_1px_4px_rgba(0,0,0,0.35)]',
  ].join(' '),
  outlined: [
    'bg-white',
    'border border-black/[0.07]',
    'dark:bg-[#141416]',
    'dark:border-white/[0.07]',
  ].join(' '),
  ghost: [
    'bg-gray-50/70',
    'dark:bg-white/[0.03]',
  ].join(' '),
  brand: [
    'bg-[#1A2C42]',
    '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.08),0_1px_4px_rgba(0,0,0,0.25)]',
  ].join(' '),
}

export function Card({ children, className = '', padding = true, variant = 'elevated', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl ${VARIANT_CLASSES[variant]} ${padding ? 'p-6' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
