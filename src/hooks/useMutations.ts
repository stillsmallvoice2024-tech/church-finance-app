import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import type { StartingBalanceRow } from './useBanks'

const BULK_CHUNK_SIZE = 500

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// Returns { org_id } fragment. Throws if no active org is set — all mutations require
// an explicit org_id because the DB column default (get_current_org_id()) returns NULL.
function orgPayload(): { org_id: string } {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation — please reload the page.')
  return { org_id: orgId }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err)
    return String((err as { message: unknown }).message)
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred'
}

// If a mutation returns a JWT / auth error, force a session refresh so the
// next attempt gets a fresh token instead of hanging on a stale one.
function handleAuthError(err: unknown): void {
  const msg = extractMessage(err).toLowerCase()
  if (msg.includes('jwt') || msg.includes('invalid claim') || msg.includes('not authenticated')) {
    supabase.auth.refreshSession().catch(() => {})
  }
}

// Audit writes are now handled by server-side AFTER triggers (audit_trigger_fn /
// field_changes_trigger_fn). These stubs preserve call-sites; the DB layer
// captures auth.uid(), now(), and row data — none can be forged by the client.

async function logFieldChanges(
  _userId:    string,
  _tableName: string,
  _recordId:  string,
  _oldData:   Record<string, unknown>,
  _newData:   Record<string, unknown>,
): Promise<void> {}

async function logAudit(_: {
  userId: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  tableName: string
  recordId: string
  oldData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
}): Promise<void> {}

async function batchLogAudit(_rows: Array<{
  user_id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  table_name: string
  record_id: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}>): Promise<void> {}

async function batchLogFieldChanges(_rows: Array<{
  user_id: string
  table_name: string
  record_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
}>): Promise<void> {}

// ── Input types ────────────────────────────────────────────────────────────────

export interface AddInflowInput {
  date: string
  amount: number
  description?: string
  allocation_config_id?: string
  stage_code_1?: string
  stage_code_2?: string
  stage_code_3?: string
  transaction_ref?: string
  specific_seed_description?: string
  remark?: string
  fx_currency?: string
  fx_amount?: number
  fx_rate?: number
  transaction_type?: string
  original_transaction_id?: string
  income_type_id?: string
  bank_name?: string
  recorded_at?: string
  root_transaction_id?: string | null
  root_transaction_table?: 'inflow_transactions' | 'outflow_transactions' | null
  offset_link_type?: string | null
  offset_role?: 'root' | 'offset' | null
}

export interface AddOutflowInput {
  date: string
  amount_disbursed: number
  is_pending_deduction?: boolean
  description?: string
  allocation_config_id?: string
  bank_description?: string
  transaction_id?: string
  amount_refunded?: number
  transfer_charge?: number
  bank_total?: number
  stage_code_1?: string
  stage_code_2?: string
  remarks?: string
  fx_currency?: string
  fx_amount?: number
  fx_rate?: number
  transaction_type?: string
  original_transaction_id?: string
  outflow_type_id?: string | null
  department_id?: string | null
  bank_name?: string
  recorded_at?: string
  root_transaction_id?: string | null
  root_transaction_table?: 'inflow_transactions' | 'outflow_transactions' | null
  offset_link_type?: string | null
  offset_role?: 'root' | 'offset' | null
}

export interface AddIntraFlowInput {
  date: string
  account_from: string
  account_from_stage2: string
  account_to: string
  account_to_stage2: string
  total_amount: number
  description?: string
  transaction_ref?: string
  remark?: string
  transfer_type?: string
  batch_id?: string
  // Optional: caller may pre-supply resolved IDs; hook resolves them from DB if absent
  from_category_id?: string | null
  to_category_id?: string | null
  reversal_of_id?: string | null
}

export interface UpdateTransactionInput {
  id: string
  updates: Record<string, unknown>
}

// ── Return type shared by all mutation hooks ───────────────────────────────────

