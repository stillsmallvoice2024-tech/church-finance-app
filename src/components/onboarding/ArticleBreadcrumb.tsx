import { Home } from 'lucide-react'

interface ArticleBreadcrumbProps {
  path: string[]
}

export function ArticleBreadcrumb({ path }: ArticleBreadcrumbProps) {
  if (!path.length) return null

  return (
    <div className="bg-gray-50 dark:bg-[#0c0c0e] border border-gray-200 dark:border-white/[0.07] rounded-lg px-4 py-3 mb-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
        How to get there
      </p>
      <div className="flex items-center flex-wrap gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06]">
          <Home className="w-3 h-3" />
          Sidebar
        </span>
        {path.map((segment, i) => {
          const isLast = i === path.length - 1
          return (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-gray-400 text-xs select-none">›</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  isLast
                    ? 'text-primary bg-primary/10 dark:bg-primary/20'
                    : 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06]'
                }`}
              >
                {segment}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
