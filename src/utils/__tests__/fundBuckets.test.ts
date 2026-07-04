import { describe, it, expect } from 'vitest'
import { aggregateFundBuckets, type FundBucketInputs } from '../fundBuckets'
import type { AllocationConfig, SpecialConfigGroup } from '../../store/allocationStore'

// Minimal empty-input scaffold; individual tests override what they exercise.
function inputs(over: Partial<FundBucketInputs>): FundBucketInputs {
  return {
    seedInflows: [], seedOutflows: [], savInflows: [], savOutflows: [],
    allInflows: [], openingBalances: [], intraFlows: [], pctOutflows: [],
    incomeTypeGroup: new Map(), configs: [], groups: [],
    ...over,
  }
}

const generalGroup: SpecialConfigGroup = { id: 'g1', name: 'General', is_default: true, created_at: '' }

function lockedConfig(rows: AllocationConfig['rows'], from = '2020-01-01'): AllocationConfig {
  return {
    id: 'cfg1', name: 'General v1', start_date: from, status: 'locked', rows,
    created_at: '', config_group_id: 'g1', effective_from: from, effective_to: null, version_number: 1,
  }
}

describe('aggregateFundBuckets — bucket routing', () => {
  it('routes direct seed / savings inflows and offset-aware outflows', () => {
    const r = aggregateFundBuckets(inputs({
      seedInflows:  [{ stage_code_1: 'Missions', amount: 1000, date: '2024-01-01', specific_seed_description: 'Roof' }],
      seedOutflows: [
        { stage_code_1: 'Missions', amount_disbursed: 300, offset_role: null },
        { stage_code_1: 'Missions', amount_disbursed: 50,  offset_role: 'offset' }, // reverses an outflow
      ],
      savInflows:   [{ stage_code_1: 'Reserve', amount: 500 }],
      savOutflows:  [{ stage_code_1: 'Reserve', amount_disbursed: 200, offset_role: null }],
    }))
    const m = r.byCategory.get('Missions')!
    expect(m.seedIn).toBe(1000)
    expect(m.seedOut).toBe(250)          // 300 − 50 (offset)
    const res = r.byCategory.get('Reserve')!
    expect(res.savIn).toBe(500)
    expect(res.savOut).toBe(200)
  })

  it('distributes a plain inflow through the date-resolved general config (no explicit id)', () => {
    // This is the exact case the old tab math missed — an inflow with no
    // allocation_config_id still allocates via the current general config.
    const r = aggregateFundBuckets(inputs({
      allInflows: [{ date: '2024-06-01', amount: 1000, stage_code_2: null, allocation_config_id: null, income_type_id: null }],
      configs: [lockedConfig([
        { category_name: 'Tithe',   budget_portion: 'Percentage',    percentage: 60 },
        { category_name: 'Building', budget_portion: 'Specific Seed', percentage: 40 },
      ])],
      groups: [generalGroup],
    }))
    expect(r.byCategory.get('Tithe')!.pctIn).toBe(600)
    expect(r.byCategory.get('Building')!.seedIn).toBe(400)
  })

  it('splits internal transfers into In (to) and Out (from) per portion', () => {
    const r = aggregateFundBuckets(inputs({
      intraFlows: [
        { account_from: 'A', account_from_stage2: 'Percentage Allocation', account_to: 'B', account_to_stage2: 'Percentage Allocation', total_amount: 100, date: '2024-02-02' },
      ],
    }))
    expect(r.byCategory.get('A')!.pctOut).toBe(100)
    expect(r.byCategory.get('B')!.pctIn).toBe(100)
  })
})

describe('aggregateFundBuckets — card ↔ tab reconciliation', () => {
  it('seedTargets per category sum to the net (seedIn − seedOut)', () => {
    const r = aggregateFundBuckets(inputs({
      seedInflows:  [
        { stage_code_1: 'Missions', amount: 1000, date: '2024-01-01', specific_seed_description: 'Roof' },
        { stage_code_1: 'Missions', amount: 250,  date: '2024-03-01', specific_seed_description: 'Van' },
      ],
      seedOutflows: [{ stage_code_1: 'Missions', amount_disbursed: 400, offset_role: null }],
      openingBalances: [{ budget_portion: 'Specific Seed', amount: 100, category: 'Missions' }],
    }))
    const b = r.byCategory.get('Missions')!
    const net = b.seedIn - b.seedOut
    const targetSum = (r.seedTargets.get('Missions') ?? []).reduce((s, t) => s + t.total, 0)
    expect(targetSum).toBeCloseTo(net, 6)   // breakdown reconciles to the shown balance
    expect(b.seedIn).toBe(1350)             // 1000 + 250 + 100 COB
    expect(b.seedOut).toBe(400)
  })

  it('the same result object feeds card net and tab in/out — they cannot diverge', () => {
    const r = aggregateFundBuckets(inputs({
      allInflows: [{ date: '2024-06-01', amount: 2000, stage_code_2: null, allocation_config_id: null, income_type_id: null }],
      pctOutflows: [{ stage_code_1: 'Tithe', amount_disbursed: 500, offset_role: null }],
      configs: [lockedConfig([{ category_name: 'Tithe', budget_portion: 'Percentage', percentage: 100 }])],
      groups: [generalGroup],
    }))
    const b = r.byCategory.get('Tithe')!
    const cardNet = b.pctIn - b.pctOut          // Category Accounts card
    const tabBalance = b.pctIn - b.pctOut        // Regular Funds tab
    expect(cardNet).toBe(1500)
    expect(tabBalance).toBe(cardNet)
  })
})
