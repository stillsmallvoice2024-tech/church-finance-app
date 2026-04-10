import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from './Card'

interface StatCardProps {
  title: string
  value: string
  icon: ReactNode
  trend?: { value: number; label: string }
  iconBgClass?: string
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  iconBgClass = 'bg-primary-100',
}: StatCardProps) {
  const isPositive = (trend?.value ?? 0) >= 0

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {trend && (
            <div
              className={`flex items-center gap-1 mt-2 text-sm font-medium ${
                isPositive ? 'text-success' : 'text-danger'
              }`}
            >
              {isPositive ? (
                <TrendingUp className="w-4 h-4 shrink-0" />
              ) : (
                <TrendingDown className="w-4 h-4 shrink-0" />
              )}
              <span>
                {Math.abs(trend.value)}% {trend.label}
              </span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl shrink-0 ml-4 ${iconBgClass}`}>{icon}</div>
      </div>
    </Card>
  )
}
