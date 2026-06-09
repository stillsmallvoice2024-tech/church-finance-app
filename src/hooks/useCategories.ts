import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

export type BudgetPortion = 'Percentage Allocation' | 'Specific Seed' | 'Savings'

export interface CategoryOpeningBalance {
  id:             string
  category_id:    string
  budget_portion: BudgetPortion
  amount:         number
}

export interface CategoryGroup {
  id:         string
  name:       string
  sort_order: number
  created_at: string
}

export interface Category {
  id:          string
  name:        string
  description: string | null
  group_id:    string | null
  is_hidden:   boolean
  created_at:  string
}

export function useCategories() {
  const orgId = useOrgStore((s) => s.orgId)

  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('categories')
      .select('*')
      .eq('org_id', orgId)
      .order('name')
    if (err) setError(err.message)
    else setCategories((data ?? []) as Category[])
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { categories, loading, error, refetch: fetch }
}

export function useCategoryOpeningBalances(categoryId?: string) {
  const [balances, setBalances] = useState<CategoryOpeningBalance[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    let query = supabase.from('category_opening_balances').select('*')
    if (categoryId) query = query.eq('category_id', categoryId)
    const { data, error: err } = await query.order('budget_portion')
    if (err && !/does not exist/i.test(err.message)) setError(err.message)
    else setBalances((data ?? []) as CategoryOpeningBalance[])
    setLoading(false)
  }, [categoryId])

  useEffect(() => { fetch() }, [fetch])
  return { balances, loading, error, refetch: fetch }
}

export async function upsertCategoryOpeningBalance(
  categoryId: string,
  budgetPortion: BudgetPortion,
  amount: number,
  orgId: string,
): Promise<void> {
  if (!isFinite(amount) || isNaN(amount) || amount < 0) {
    throw new Error(`Invalid opening balance amount: ${amount}. Must be a finite non-negative number.`)
  }
  const { data, error } = await supabase
    .from('category_opening_balances')
    .upsert({ category_id: categoryId, budget_portion: budgetPortion, amount, org_id: orgId },
             { onConflict: 'category_id,budget_portion' })
    .select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Opening balance write was silently rejected — run the category_opening_balances migration from Setup → Database.')
}

export async function deleteCategoryOpeningBalance(
  categoryId: string,
  budgetPortion: BudgetPortion,
): Promise<void> {
  const { error } = await supabase
    .from('category_opening_balances')
    .delete()
    .eq('category_id', categoryId)
    .eq('budget_portion', budgetPortion)
  if (error) throw new Error(error.message)
}

export async function fetchCategoryOpeningBalances(categoryId: string): Promise<CategoryOpeningBalance[]> {
  const { data, error } = await supabase
    .from('category_opening_balances')
    .select('*')
    .eq('category_id', categoryId)
    .order('budget_portion')
  if (error && /does not exist/i.test(error.message)) return []
  if (error) throw new Error(error.message)
  return (data ?? []) as CategoryOpeningBalance[]
}

export function useCategoryGroups() {
  const orgId = useOrgStore((s) => s.orgId)

  const [groups, setGroups] = useState<CategoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('category_groups')
      .select('*')
      .eq('org_id', orgId)
      .order('sort_order')
      .order('name')
    if (err) setError(err.message)
    else setGroups((data ?? []) as CategoryGroup[])
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { groups, loading, error, refetch: fetch }
}
