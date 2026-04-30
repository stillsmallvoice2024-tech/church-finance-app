import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface CategoryGroup {
  id:         string
  name:       string
  sort_order: number
  created_at: string
}

export interface Category {
  id:               string
  name:             string
  description:      string | null
  starting_balance: number | null
  starting_balance_budget_portion: string | null
  group_id:         string | null
  is_hidden:        boolean
  created_at:       string
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('categories')
      .select('*')
      .order('name')
    if (err) setError(err.message)
    else setCategories((data ?? []) as Category[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { categories, loading, error, refetch: fetch }
}

export function useCategoryGroups() {
  const [groups, setGroups] = useState<CategoryGroup[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('category_groups')
      .select('*')
      .order('sort_order')
      .order('name')
    setGroups((data ?? []) as CategoryGroup[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { groups, loading, refetch: fetch }
}
