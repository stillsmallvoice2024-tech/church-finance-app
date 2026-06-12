import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, FileText, Trash2, ChevronRight, AlertCircle, ChevronLeft } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useDynamicReports, useAddDynamicReport, useDeleteDynamicReport } from '../hooks/useDynamicReports'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import type { DynamicReport } from '../types'

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DynamicReports() {
  usePageTitle('Custom Reports')
  const navigate = useNavigate()

  const { reports, loading, error, refetch } = useDynamicReports()
  const { mutate: addReport,    loading: adding  } = useAddDynamicReport()
  const { mutate: deleteReport, loading: deleting } = useDeleteDynamicReport()

  const [deleteTarget, setDeleteTarget] = useState<DynamicReport | null>(null)

  const handleNew = async () => {
    const report = await addReport('Untitled Report')
    if (report) navigate(`/dynamic-reports/${report.id}`)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const ok = await deleteReport(deleteTarget.id)
    if (ok) { setDeleteTarget(null); refetch() }
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <Link
        to="/reports"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
        All Reports
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Custom Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create live-updating finance documents</p>
        </div>
        <button
          onClick={handleNew}
          disabled={adding}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New Report
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && reports.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-600">No reports yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">
            Create a report to embed live financial metrics and tables directly in your documents.
          </p>
          <button
            onClick={handleNew}
            disabled={adding}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {reports.map(report => (
              <li key={report.id}>
                <div className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors group">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => navigate(`/dynamic-reports/${report.id}`)}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{report.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Updated {formatRelativeDate(report.updated_at)}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setDeleteTarget(report)}
                      disabled={deleting}
                      className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                      title="Delete report"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 text-gray-300 shrink-0 cursor-pointer"
                    onClick={() => navigate(`/dynamic-reports/${report.id}`)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DeleteDialog
        open={!!deleteTarget}
        label={deleteTarget?.title ?? 'this report'}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
