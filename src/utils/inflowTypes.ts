export type InflowType =
  | 'general_giving'
  | 'specific_seed'
  | 'tithe'
  | 'offering'
  | 'direct_seed'
  | 'refund'

export const INFLOW_TYPES: InflowType[] = [
  'general_giving', 'specific_seed', 'tithe', 'offering', 'direct_seed', 'refund',
]

export const INFLOW_TYPE_LABELS: Record<InflowType, string> = {
  general_giving: 'General Giving',
  specific_seed:  'Specific Seed',
  tithe:          'Tithe',
  offering:       'Offering',
  direct_seed:    'Direct Seed',
  refund:         'Refund',
}

export const INFLOW_TYPE_BADGE: Record<InflowType, string> = {
  general_giving: 'bg-blue-100 text-blue-700',
  specific_seed:  'bg-purple-100 text-purple-700',
  tithe:          'bg-green-100 text-green-700',
  offering:       'bg-amber-100 text-amber-700',
  direct_seed:    'bg-indigo-100 text-indigo-700',
  refund:         'bg-gray-100 text-gray-600',
}

/** Auto-assigns an inflow type based on description keywords. All editable. */
export function autoAssignInflowType(description: string): InflowType {
  if (!description) return 'general_giving'
  const d = description.toLowerCase()
  if (d.includes('offer')) return 'offering'
  if (d.includes('tith'))  return 'tithe'
  return 'general_giving'
}

/** Jaccard similarity on meaningful words — used for fuzzy duplicate detection. */
export function descriptionSimilarity(a: string, b: string): number {
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from'])
  const words = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP.has(w)))
  const wa = words(a)
  const wb = words(b)
  const intersection = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 0 : intersection / union
}
