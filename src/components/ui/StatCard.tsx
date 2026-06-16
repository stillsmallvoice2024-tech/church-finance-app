import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from './Card'

interface StatCardProps {
  title: string
  value: ReactNode
  icon?: ReactNode
  trend?: { value: number; label: string }
  note?: ReactNode
  iconBgClass?: string
  href?: string
  variant?: 'default' | 'brand' | 'hero'
  cardClassName?: string
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  note,
  iconBgClass = 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-dm',
  href,
  variant = 'default',
  cardClassName,
}: StatCardProps) {
  const isHero     = variant === 'hero'
  const isBrand    = variant === 'brand'
  const isPositive = (trend?.value ?? 0) >= 0

  const heroInner = (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
        {title}
      </p>
      <p className="text-[2.75rem] font-extrabold tracking-tight text-primary dark:text-primary-dm mt-2 tabular-nums leading-none">
        {value}
      </p>
      {trend && (
        <div className={`flex items-center gap-1 mt-3 text-xs font-semibold ${isPositive ? 'text-success dark:text-success-dm' : 'text-danger dark:text-danger-dm'}`}>
          {isPositive ? <TrendingUp className="w-3.5 h-3.5 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 shrink-0" />}
          <span>{Math.abs(trend.value)}% {trend.label}</span>
        </div>
      )}
      {note && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-white/30 leading-snug">{note}</p>
      )}
    </div>
  )

  const defaultInner = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-widest truncate ${isBrand ? 'text-white/55' : 'text-gray-400'}`}>
          {title}
        </p>
        <p className={`text-3xl font-extrabold tracking-tight mt-2 tabular-nums leading-none ${isBrand ? 'text-white' : 'text-gray-900'}`}>
          {value}
        </p>
        {trend && (
          <div className={`flex items-center gap-1 mt-2.5 text-xs font-semibold ${
            isBrand
              ? isPositive ? 'text-white/75' : 'text-white/60'
              : isPositive ? 'text-success dark:text-success-dm' : 'text-danger dark:text-danger-dm'
          }`}>
            {isPositive ? <TrendingUp className="w-3.5 h-3.5 shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 shrink-0" />}
            <span>{Math.abs(trend.value)}% {trend.label}</span>
          </div>
        )}
      </div>
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${isBrand ? 'bg-white/15' : iconBgClass}`}>
        {icon}
      </div>
    </div>
  )

  const inner = isHero ? heroInner : defaultInner

  const cardCls = isHero
    ? `bg-gradient-to-br from-white to-gray-50 border border-gray-100 dark:from-[#1c1c1e] dark:to-[#141416] dark:border-white/[0.06] ${cardClassName ?? ''}`
    : `${cardClassName ?? ''}`

  const cardVariant = isBrand ? 'brand' : 'elevated'

  if (href) {
    return (
      <Link to={href} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
        <Card
          variant={cardVariant}
          className={`transition-shadow cursor-pointer group-hover:shadow-card-md group-hover:[box-shadow:0_4px_12px_rgba(0,0,0,0.10)] dark:group-hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.09),0_4px_16px_rgba(0,0,0,0.5)] ${cardCls}`}
        >
          {inner}
        </Card>
      </Link>
    )
  }

  return <Card variant={cardVariant} className={cardCls}>{inner}</Card>
}
