import { CheckCircle, XCircle, Download } from 'lucide-react'
import { Modal } from './Modal'
import { exportCSV } from '../../utils/csvExport'
import type { BulkRowFailure } from '../../hooks/useMutations'

export interface BulkResults {
  action: string          // e.g. 'deleted', 'updated'
  succeeded: number
  failures: BulkRowFailure[]
}

interface BulkResultsModalProps {
  results: BulkResults | null
  onClose: () => void
}

/** Shown after a bulk operation when at least one row failed —
 *  lists exactly which rows failed and why, with a CSV export. */
export function BulkResultsModal({ results, onClose }: BulkResultsModalProps) {
  if (!results) return null
  const { action, succeeded, failures } = results

  const handleExport = () => {
    exportCSV(
      `failed-rows-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Record ID', 'Reason'],
      failures.map(f => [f.id, f.reason]),
    )
  }

  return (
    <Modal open onClose={onClose} title="Bulk action results">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-success shrink-0" />
            <div>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{succeeded}</p>
              <p className="text-xs text-gray-500">Successfully {action}</p>
            </div>
          </div>
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-3">
            <XCircle className="w-5 h-5 text-danger shrink-0" />
            <div>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{failures.length}</p>
              <p className="text-xs text-gray-500">Failed</p>
            </div>
          </div>
        </div>

        {failures.length > 0 && (
          <>
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <table className="min-w-full">
                  <thead className="sticky top-0">
                    <tr className="border-b border-gray-100">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Record ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {failures.map(f => (
                      <tr key={f.id}>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 select-all whitespace-nowrap">{f.id}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export failed rows (CSV)
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
