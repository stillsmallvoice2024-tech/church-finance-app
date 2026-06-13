import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal, type ModalHandle } from '../ui/Modal'
import { focusFirstInvalid } from '../ui/FormField'
import { useAddReportTemplate, useUpdateReportTemplate } from '../../hooks/useReportTemplates'
import { useToastStore } from '../../store/toastStore'
import type { ReportLayout, ReportTemplate } from '../../types'

const schema = z.object({
  name:        z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open:            boolean
  onClose:         () => void
  onSaved:         (template: ReportTemplate) => void
  layout:          ReportLayout
  editTemplate?:   ReportTemplate | null
}

export function SaveReportTemplateModal({ open, onClose, onSaved, layout, editTemplate }: Props) {
  const isEdit = !!editTemplate
  const { push } = useToastStore()

  const { mutate: add,    loading: adding }   = useAddReportTemplate()
  const { mutate: update, loading: updating } = useUpdateReportTemplate()
  const loading = adding || updating
  const modalRef = useRef<ModalHandle>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset({
      name:        editTemplate?.name        ?? '',
      description: editTemplate?.description ?? '',
    })
  }, [open, editTemplate, reset])

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && editTemplate) {
        await update({ id: editTemplate.id, name: values.name, description: values.description, layout })
        onSaved({ ...editTemplate, name: values.name, description: values.description, layout })
        push('Template updated', 'success')
      } else {
        const created = await add({ name: values.name, description: values.description, layout })
        onSaved(created)
        push('Template saved', 'success')
      }
      onClose()
    } catch {
      // error surfaces via toast / hook state
    }
  }

  const inputCls = (err: boolean) =>
    `w-full rounded-lg border px-3 py-2 min-h-[44px] text-base sm:text-sm outline-none transition
     ${err ? 'border-red-400 bg-red-50 focus:ring-red-300' : 'border-gray-300 bg-white focus:border-primary focus:ring-2 focus:ring-primary/20'}
     dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100`

  return (
    <Modal ref={modalRef} open={open} onClose={onClose} title={isEdit ? 'Update Template' : 'Save as Template'} size="max-w-md" isDirty={isDirty} disableClose={loading}>
      <form onSubmit={handleSubmit(onSubmit, focusFirstInvalid)} noValidate className="space-y-4">

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Template Name *
          </label>
          <input
            type="text"
            placeholder="e.g. Sunday Service Report"
            {...register('name')}
            className={inputCls(!!errors.name)}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Description
          </label>
          <textarea
            rows={2}
            placeholder="Optional description"
            {...register('description')}
            className={inputCls(false) + ' resize-none'}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => modalRef.current?.requestClose()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark disabled:opacity-50 transition"
          >
            {loading ? 'Saving…' : isEdit ? 'Update Template' : 'Save Template'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
