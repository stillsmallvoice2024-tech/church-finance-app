import { useState, useMemo } from 'react'
import { Plus, ChevronDown, ChevronRight, Download, Building2, Trash2 } from 'lucide-react'
import { useRole } from '../hooks/useRole'
import {
  useSpecialProjects,
  useProjectEntries,
  type DbSpecialProject,
} from '../hooks/useSpecialProjects'
import { AddSpecialProjectModal } from '../components/modals/AddSpecialProjectModal'
import { AddProjectEntryModal } from '../components/modals/AddProjectEntryModal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { exportCSV } from '../utils/csvExport'
import { useToastStore } from '../store/toastStore'
import { supabase } from '../lib/supabase'

type Tab = 'projects' | 'departments'

function isUnitCode(code: string | null): boolean {
  if (!code) return false
  const n = parseInt(code, 10)
  return n >= 300 && n <= 310
}

function fmt(n: number) {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2 })
}

// ── ProjectCard ────────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onMutated,
}: {
  project: DbSpecialProject
  onMutated: () => void
}) {
  const [expanded, setExpanded]       = useState(false)
  const [addEntryOpen, setAddEntryOpen] = useState(false)
  const [deleteId, setDeleteId]       = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)

  const { canWrite, isAdmin } = useRole()
  const { push }              = useToastStore()

  const { entries, runningBalance, loading, refetch } = useProjectEntries(
    expanded ? project.id : '',
  )

  const totalInflow = entries.reduce(
    (s, e) => s + Number(e.inflow) + Number(e.percentage_inflow) + Number(e.refund_intraflow),
    0,
  )
  const totalOutflow     = entries.reduce((s, e) => s + Number(e.outflow), 0)
  const displayBalance   = entries.length > 0 ? runningBalance : Number(project.opening_balance)

  const handleDeleteEntry = async () => {
    if (!deleteId) return
    setDeleting(true)
    const { error } = await supabase.from('project_entries').delete().eq('id', deleteId)
    setDeleting(false)
    if (error) {
      push(error.message, 'error')
    } else {
      push('Entry deleted', 'success')
      setDeleteId(null)
      refetch()
    }
  }

  const handleExport = () => {
    exportCSV(
      `${project.name.replace(/\s+/g, '_')}_entries`,
      ['Date', 'Description', 'Inflow', '% Inflow', 'Refund', 'Outflow', 'Balance'],
      entries.map(e => [
        e.date,
        e.description ?? '',
        e.inflow,
        e.percentage_inflow,
        e.refund_intraflow,
        e.outflow,
        e.balance,
      ]),
    )
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Card header */}
        <div
          className="px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 truncate">{project.name}</span>
              {project.code && (
                <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                  {project.code}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Opening: ₦{fmt(Number(project.opening_balance))}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className={`font-bold text-base ${displayBalance >= 0 ? 'text-success' : 'text-danger'}`}>
              ₦{fmt(displayBalance)}
            </div>
            <div className="text-xs text-gray-400">Current balance</div>
          </div>

          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        </div>

        {/* Summary strip */}
        {expanded && (
          <div className="border-t border-gray-100 bg-gray-50 px-5 py-2.5 grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <div className="text-gray-400 text-xs">Total Inflow</div>
              <div className="font-semibold text-success">₦{fmt(totalInflow)}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Total Outflow</div>
              <div className="font-semibold text-danger">₦{fmt(totalOutflow)}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Entries</div>
              <div className="font-semibold text-gray-700">{entries.length}</div>
            </div>
          </div>
        )}

        {/* Entries section */}
        {expanded && (
          <div className="border-t border-gray-100">
            {/* Actions bar */}
            <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
              <span className="text-sm font-medium text-gray-600">Ledger Entries</span>
              <div className="flex gap-2">
                <button
                  onClick={e => { e.stopPropagation(); handleExport() }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  <Download className="w-3 h-3" /> Export
                </button>
                {canWrite() && (
                  <button
                    onClick={e => { e.stopPropagation(); setAddEntryOpen(true) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-light"
                  >
                    <Plus className="w-3 h-3" /> Add Entry
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="space-y-2 p-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No entries yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2.5 text-left font-medium">Date</th>
                      <th className="px-4 py-2.5 text-left font-medium">Description</th>
                      <th className="px-4 py-2.5 text-right font-medium">Inflow</th>
                      <th className="px-4 py-2.5 text-right font-medium">% Inflow</th>
                      <th className="px-4 py-2.5 text-right font-medium">Refund</th>
                      <th className="px-4 py-2.5 text-right font-medium">Outflow</th>
                      <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                      {isAdmin() && <th className="px-4 py-2.5 w-10" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entries.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{e.date}</td>
                        <td className="px-4 py-2.5 text-gray-700">{e.description ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-success">
                          {e.inflow > 0 ? `₦${fmt(Number(e.inflow))}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-success">
                          {e.percentage_inflow > 0 ? `₦${fmt(Number(e.percentage_inflow))}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-blue-600">
                          {e.refund_intraflow > 0 ? `₦${fmt(Number(e.refund_intraflow))}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-danger">
                          {e.outflow > 0 ? `₦${fmt(Number(e.outflow))}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-800">
                          ₦{fmt(Number(e.balance))}
                        </td>
                        {isAdmin() && (
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={ev => { ev.stopPropagation(); setDeleteId(e.id) }}
                              className="text-gray-300 hover:text-red-500 transition-colors"
                              title="Delete entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}

                    {/* Totals row */}
                    <tr className="bg-gray-50 font-semibold text-sm border-t border-gray-200">
                      <td className="px-4 py-2.5 text-gray-700" colSpan={2}>Totals</td>
                      <td className="px-4 py-2.5 text-right text-success">
                        ₦{fmt(entries.reduce((s, e) => s + Number(e.inflow), 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-success">
                        ₦{fmt(entries.reduce((s, e) => s + Number(e.percentage_inflow), 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-600">
                        ₦{fmt(entries.reduce((s, e) => s + Number(e.refund_intraflow), 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-danger">
                        ₦{fmt(entries.reduce((s, e) => s + Number(e.outflow), 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-800">
                        ₦{fmt(runningBalance)}
                      </td>
                      {isAdmin() && <td />}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <AddProjectEntryModal
        open={addEntryOpen}
        onClose={() => setAddEntryOpen(false)}
        onSuccess={() => { refetch(); onMutated() }}
        projectId={project.id}
        previousBalance={runningBalance}
      />

      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDeleteEntry}
        loading={deleting}
        label="this project entry"
      />
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SpecialProjects() {
  const [tab, setTab]             = useState<Tab>('projects')
  const [addProjectOpen, setAddProjectOpen] = useState(false)

  const { isAdmin }                         = useRole()
  const { projects, loading, error, refetch } = useSpecialProjects()

  const specialProjects = useMemo(() => projects.filter(p => !isUnitCode(p.code)), [projects])
  const deptUnits       = useMemo(() => projects.filter(p => isUnitCode(p.code)), [projects])
  const currentList     = tab === 'projects' ? specialProjects : deptUnits

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Special Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track project-specific funds and department units
          </p>
        </div>
        {isAdmin() && (
          <button
            onClick={() => setAddProjectOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {(['projects', 'departments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'projects'
              ? `Special Projects (${specialProjects.length})`
              : `Department Units (${deptUnits.length})`}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && currentList.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            No {tab === 'projects' ? 'special projects' : 'department units'} found.
          </p>
          {isAdmin() && (
            <p className="text-xs mt-1">Click "New Project" to create one.</p>
          )}
        </div>
      )}

      {/* Cards */}
      {!loading && (
        <div className="space-y-4">
          {currentList.map(p => (
            <ProjectCard key={p.id} project={p} onMutated={refetch} />
          ))}
        </div>
      )}

      <AddSpecialProjectModal
        open={addProjectOpen}
        onClose={() => setAddProjectOpen(false)}
        onSuccess={refetch}
      />
    </div>
  )
}
