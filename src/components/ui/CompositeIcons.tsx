import { Landmark, ArrowRightLeft } from 'lucide-react'

export function BankMovementIcon({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <Landmark className="w-full h-full" />
      <ArrowRightLeft className="absolute -bottom-1 -right-1 w-2.5 h-2.5" />
    </span>
  )
}