export interface MutationHook<TInput, TReturn = void> {
  mutate: (input: TInput) => Promise<TReturn>
  loading: boolean
  error: string | null
  reset: () => void   // clear error state
}

// ── useAddInflow ───────────────────────────────────────────────────────────────

export function useAddInflow(): MutationHook<AddInflowInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddInflowInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to add transactions.')
    if (input.transaction_type === 'fx_inflow' || input.transaction_type === 'fx_outflow')
      throw new Error('FX transactions must be entered through the Foreign Currency module.')
    if (input.offset_role === 'offset' && !input.root_transaction_id)
      throw new Error('Offset transactions require root_transaction_id to be set.')

    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await supabase
        .from('inflow_transactions')
        .insert({ ...input, created_by: user.id, ...orgPayload() })
        .select('id')
        .single()

      if (err) throw err
      if (!data?.id) throw new Error('No ID returned after insert.')

      logAudit({
        userId:    user.id,
        action:    'INSERT',
        tableName: 'inflow_transactions',
        recordId:  data.id,
        newData:   input as unknown as Record<string, unknown>,
      })

      useTransactionSyncStore.getState().bumpInflow()

      return data.id
    } catch (err) {
      const msg = extractMessage(err)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, []) // stable: reads user from store at call-time

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddOutflow ──────────────────────────────────────────────────────────────

