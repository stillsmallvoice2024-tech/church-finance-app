import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { StartingBalanceRow } from './useBanks'

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

/**
 * Write an audit entry. Fire-and-forget so it never blocks the main operation.
 * Console-warns on failure but does NOT surface to the user.
 */

async function logFieldChanges(
  userId:    string,
  tableName: string,
  recordId:  string,
  oldData:   Record<string, unknown>,
  newData:   Record<string, unknown>,
): Promise<void> {
  const rows = Object.keys(newData)
    .filter(k => String(oldData[k] ?? '') !== String(newData[k] ?? ''))
    .map(k => ({
      user_id:    userId,
      table_name: tableName,
      record_id:  recordId,
      field_name: k,
      old_value:  oldData[k] != null ? String(oldData[k]) : null,
      new_value:  newData[k] != null ? String(newData[k]) : null,
    }))
  if (rows.length === 0) return
  const { error } = await supabase.from('field_changes').insert(rows)
  if (error) console.warn('[field_changes] write failed:', error.message)
}

async function logAudit({
  userId,
  action,
  tableName,
  recordId,
  oldData = null,
  newData = null,
}: {
  userId: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  tableName: string
  recordId: string
  oldData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
}): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    user_id:    userId,
    action,
    table_name: tableName,
    record_id:  recordId,
    old_data:   oldData,
    new_data:   newData,
  })
  if (error) console.warn('[audit_log] write failed:', error.message)
}

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
  actual_amount?: number
  bank_total?: number
  stage_code_1?: string
  stage_code_2?: string
  remarks?: string
  fx_currency?: string
  fx_amount?: number
  fx_rate?: number
  transaction_type?: string
  original_transaction_id?: string
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

    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await supabase
        .from('inflow_transactions')
        .insert({ ...input, created_by: user.id })
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

    setLoading(true)
    setError(null)

    try {
      const { data, error: err } = await supabase
        .from('outflow_transactions')
        .insert({ ...input, created_by: user.id })
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
      const { data, error: err } = await supabase
        .from('intra_flows')
        .insert({ ...input, created_by: user.id })
        .select('id')
        .single()

      if (err) throw err
      if (!data?.id) throw new Error('No ID returned after insert.')

      logAudit({
        userId:    user.id,
        action:    'INSERT',
        tableName: 'intra_flows',
        recordId:  data.id,
        newData:   input as unknown as Record<string, unknown>,
      })

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

      const { error: err } = await supabase
        .from(table)
        .update(withTimestamp)
        .eq('id', id)

      if (err) throw err

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
    const { user, role } = useAuthStore.getState()

    // Client-side guard (DB RLS provides the real enforcement)
    if (role !== 'admin') throw new Error('Only administrators can delete records.')
    if (!user?.id)        throw new Error('You must be signed in to delete records.')

    setLoading(true)
    setError(null)

    try {
      // Capture the row before deletion for audit history
      const { data: oldData } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single()

      const { error: err } = await supabase
        .from(table)
        .delete()
        .eq('id', id)

      if (err) throw err

      logAudit({
        userId:    user.id,
        action:    'DELETE',
        tableName: table,
        recordId:  id,
        oldData:   (oldData ?? null) as Record<string, unknown> | null,
        newData:   null,
      })
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
  balance: number                   // caller pre-computes: prev + inflow + refund - outflow
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
        .insert({ ...input, created_by: user.id })
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
        .insert({ ...input, is_active: true })
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
  name:              string
  description?:      string
  starting_balance?: number
  starting_balance_budget_portion?: string
  group_id?:         string | null
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
          name:             input.name,
          description:      input.description ?? null,
          starting_balance: input.starting_balance ?? null,
          starting_balance_budget_portion: input.starting_balance_budget_portion ?? null,
          group_id:         input.group_id ?? null,
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
  id:                string
  name:              string
  description?:      string
  starting_balance?: number
  starting_balance_budget_portion?: string
  group_id?:         string | null
  is_hidden?:        boolean
}

export function useUpdateCategory(): MutationHook<UpdateCategoryInput> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateCategoryInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { error: err } = await supabase
        .from('categories')
        .update({
          name:             input.name,
          description:      input.description ?? null,
          starting_balance: input.starting_balance ?? null,
          starting_balance_budget_portion: input.starting_balance_budget_portion ?? null,
          group_id:         input.group_id ?? null,
          ...(input.is_hidden !== undefined ? { is_hidden: input.is_hidden } : {}),
        })
        .eq('id', input.id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'categories', recordId: input.id, newData: input as unknown as Record<string, unknown> })
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
        .from('category_groups').insert({ name: input.name }).select('id').single()
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

// ── useAddFXTransaction ────────────────────────────────────────────────────────

export interface AddFXTransactionInput {
  date: string
  currency: 'USD' | 'GBP' | 'EUR' | 'CNY'
  deposit?: number
  withdrawal?: number
  running_balance: number
  narration?: string
  transaction_ref?: string
}

export function useAddFXTransaction(): MutationHook<AddFXTransactionInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddFXTransactionInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('fx_transactions')
        .insert({ ...input, created_by: user.id })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'fx_transactions', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddSpecialProject ───────────────────────────────────────────────────────

export interface AddSpecialProjectInput {
  name: string
  code?: string
  opening_balance?: number
}

export function useAddSpecialProject(): MutationHook<AddSpecialProjectInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddSpecialProjectInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('special_projects')
        .insert({ ...input, is_active: true })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'special_projects', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
    } catch (err) {
      const msg = extractMessage(err); handleAuthError(err); setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

// ── useAddProjectEntry ─────────────────────────────────────────────────────────

export interface AddProjectEntryInput {
  project_id: string
  date: string
  description?: string
  inflow?: number
  outflow?: number
  balance: number
}

export function useAddProjectEntry(): MutationHook<AddProjectEntryInput, string> {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddProjectEntryInput): Promise<string> => {
    const { user } = useAuthStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('project_entries')
        .insert({ ...input, created_by: user.id })
        .select('id').single()
      if (err) throw err
      if (!data?.id) throw new Error('No ID returned.')
      logAudit({ userId: user.id, action: 'INSERT', tableName: 'project_entries', recordId: data.id, newData: input as unknown as Record<string, unknown> })
      return data.id
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
        .from('banks').insert(input).select('id').single()
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
      const { error: err } = await supabase
        .from('banks')
        .update({
          name:           input.name,
          account_number: input.account_number ?? null,
          account_type:   input.account_type   ?? null,
          starting_balance:                input.starting_balance               ?? null,
          starting_balance_category:       input.starting_balance_category      ?? null,
          starting_balance_budget_portion: input.starting_balance_budget_portion ?? null,
          starting_balance_alloc_type:     input.starting_balance_alloc_type    ?? null,
          starting_balance_allocations:    input.starting_balance_allocations   ?? [],
        })
        .eq('id', input.id)
      if (err) throw err
      logAudit({ userId: user.id, action: 'UPDATE', tableName: 'banks', recordId: input.id, newData: input as unknown as Record<string, unknown> })
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
        .insert({ name: input.name, start_date: input.start_date, status: 'draft', rows: input.rows })
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
