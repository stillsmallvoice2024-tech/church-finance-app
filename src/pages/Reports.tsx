import { BarChart3, Download, FileText, PieChart, TrendingUp } from 'lucide-react'
import { Card } from '../components/ui/Card'

const REPORT_TYPES = [
  {
    id: 'income-statement',
    title: 'Income Statement',
    description: 'Summary of all inflows vs outflows for a selected period',
    icon: TrendingUp,
    iconBg: 'bg-success-light',
    iconColor: 'text-success',
  },
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    description: 'Snapshot of assets, liabilities, and fund balances',
    icon: FileText,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary',
  },
  {
    id: 'category-breakdown',
    title: 'Category Breakdown',
    description: 'Inflows and outflows grouped by category',
    icon: PieChart,
    iconBg: 'bg-accent-light',
    iconColor: 'text-accent',
  },
  {
    id: 'monthly-trends',
    title: 'Monthly Trends',
    description: 'Month-by-month analysis across the financial year',
    icon: BarChart3,
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary',
  },
]

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Generate and export financial reports</p>
      </div>

      {/* Date range selector */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Report Period</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">From</label>
            <input
              type="date"
              defaultValue="2024-01-01"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">To</label>
            <input
              type="date"
              defaultValue="2024-12-31"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      </Card>

      {/* Report type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REPORT_TYPES.map(({ id, title, description, icon: Icon, iconBg, iconColor }) => (
          <Card key={id}>
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl ${iconBg} shrink-0`}>
                <Icon className={`w-5 h-5 ${iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{description}</p>
                <div className="flex gap-2 mt-3">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-light transition-colors">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Generate
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors">
                    <Download className="w-3.5 h-3.5" />
                    Export PDF
                  </button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