export function useAddOutflow(): MutationHook<AddOutflowInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddOutflowInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to add transactions.')
    if (input.transaction_type === 'fx_inflow' || input.transaction_type === 'fx_outflow')
      throw new Error('FX transactions must be entered through the Foreign Currency module.')
    if (input.offset_role === 'offset' && !input.root_transaction_id)
      throw new Error('Offset transactions require root_transaction_id to be set.')

    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await supabase
        .from('outflow_transactions')
        .insert({ ...input, is_pending_deduction: input.is_pending_deduction ?? false, created_by: user.id, ...orgPayload() })
        .select('id')
        .single()

      if (err) throw err
      if (!data?.id) throw new Error('No ID returned after insert.')

      logAudit({
        userId:    user.id,
        action:    'INSERT',
        tableName: 'outflow_transactions',
        recordId:  data.id,
        newData:   input as unknown as Record<string, unknown>,
      })

      useTransactionSyncStore.getState().bumpOutflow()

      return data.id
    } catch (err) {
      const msg = extractMessage(err)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddIntraFlow ────────────────────────────────────────────────────────────

export function useAddIntraFlow(): MutationHook<AddIntraFlowInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddIntraFlowInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to add transfers.')

    setLoading(true)
    setError(null)

    try {
      // Resolve category IDs from name snapshots (authoritative FK; name stays as readability snapshot)
      let fromId = input.from_category_id ?? null
      let toId   = input.to_category_id   ?? null

      if (!fromId || !toId) {
        const namesToResolve = [...new Set([input.account_from, input.account_to])]
        const { data: catRows } = await supabase
          .from('categories')
          .select('id, name')
          .in('name', namesToResolve)
        const catMap = new Map((catRows ?? []).map(c => [c.name as string, c.id as string]))
        if (!fromId) fromId = catMap.get(input.account_from) ?? null
        if (!toId)   toId   = catMap.get(input.account_to)   ?? null
      }

      const { data, error: err } = await supabase
        .from('intra_flows')
        .insert({
          ...input,
          from_category_id: fromId,
          to_category_id:   toId,
          status:           'active',
          created_by:       user.id,
          ...orgPayload(),
        })
        .select('id')
        .single()

      if (err) throw err
      if (!data?.id) throw new Error('No ID returned after insert.')

      logAudit({
        userId:    user.id,
        action:    'INSERT',
        tableName: 'intra_flows',
        recordId:  data.id,
        newData:   { ...input, from_category_id: fromId, to_category_id: toId } as unknown as Record<string, unknown>,
      })

      useTransactionSyncStore.getState().bumpIntraflow()

      return data.id
    } catch (err) {
      const msg = extractMessage(err)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateTransaction ───────────────────────────────────────────────────────

type UpdatableTable = 'inflow_transactions' | 'outflow_transactions' | 'intra_flows'

export function useUpdateTransaction(table: UpdatableTable): MutationHook<UpdateTransactionInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async ({ id, updates }: UpdateTransactionInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to update records.')

    setLoading(true)
    setError(null)

    try {
      // Snapshot old data for the audit trail
      const { data: oldData } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single()

      // Only inflow_transactions and outflow_transactions have updated_at
      const withTimestamp = table !== 'intra_flows'
        ? { ...updates, updated_at: new Date().toISOString() }
        : updates

      // Use .select('id') without head:true — head:true changes the method to HEAD
      // which reads without writing, causing silent no-ops that appear successful.
      const { data: updatedRows, error: err } = await supabase
        .from(table)
        .update(withTimestamp)
        .eq('id', id)
        .select('id')

      if (err) throw err
      if (!updatedRows?.length) {
        throw new Error('Record not found or update blocked by permissions.')
      }

      logAudit({
        userId:    user.id,
        action:    'UPDATE',
        tableName: table,
        recordId:  id,
        oldData:   (oldData ?? null) as Record<string, unknown> | null,
        newData:   updates,
      })
      if (oldData) {
        logFieldChanges(user.id, table, id, oldData as Record<string, unknown>, updates)
      }

      if (table === 'inflow_transactions')  useTransactionSyncStore.getState().bumpInflow()
      if (table === 'outflow_transactions') useTransactionSyncStore.getState().bumpOutflow()
      if (table === 'intra_flows')          useTransactionSyncStore.getState().bumpIntraflow()
    } catch (err) {
      const msg = extractMessage(err)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [table])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useDeleteTransaction ────────────────────────────────────────────────────────

type DeletableTable = 'inflow_transactions' | 'outflow_transactions' | 'intra_flows'

export function useDeleteTransaction(table: DeletableTable): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()

    if (!user?.id) throw new Error('You must be signed in to delete records.')

    setLoading(true)
    setError(null)

    try {
      // Capture the row before deletion for audit history
      const { data: oldData } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single()

      const { error: err, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .eq('id', id)

      if (err) throw err
      if (!count) throw new Error('Delete was blocked by a database policy. Run the RLS migration in Setup → Database tab to grant delete access.')

      logAudit({
        userId:    user.id,
        action:    'DELETE',
        tableName: table,
        recordId:  id,
        oldData:   (oldData ?? null) as Record<string, unknown> | null,
        newData:   null,
      })

      if (table === 'inflow_transactions')  useTransactionSyncStore.getState().bumpInflow()
      if (table === 'intra_flows') useTransactionSyncStore.getState().bumpIntraflow()
    } catch (err) {
      const msg = extractMessage(err)
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [table])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddLedgerEntry ──────────────────────────────────────────────────────────

export interface AddLedgerEntryInput {
  account_id: string
  date: string
  description?: string
  inflow?: number
  refund_intraflow?: number
  outflow?: number
  // balance is intentionally omitted: trg_ledger_balance trigger recomputes
  // the full chain server-side after every insert/update/delete
  special_seed_description?: string
}

export function useAddLedgerEntry(): MutationHook<AddLedgerEntryInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddLedgerEntryInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('ledger_entries')
        .insert({ ...input, created_by: user.id, ...orgPayload() })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'ledger_entries', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddAccount ──────────────────────────────────────────────────────────────

export interface AddAccountInput {
  code: string
  name: string
  category: 'income' | 'expense' | 'savings' | 'ministry' | 'special' | 'foreign'
  opening_balance?: number
}

export function useAddAccount(): MutationHook<AddAccountInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddAccountInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('accounts')
        .insert({ ...input, is_active: true, ...orgPayload() })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'accounts', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateAccount ───────────────────────────────────────────────────────────

export interface UpdateAccountInput {
  id: string
  code: string
  name: string
  category: 'income' | 'expense' | 'savings' | 'ministry' | 'special' | 'foreign'
  opening_balance?: number
}

export function useUpdateAccount(): MutationHook<UpdateAccountInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateAccountInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('accounts')
        .update({ code: input.code, name: input.name, category: input.category, opening_balance: input.opening_balance ?? 0 })
        .eq('id', input.id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'accounts', recordId: input.id, newData: input as unknown as Record<string, unknown> })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useDeleteAccount ───────────────────────────────────────────────────────────

export function useDeleteAccount(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase.from('accounts').delete().eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'DELETE', tableName: 'accounts', recordId: id })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddCategory ─────────────────────────────────────────────────────────────

export interface AddCategoryInput {
  name:         string
  description?: string
  group_id?:    string | null
  currency?:    string | null
}

export function useAddCategory(): MutationHook<AddCategoryInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddCategoryInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('categories').insert({
          name:        input.name,
          description: input.description ?? null,
          group_id:    input.group_id ?? null,
          ...(input.currency !== undefined ? { currency: input.currency ?? null } : {}),
          ...orgPayload(),
        }).select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'categories', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateCategory ──────────────────────────────────────────────────────────

export interface UpdateCategoryInput {
  id:          string
  name:        string
  description?: string
  group_id?:   string | null
  is_hidden?:  boolean
  currency?:   string | null
}

export function useUpdateCategory(): MutationHook<UpdateCategoryInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateCategoryInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data: oldData } = await supabase.from('categories').select('*').eq('id', input.id).single()
      const updates: Record<string, unknown> = {
        name:        input.name,
        description: input.description ?? null,
        group_id:    input.group_id ?? null,
        ...(input.is_hidden !== undefined ? { is_hidden: input.is_hidden } : {}),
        ...(input.currency  !== undefined ? { currency:  input.currency ?? null } : {}),
      }
      const { data: updatedRows, error: err } = await supabase
        .from('categories')
        .update(updates)
        .eq('id', input.id)
        .select('id')
      if (err) throw err
      if (!updatedRows?.length) throw new Error('Category not found or update was denied.')
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'categories', recordId: input.id, oldData: (oldData ?? null) as Record<string, unknown> | null, newData: updates as unknown as Record<string, unknown> })
      if (oldData) logFieldChanges(user.id, 'categories', input.id, oldData as Record<string, unknown>, updates as Record<string, unknown>)
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useDeleteCategory ──────────────────────────────────────────────────────────

