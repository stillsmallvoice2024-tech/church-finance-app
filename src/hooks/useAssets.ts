import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export const ASSET_TYPES = [
  'Equipment',
  'Vehicle',
  'Property',
  'Furniture',
  'Technology',
  'Other',
] as const

export type AssetType = typeof ASSET_TYPES[number]

export interface Asset {
  id:                string
  name:              string
  asset_type:        string
  cost:              number
  purchase_date:     string
  useful_life_years: number | null
  salvage_value:     number
  notes:             string | null
  created_at:        string
}

export interface AssetInput {
  name:              string
  asset_type:        string
  cost:              number
  purchase_date:     string
  useful_life_years: number | null
  salvage_value:     number
  notes:             string | null
}

// Straight-line depreciation. Returns current net book value.
export function netBookValue(asset: Asset): number {
  const ageYears = (Date.now() - new Date(asset.purchase_date).getTime()) / (365.25 * 86400000)
  const depreciable = asset.cost - asset.salvage_value
  const accumulated = asset.useful_life_years && asset.useful_life_years > 0
    ? Math.min(depreciable, (depreciable / asset.useful_life_years) * ageYears)
    : 0
  return Math.max(asset.salvage_value, asset.cost - accumulated)
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAssets() {
  const orgId = useOrgStore(s => s.orgId)

  const [assets,  setAssets]  = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('assets')
      .select('*')
      .eq('org_id', orgId)
      .order('purchase_date', { ascending: false })
    if (err) {
      if (/relation.*does not exist/i.test(err.message)) setAssets([])
      else setError(err.message)
    } else {
      setAssets((data ?? []) as Asset[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { assets, loading, error, refetch: fetch }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function saveAsset(input: AssetInput, existingId?: string): Promise<void> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')
  if (existingId) {
    const { error } = await supabase.from('assets').update(input).eq('id', existingId)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('assets').insert({ ...input, org_id: orgId })
    if (error) throw new Error(error.message)
  }
}

export async function deleteAsset(id: string): Promise<void> {
  const { error, count } = await supabase
    .from('assets').delete({ count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (count === 0) throw new Error('Record not found or access denied.')
}

// ── Migration SQL ──────────────────────────────────────────────────────────────

export const ASSETS_MIGRATION_SQL =
`-- Health Centre: Asset Register
CREATE TABLE IF NOT EXISTS public.assets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL,
  name              text        NOT NULL,
  asset_type        text        NOT NULL DEFAULT 'Other',
  cost              numeric(15,2) NOT NULL DEFAULT 0,
  purchase_date     date        NOT NULL,
  useful_life_years numeric(5,1),
  salvage_value     numeric(15,2) NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "assets_auth_all" ON public.assets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Health Centre: Liability Register
CREATE TABLE IF NOT EXISTS public.liabilities (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  name               text        NOT NULL,
  liability_type     text        NOT NULL DEFAULT 'Other',
  lender             text,
  principal_amount   numeric(15,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(15,2) NOT NULL DEFAULT 0,
  interest_rate      numeric(5,2),
  repayment_notes    text,
  due_date           date,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.liabilities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "liabilities_auth_all" ON public.liabilities
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
