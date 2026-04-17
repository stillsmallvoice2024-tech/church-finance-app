import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Layers, AlertCircle } from 'lucide-react'
import { useCategories, type Category } from '../hooks/useCategories'
import {
  useAddCategory,
  useUpdateCategory,
  useDeleteCategory,
  type AddCategoryInput,
  type UpdateCategoryInput,
} from '../hooks/useMutations'
import { usePageTitle } from '../hooks/usePageTitle'
import { useToast } from '../store/toastStore'
import { Modal } from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'

// ── Category form modal ────────────────────────────────────────────────────────

interface CategoryModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editRecord?: Category | null
}

function CategoryModal({ open, onClose, onSuccess, editRecord }: CategoryModalProps) {
  const isEdit = !!editRecord

  const addMutation    = useAddCategory()
  const updateMutation = useUpdateCategory()

  const { mutate: add,    loading: adding,   error: addErr,    reset: resetAdd    } = addMutation
  const { mutate: update, loading: updating, error: updateErr, reset: resetUpdate } = updateMutation

  const loading = adding || updating
  const error   = addErr || updateErr

  const [name, setName]   = useState('')
  const [desc, setDesc]   = useState('')

  useEffect(() => {
    if (!open) return
    resetAdd(); resetUpdate()
    setName(editRecord?.name ?? '')
    setDesc(editRecord?.description ?? '')
  }, [open, editRecord]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      if (isEdit && editRecord) {
        const input: UpdateCategoryInput = { id: editRecord.id, name: name.trim(), description: desc.trim() || undefined }
        await update(input)
      } else {
        const input: AddCategoryInput = { name: name.trim(), description: desc.trim() || undefined }
        await add(input)
      }
      onSuccess()
      onClose()
    } catch { /* surfaced via hook error */ }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Category' : 'New Category'}
      size="max-w-md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Category Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Tithes, Offerings, Welfare"
            required
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Description</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            placeholder="Optional description"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
          />
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Categories() {
  usePageTitle('Categories')

  const { categories, loading, error, refetch } = useCategories()
  const { mutate: deleteCategory } = useDeleteCategory()
  const toast = useToast()

  const [modalOpen,    setModalOpen]    = useState(false)
  const [editRecord,   setEditRecord]   = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  const openAdd = () => { setEditRecord(null); setModalOpen(true) }
  const openEdit = (c: Category) => { setEditRecord(c); setModalOpen(true) }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteCategory(deleteTarget.id)
      toast.success(`"${deleteTarget.name}" deleted.`)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage income and allocation categories
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && categories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Layers className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No categories yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Create your first category to use in allocation configurations.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
      )}

      {/* List */}
      {!loading && categories.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">Description</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {categories.map(cat => (
                <tr key={cat.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-800">{cat.name}</td>
                  <td className="px-5 py-3 text-gray-500 hidden sm:table-cell">
                    {cat.description ?? <span className="text-gray-300 italic">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(cat)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(cat)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <CategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={refetch}
        editRecord={editRecord}
      />

      <DeleteDialog
        open={!!deleteTarget}
        label={deleteTarget?.name ?? 'this category'}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