export function useDeleteCategory(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase.from('categories').delete().eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'DELETE', tableName: 'categories', recordId: id })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddCategoryGroup / useDeleteCategoryGroup ───────────────────────────────

export function useAddCategoryGroup(): MutationHook<{ name: string }, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: { name: string }): Promise<string> => {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('category_groups').insert({ name: input.name, ...orgPayload() }).select('id').single()
      if (err) throw err
      return data!.id as string
    } catch (err) {
      const msg = extractMessage(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

export function useDeleteCategoryGroup(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase.from('category_groups').delete().eq('id', id)
      if (err) throw err
    } catch (err) {
      const msg = extractMessage(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

export function useUpdateCategoryGroup(): MutationHook<{ id: string; name: string }> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: { id: string; name: string }): Promise<void> => {
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('category_groups')
        .update({ name: input.name })
        .eq('id', input.id)
      if (err) throw err
    } catch (err) {
      const msg = extractMessage(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddFXTransaction ────────────────────────────────────────────────────────

export interface AddFXTransactionInput {
  date: string
  currency: string
  deposit?: number
  withdrawal?: number
  narration?: string
  transaction_ref?: string
  bank_name?: string
}

export function useAddFXTransaction(): MutationHook<AddFXTransactionInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddFXTransactionInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    const { org_id } = orgPayload()
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase.rpc('create_fx_transaction', {
        p_org_id:          org_id,
        p_user_id:         user.id,
        p_date:            input.date,
        p_currency:        input.currency,
        p_deposit:         input.deposit    ?? 0,
        p_withdrawal:      input.withdrawal ?? 0,
        p_narration:       input.narration       ?? null,
        p_transaction_ref: input.transaction_ref ?? null,
        p_bank_name:       input.bank_name       ?? null,
      })
      if (err) throw err
      if (!data) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'fx_transactions', recordId: data as string, newData: input as unknown as Record<string, unknown> })
      return data as string
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateFXTransaction ─────────────────────────────────────────────────────

export interface UpdateFXTransactionInput {
  id:              string
  date:            string
  currency:        string
  deposit?:        number
  withdrawal?:     number
  narration?:      string
  transaction_ref?: string
  bank_name?:      string
}

export function useUpdateFXTransaction(): MutationHook<UpdateFXTransactionInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateFXTransactionInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    const { org_id } = orgPayload()
    setLoading(true); setError(null)
    try {
      const { data: oldData } = await supabase.from('fx_transactions').select('*').eq('id', input.id).single()
      const { error: err } = await supabase.rpc('update_fx_transaction', {
        p_org_id:          org_id,
        p_user_id:         user.id,
        p_transaction_id:  input.id,
        p_date:            input.date,
        p_currency:        input.currency,
        p_deposit:         input.deposit    ?? 0,
        p_withdrawal:      input.withdrawal ?? 0,
        p_narration:       input.narration       ?? null,
        p_transaction_ref: input.transaction_ref ?? null,
        p_bank_name:       input.bank_name       ?? null,
      })
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'fx_transactions', recordId: input.id, oldData: (oldData ?? null) as Record<string, unknown> | null, newData: input })
      if (oldData) logFieldChanges(user.id, 'fx_transactions', input.id, oldData as Record<string, unknown>, input as unknown as Record<string, unknown>)
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddBank ─────────────────────────────────────────────────────────────────

export interface AddBankInput {
  name:            string
  account_number?: string
  account_type?:   string
  currency?:       string
  is_foreign_currency?: boolean
  starting_balance?:               number
  starting_balance_category?:      string
  starting_balance_budget_portion?: string
  starting_balance_alloc_type?:    'percentage' | 'amount'
  starting_balance_allocations?:   StartingBalanceRow[]
}

export function useAddBank(): MutationHook<AddBankInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddBankInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('banks').insert({ ...input, ...orgPayload() }).select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'banks', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateBank ──────────────────────────────────────────────────────────────

export interface UpdateBankInput {
  id:              string
  name:            string
  account_number?: string
  account_type?:   string
  currency?:       string
  is_foreign_currency?: boolean
  starting_balance?:               number
  starting_balance_category?:      string
  starting_balance_budget_portion?: string
  starting_balance_alloc_type?:    'percentage' | 'amount'
  starting_balance_allocations?:   StartingBalanceRow[]
}

export function useUpdateBank(): MutationHook<UpdateBankInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateBankInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data: oldData } = await supabase
        .from('banks').select('*').eq('id', input.id).single()

      const updates = {
        name:           input.name,
        account_number: input.account_number ?? null,
        account_type:   input.account_type   ?? null,
        currency:       input.currency        ?? useOrgStore.getState().defaultCurrency ?? '',
        is_foreign_currency: input.is_foreign_currency ?? false,
        starting_balance:                input.starting_balance               ?? null,
        starting_balance_category:       input.starting_balance_category      ?? null,
        starting_balance_budget_portion: input.starting_balance_budget_portion ?? null,
        starting_balance_alloc_type:     input.starting_balance_alloc_type    ?? null,
        ...(input.starting_balance_allocations !== undefined && {
          starting_balance_allocations: input.starting_balance_allocations,
        }),
      }

      const { data: updatedRows, error: err } = await supabase
        .from('banks').update(updates).eq('id', input.id).select('id')
      if (err) throw err
      if (!updatedRows?.length) throw new Error('Bank not found or update was silently rejected — please refresh and try again.')

      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'banks', recordId: input.id, oldData: (oldData ?? null) as Record<string, unknown> | null, newData: updates as unknown as Record<string, unknown> })
      if (oldData) logFieldChanges(user.id, 'banks', input.id, oldData as Record<string, unknown>, updates as Record<string, unknown>)
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useDeleteBank ──────────────────────────────────────────────────────────────

