import { Target, Plus } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { SpecialProject } from '../types'

const MOCK_PROJECTS: SpecialProject[] = [
  { id: '1', name: 'New Auditorium Construction', target_amount: 50000000, current_amount: 18500000, currency: 'NGN', start_date: '2024-01-01', status: 'active', description: 'Construction of the 2000-seat main auditorium' },
  { id: '2', name: 'Christmas Outreach 2024', target_amount: 3000000, current_amount: 3000000, currency: 'NGN', start_date: '2024-11-01', end_date: '2024-12-31', status: 'completed', description: 'Annual Christmas community outreach programme' },
  { id: '3', name: 'Sound Equipment Upgrade', target_amount: 8000000, current_amount: 5600000, currency: 'NGN', start_date: '2024-06-01', status: 'active', description: 'Professional audio-visual system for main sanctuary' },
  { id: '4', name: 'Youth Ministry Centre', target_amount: 12000000, current_amount: 1200000, currency: 'NGN', start_date: '2024-09-01', status: 'paused', description: 'Dedicated youth and children ministry facility' },
]

const STATUS_BADGE: Record<SpecialProject['status'], 'success' | 'primary' | 'warning'> = {
  active: 'primary',
  completed: 'success',
  paused: 'warning',
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min((value / max) * 100, 100)
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-primary rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function SpecialProjects() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Special Projects</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor fundraising projects and their progress</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MOCK_PROJECTS.map((project) => {
          const pct = project.target_amount === 0 ? 0 : (project.current_amount / project.target_amount) * 100

          return (
            <Card key={project.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary-100 mt-0.5">
                    <Target className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{project.description}</p>
                    )}
                  </div>
                </div>
                <Badge label={project.status.charAt(0).toUpperCase() + project.status.slice(1)} variant={STATUS_BADGE[project.status]} />
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Progress</span>
                  <span className="font-semibold text-primary">{pct.toFixed(1)}%</span>
                </div>
                <ProgressBar value={project.current_amount} max={project.target_amount} />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Raised: <span className="font-medium text-gray-700">{formatCurrency(project.current_amount, project.currency)}</span></span>
                  <span>Target: <span className="font-medium text-gray-700">{formatCurrency(project.target_amount, project.currency)}</span></span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Started {formatDate(project.start_date)}
                {project.end_date && ` · Ends ${formatDate(project.end_date)}`}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
