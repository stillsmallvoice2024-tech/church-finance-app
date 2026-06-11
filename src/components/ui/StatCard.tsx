import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from './Card'

interface StatCardProps {
  title: string
  value: ReactNode
  icon: ReactNode
  trend?: { value: number; label: string }
  iconBgClass?: string
  href?: string
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  iconBgClass = 'bg-primary-100',
  href,
}: StatCardProps) {
  const isPositive = (trend?.value ?? 0) >= 0

  const inner = (
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-500 truncate">{title}</p>
        <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1.5 tabular-nums">{value}</p>
        {trend && (
          <div
            className={`flex items-center gap-1 mt-2 text-xs font-medium ${
              isPositive ? 'text-success' : 'text-danger'
            }`}
          >
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              {Math.abs(trend.value)}% {trend.label}
            </span>
          </div>
        )}
      </div>
      <div className={`p-2.5 rounded-lg shrink-0 ml-4 ${iconBgClass}`}>{icon}</div>
    </div>
  )

  if (href) {
    return (
      <Link to={href} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
        <Card className="transition-shadow group-hover:shadow-md group-hover:ring-2 group-hover:ring-primary/20 cursor-pointer">
          {inner}
        </Card>
      </Link>
    )
  }

  return <Card>{inner}</Card>
}