export function useDeleteBank(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase.from('banks').delete().eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'DELETE', tableName: 'banks', recordId: id })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddAllocationConfig ─────────────────────────────────────────────────────

export interface AllocationRowInput {
  category_name: string
  percentage:    number
}

export interface AddAllocationConfigInput {
  name:       string
  start_date: string
  rows:       AllocationRowInput[]
}

export function useAddAllocationConfig(): MutationHook<AddAllocationConfigInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddAllocationConfigInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('allocation_configs')
        .insert({ name: input.name, start_date: input.start_date, status: 'draft', rows: input.rows, ...orgPayload() })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'allocation_configs', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUpdateAllocationConfig ──────────────────────────────────────────────────

export interface UpdateAllocationConfigInput {
  id:         string
  name:       string
  start_date: string
  rows:       AllocationRowInput[]
}

export function useUpdateAllocationConfig(): MutationHook<UpdateAllocationConfigInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateAllocationConfigInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('allocation_configs')
        .update({ name: input.name, start_date: input.start_date, rows: input.rows })
        .eq('id', input.id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'allocation_configs', recordId: input.id, newData: input as unknown as Record<string, unknown> })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useLockAllocationConfig ────────────────────────────────────────────────────

export function useLockAllocationConfig(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('allocation_configs').update({ status: 'locked' }).eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'allocation_configs', recordId: id, newData: { status: 'locked' } })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useDeleteAllocationConfig ──────────────────────────────────────────────────

