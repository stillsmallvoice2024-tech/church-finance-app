import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from './Card'

interface StatCardProps {
  title: string
  value: ReactNode
  icon?: ReactNode
  trend?: { value: number; label: string }
  iconBgClass?: string
  href?: string
  variant?: 'default' | 'brand'
  cardClassName?: string
  valueClassName?: string
}

export function StatCard({
  title,
  value,
  trend,
  iconBgClass,
  href,
  variant = 'default',
  cardClassName,
  valueClassName,
}: StatCardProps) {
  const isPositive = (trend?.value ?? 0) >= 0

  const inner = (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
        {title}
      </p>
      <p className={`text-3xl font-extrabold tracking-tight mt-2 tabular-nums leading-none ${valueClassName ?? 'text-gray-900 dark:text-white/90'}`}>
        {value}
      </p>
      {trend && (
        <div className={`flex items-center gap-1 mt-2.5 text-xs font-semibold ${isPositive ? 'text-success dark:text-success-dm' : 'text-danger dark:text-danger-dm'}`}>
          {isPositive ? <TrendingUp className="w-3.5 h-3.5 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 shrink-0" />}
          <span>{Math.abs(trend.value)}% {trend.label}</span>
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link to={href} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
        <Card
          variant="elevated"
          className={`transition-shadow cursor-pointer group-hover:shadow-card-md group-hover:[box-shadow:0_4px_12px_rgba(0,0,0,0.10)] dark:group-hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.09),0_4px_16px_rgba(0,0,0,0.5)] ${cardClassName ?? ''}`}
        >
          {inner}
        </Card>
      </Link>
    )
  }

  return <Card variant="elevated" className={cardClassName}>{inner}</Card>
}
