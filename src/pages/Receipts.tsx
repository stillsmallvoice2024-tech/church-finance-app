import { useState, useMemo } from 'react'
import { Paperclip, Download, Trash2, Loader2, FolderOpen, FileText, Image, AlertTriangle, Terminal } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAllReceipts, type ReceiptEntityType, type Receipt } from '../hooks/useReceipts'
import { formatDate } from '../utils/formatters'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows, type SortField } from '../utils/sortUtils'

const RCP_SORT_FIELDS: SortField[] = [
  { key: 'created_at', label: 'Upload Date', type: 'date', primary: true },
  { key: 'file_name',  label: 'File Name',   type: 'text', primary: true },
]

const RCP_SEARCH_COLS = [
  { key: 'all',       label: 'All Columns' },
  { key: 'file_name', label: 'File Name' },
]

const MIGRATION_SQL =
`-- Receipts table
CREATE TABLE IF NOT EXISTS public.receipts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('outflow','inflow','bank_deposit')),
  entity_id   uuid NOT NULL,
  file_name   text NOT NULL,
  file_path   text NOT NULL,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_entity
  ON public.receipts(entity_type, entity_id);

-- Enable RLS on receipts table
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipts_read"   ON public.receipts;
CREATE POLICY "receipts_read" ON public.receipts
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "receipts_write"  ON public.receipts;
CREATE POLICY "receipts_write" ON public.receipts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "receipts_delete" ON public.receipts;
CREATE POLICY "receipts_delete" ON public.receipts
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage object policies (allow authenticated users to upload/download/delete)
DO $$ BEGIN
  CREATE POLICY "receipts_objects_insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'receipts' AND auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "receipts_objects_select" ON storage.objects
    FOR SELECT USING (bucket_id = 'receipts' AND auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "receipts_objects_delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'receipts' AND auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

type Folder = 'all' | ReceiptEntityType

const FOLDERS: { key: Folder; label: string }[] = [
  { key: 'all',          label: 'All Receipts'         },
  { key: 'outflow',      label: 'Outflow Receipts'     },
  { key: 'inflow',       label: 'Inflow Receipts'      },
  { key: 'bank_deposit', label: 'Bank Deposit Receipts' },
]

function fileIcon(mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return <Image className="w-8 h-8 text-blue-400" />
  return <FileText className="w-8 h-8 text-red-400" />
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Receipts() {
  usePageTitle('Receipts')

  const [folder,  setFolder]  = useState<Folder>('all')
  const rcpState = useDataViewState({ storageKey: 'rcp', defaultSortKey: 'created_at', defaultSortDir: 'desc' })

  const entityType = folder === 'all' ? undefined : folder
  const { receipts, loading, error, remove, getDownloadUrl } = useAllReceipts(entityType)

  const isMigrationError = !!error && /relation.*does not exist|receipts|Could not find/i.test(error)

  const filtered = useMemo(() => {
    const q = rcpState.search.trim().toLowerCase()
    if (!q) return receipts
    return receipts.filter(r => r.file_name.toLowerCase().includes(q))
  }, [receipts, rcpState.search])

  const getRcpValue = (r: Receipt, k: string) => {
    if (k === 'file_name') return r.file_name
    return r.created_at
  }

  const sortedReceipts = useMemo(() => {
    const adv = rcpState.advancedSort
    if (adv.length > 0) return multiSortRows(filtered, getRcpValue, adv, RCP_SORT_FIELDS)
    return sortRows(filtered, getRcpValue, rcpState.sortKey, rcpState.sortDir, RCP_SORT_FIELDS)
  }, [filtered, rcpState.sortKey, rcpState.sortDir, rcpState.advancedSort])

  const countFor = (key: Folder) =>
    key === 'all' ? receipts.length : receipts.filter(r => r.entity_type === key).length

  const handleDownload = async (r: Receipt) => {
    const url = await getDownloadUrl(r.file_path)
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = r.file_name; a.click()
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
        <p className="text-sm text-gray-500 mt-0.5">All uploaded receipt files</p>
      </div>

      {/* Migration error */}
      {error && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {isMigrationError
                ? 'The receipts table does not exist yet. Run the SQL below in your Supabase SQL Editor to create it, then reload.'
                : error}
            </span>
          </div>
          {isMigrationError && (
            <div className="rounded-xl border border-gray-200 bg-gray-900 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                <Terminal className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] text-gray-400 font-mono">Supabase SQL Editor</span>
              </div>
              <pre className="px-4 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MIGRATION_SQL}</pre>
            </div>
          )}
        </div>
      )}

      {/* Mobile folder tabs */}
      <div className="flex overflow-x-auto gap-2 md:hidden pb-1 -mx-1 px-1">
        {FOLDERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFolder(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors shrink-0 ${
              folder === key
                ? 'bg-primary text-white font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{label}</span>
            <span className={`text-xs rounded-full px-1.5 py-0.5 ${
              folder === key ? 'bg-white/20 text-white' : 'bg-white text-gray-500'
            }`}>
              {loading ? '…' : countFor(key)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-5">
        {/* Folder sidebar — desktop only */}
        <div className="hidden md:block w-52 shrink-0 space-y-1">
          {FOLDERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFolder(key)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                folder === key
                  ? 'bg-primary text-white font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </div>
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                folder === key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {loading ? '…' : countFor(key)}
              </span>
            </button>
          ))}
        </div>

        {/* Main panel */}
        <div className="flex-1 min-w-0 space-y-4">
            <DataControlsBar
              sortFields={RCP_SORT_FIELDS}
              sortKey={rcpState.sortKey}
              sortDir={rcpState.sortDir}
              onSort={rcpState.setSort}
              defaultSortKey="created_at"
              defaultSortDir="desc"
              search={rcpState.search}
              onSearchChange={rcpState.setSearch}
              searchPlaceholder="Search file name…"
              searchColumns={RCP_SEARCH_COLS}
              searchCol={rcpState.searchCol}
              onSearchColChange={rcpState.setSearchCol}
              advancedSort={rcpState.advancedSort}
              onAdvancedSort={rcpState.setAdvancedSort}
            />

          {loading ? (
            <Card>
              <div className="py-16 flex justify-center">
                <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
              </div>
            </Card>
          ) : sortedReceipts.length === 0 && !error ? (
            <Card>
              <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
                <Paperclip className="w-12 h-12 text-gray-200" />
                <p className="text-sm">{rcpState.search ? 'No files match your search.' : 'No receipts in this folder yet.'}</p>
              </div>
            </Card>
          ) : !error && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {sortedReceipts.map(r => (
                <div
                  key={r.id}
                  className="bg-white border border-gray-100 rounded-xl p-3 space-y-2 hover:shadow-md transition-shadow group"
                >
                  <div className="flex justify-center py-2">
                    {fileIcon(r.mime_type)}
                  </div>
                  <p className="text-xs font-medium text-gray-800 truncate text-center" title={r.file_name}>
                    {r.file_name}
                  </p>
                  <div className="text-center space-y-0.5">
                    <p className="text-[10px] text-gray-400">{formatDate(r.created_at.slice(0, 10))}</p>
                    {r.file_size && (
                      <p className="text-[10px] text-gray-400">{formatBytes(r.file_size)}</p>
                    )}
                    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">
                      {r.entity_type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex justify-center gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(r)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(r)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