export function useDeleteAllocationConfig(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('allocation_configs').delete().eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'DELETE', tableName: 'allocation_configs', recordId: id, newData: {} })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useUnlockAllocationConfig ──────────────────────────────────────────────────

export function useUnlockAllocationConfig(): MutationHook<string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (id: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('allocation_configs').update({ status: 'draft' }).eq('id', id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'allocation_configs', recordId: id, newData: { status: 'draft' } })
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useBulkDeleteTransaction ────────────────────────────────────────────────────
// Processes IDs in chunks of BULK_CHUNK_SIZE to stay within PostgREST URL limits.
// 3 queries per chunk (SELECT IN + DELETE IN + batch audit INSERT).
// Chunk failures are non-fatal: failed count accumulates and is returned to the caller.

export function useBulkDeleteTransaction(table: DeletableTable) {
  const [loading, setLoading] = useState(false)

  const execute = useCallback(async (ids: string[]): Promise<{ failed: number; total: number }> => {
    if (ids.length === 0) return { failed: 0, total: 0 }
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to delete records.')

    setLoading(true)
    let totalDeleted = 0
    try {
      for (const chunk of chunkArray(ids, BULK_CHUNK_SIZE)) {
        try {
          const { data: oldRows } = await supabase.from(table).select('*').in('id', chunk)
          const oldMap = new Map((oldRows ?? []).map(r => [r.id as string, r as Record<string, unknown>]))

          const { data: deletedRows, error: err } = await supabase
            .from(table)
            .delete()
            .in('id', chunk)
            .select('id')

          if (err) throw err

          const deletedIds = (deletedRows ?? []).map(r => r.id as string)
          totalDeleted += deletedIds.length

          batchLogAudit(
            deletedIds.map(id => ({
              user_id:    user.id,
              action:     'DELETE' as const,
              table_name: table,
              record_id:  id,
              old_data:   oldMap.get(id) ?? null,
              new_data:   null,
            }))
          )
        } catch (chunkErr) {
          handleAuthError(chunkErr)
          console.warn('[bulkDelete] chunk failed:', extractMessage(chunkErr))
          // chunk.length records counted as failed via totalDeleted not advancing
        }
      }

      if (table === 'inflow_transactions')  useTransactionSyncStore.getState().bumpInflow()
      if (table === 'intra_flows') useTransactionSyncStore.getState().bumpIntraflow()

      return { failed: ids.length - totalDeleted, total: ids.length }
    } finally {
      setLoading(false)
    }
  }, [table])

  return { execute, loading }
}

