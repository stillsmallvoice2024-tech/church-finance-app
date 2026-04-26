import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Category {
  id:               string
  name:             string
  description:      string | null
  starting_balance: number | null
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
    else setCategories(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { categories, loading, error, refetch: fetch }
}