// ── useBulkUpdateTransaction ────────────────────────────────────────────────────
// Processes IDs in chunks of BULK_CHUNK_SIZE.  4 queries per chunk
// (SELECT IN + UPDATE IN + batch audit_log + batch field_changes INSERTs).
// Any DB error on a chunk throws immediately — no silent column stripping.

export function useBulkUpdateTransaction(table: UpdatableTable) {
  const [loading, setLoading] = useState(false)

  const execute = useCallback(async (
    ids: string[],
    baseUpdates: Record<string, unknown>,
  ): Promise<{ failed: number; total: number }> => {
    if (ids.length === 0) return { failed: 0, total: 0 }
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in to update records.')

    setLoading(true)
    let totalUpdated = 0

    const updates: Record<string, unknown> = table !== 'intra_flows'
      ? { ...baseUpdates, updated_at: new Date().toISOString() }
      : { ...baseUpdates }

    try {
      for (const chunk of chunkArray(ids, BULK_CHUNK_SIZE)) {
        const { data: oldRows } = await supabase.from(table).select('*').in('id', chunk)
        const oldMap = new Map((oldRows ?? []).map(r => [r.id as string, r as Record<string, unknown>]))

        const { data: updatedRows, error: err } = await supabase
          .from(table)
          .update(updates)
          .in('id', chunk)
          .select('id')

        if (err) {
          handleAuthError(err)
          throw err
        }

        const chunkUpdatedIds = (updatedRows ?? []).map(r => r.id as string)
        totalUpdated += chunkUpdatedIds.length

        if (chunkUpdatedIds.length > 0) {
          batchLogAudit(
            chunkUpdatedIds.map(id => ({
              user_id:    user.id,
              action:     'UPDATE' as const,
              table_name: table,
              record_id:  id,
              old_data:   oldMap.get(id) ?? null,
              new_data:   baseUpdates,
            }))
          )

          const fcRows: Array<{
            user_id: string; table_name: string; record_id: string
            field_name: string; old_value: string | null; new_value: string | null
          }> = []
          for (const id of chunkUpdatedIds) {
            const oldData = oldMap.get(id)
            if (!oldData) continue
            for (const [k, newVal] of Object.entries(baseUpdates)) {
              if (String(oldData[k] ?? '') !== String(newVal ?? '')) {
                fcRows.push({
                  user_id:    user.id,
                  table_name: table,
                  record_id:  id,
                  field_name: k,
                  old_value:  oldData[k] != null ? String(oldData[k]) : null,
                  new_value:  newVal    != null ? String(newVal)    : null,
                })
              }
            }
          }
          batchLogFieldChanges(fcRows)
        }
      }

      if (table === 'inflow_transactions')  useTransactionSyncStore.getState().bumpInflow()
      if (table === 'outflow_transactions') useTransactionSyncStore.getState().bumpOutflow()
      if (table === 'intra_flows')          useTransactionSyncStore.getState().bumpIntraflow()

      return { failed: ids.length - totalUpdated, total: ids.length }
    } catch (err) {
      const msg = extractMessage(err)
      handleAuthError(err)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [table])

  return { execute, loading }
}
