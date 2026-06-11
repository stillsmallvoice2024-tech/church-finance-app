import { supabase } from '../lib/supabase'
import type { ReconciliationIssue, ReconciliationRule } from './reconciliationEngine'

// Fetches all rows by paginating through 1000-row pages.
// Used for reconciliation diagnostics — same pattern as fetchAllRows but
// with an inline type cast that satisfies TypeScript's strict checking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allRows(query: any): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const all: unknown[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await (query as unknown as {
      range: (a: number, b: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
    }).range(from, from + PAGE - 1)
    if (error) return { data: [], error }
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}

// ── Rule 1: Orphan transfer detection ─────────────────────────────────────────
// An intrabank transfer references a bank name that no longer exists.

const orphanTransferRule: ReconciliationRule = {
  id: 'orphan_transfer',
  name: 'Orphan Transfer',
  description: 'Intrabank transfers referencing banks that no longer exist',
  async run(orgId) {
    const [transfersRes, banksRes] = await Promise.all([
      allRows(supabase
        .from('intrabank_transfers')
        .select('id, from_bank_name, to_bank_name, amount, date')
        .eq('org_id', orgId)),
      supabase.from('banks').select('name').eq('org_id', orgId),
    ])
    if (transfersRes.error || banksRes.error) return []

    const bankNames = new Set((banksRes.data ?? []).map((b: Record<string, unknown>) => b.name as string))
    const issues: ReconciliationIssue[] = []

    for (const t of transfersRes.data) {
      const r = t as { id: string; from_bank_name: string; to_bank_name: string; amount: number; date: string }
      if (r.from_bank_name && !bankNames.has(r.from_bank_name)) {
        issues.push({
          id: `orphan_transfer-from-${r.id}`,
          ruleId: 'orphan_transfer',
          severity: 'warning',
          message: `Transfer from "${r.from_bank_name}" — bank no longer exists in records`,
          evidence: { transferId: r.id, fromBank: r.from_bank_name, amount: r.amount, date: r.date },
          suggestedFix: 'Verify the source bank name. If the bank was renamed, update the transfer record.',
          bankName: r.from_bank_name,
        })
      }
      if (r.to_bank_name && !bankNames.has(r.to_bank_name)) {
        issues.push({
          id: `orphan_transfer-to-${r.id}`,
          ruleId: 'orphan_transfer',
          severity: 'warning',
          message: `Transfer to "${r.to_bank_name}" — bank no longer exists in records`,
          evidence: { transferId: r.id, toBank: r.to_bank_name, amount: r.amount, date: r.date },
          suggestedFix: 'Verify the destination bank name. If the bank was renamed, update the transfer record.',
          bankName: r.to_bank_name,
        })
      }
    }
    return issues
  },
}

// ── Rule 2: Missing transfer pair detection ────────────────────────────────────
// A bank_deposits table entry and a tagged inflow_transaction for the same bank,
// date, and amount both exist — potential double-counting.

const missingTransferPairRule: ReconciliationRule = {
  id: 'missing_transfer_pair',
  name: 'Missing Transfer Pair',
  description: 'Bank deposit recorded in both bank_deposits table and inflow_transactions — potential double-count',
  async run(orgId) {
    const [depositsRes, taggedInflowsRes] = await Promise.all([
      allRows(supabase
        .from('bank_deposits')
        .select('id, bank_name, amount, date')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('inflow_transactions')
        .select('id, bank_name, amount, date, offset_role')
        .eq('org_id', orgId)
        .eq('transaction_type', 'bank_deposit')),
    ])
    if (depositsRes.error || taggedInflowsRes.error) return []

    const taggedKey = new Map<string, string>()
    for (const t of taggedInflowsRes.data) {
      const r = t as { id: string; bank_name: string; amount: number; date: string; offset_role: string | null }
      if (r.offset_role === 'offset') continue
      taggedKey.set(`${r.bank_name}|${r.date}|${r.amount}`, r.id)
    }

    const issues: ReconciliationIssue[] = []
    for (const d of depositsRes.data) {
      const r = d as { id: string; bank_name: string; amount: number; date: string }
      const key = `${r.bank_name}|${r.date}|${r.amount}`
      if (taggedKey.has(key)) {
        issues.push({
          id: `missing_transfer_pair-${r.id}`,
          ruleId: 'missing_transfer_pair',
          severity: 'warning',
          message: `Bank deposit of ${r.amount} on ${r.date} for "${r.bank_name}" exists in both deposit records and inflow transactions — possible double count`,
          evidence: { depositId: r.id, matchedInflowId: taggedKey.get(key), bank: r.bank_name, amount: r.amount, date: r.date },
          suggestedFix: 'Check Bank Deposits page. If both entries represent the same deposit, delete one. Keep the inflow transaction (it affects the bank ledger balance).',
          bankName: r.bank_name,
        })
      }
    }
    return issues
  },
}

// ── Rule 3: Duplicate import detection ────────────────────────────────────────
// Two or more inflow or outflow transactions share the same transaction_ref and
// bank_name — likely the same statement was imported twice.

const duplicateImportRule: ReconciliationRule = {
  id: 'duplicate_import',
  name: 'Duplicate Import',
  description: 'Transactions with identical reference numbers on the same bank account',
  async run(orgId) {
    const [inflowRes, outflowRes] = await Promise.all([
      allRows(supabase
        .from('inflow_transactions')
        .select('transaction_ref, bank_name')
        .eq('org_id', orgId)
        .not('transaction_ref', 'is', null)
        .not('bank_name', 'is', null)),
      allRows(supabase
        .from('outflow_transactions')
        .select('transaction_id, bank_name')
        .eq('org_id', orgId)
        .not('transaction_id', 'is', null)
        .not('bank_name', 'is', null)),
    ])

    const inflowMap = new Map<string, number>()
    for (const r of inflowRes.data) {
      const row = r as { transaction_ref: string; bank_name: string }
      const key = `${row.bank_name}|${row.transaction_ref}`
      inflowMap.set(key, (inflowMap.get(key) ?? 0) + 1)
    }
    const outflowMap = new Map<string, number>()
    for (const r of outflowRes.data) {
      const row = r as { transaction_id: string; bank_name: string }
      const key = `${row.bank_name}|${row.transaction_id}`
      outflowMap.set(key, (outflowMap.get(key) ?? 0) + 1)
    }

    const issues: ReconciliationIssue[] = []
    for (const [key, count] of inflowMap) {
      if (count > 1) {
        const [bank, ref] = key.split('|')
        issues.push({
          id: `duplicate_import-inflow-${key}`,
          ruleId: 'duplicate_import',
          severity: 'critical',
          message: `Inflow reference "${ref}" appears ${count} times on bank "${bank}"`,
          evidence: { ref, bank, count, table: 'inflow_transactions' },
          suggestedFix: 'Open Inflows page, filter by this reference number, and delete the duplicate entry.',
          bankName: bank,
        })
      }
    }
    for (const [key, count] of outflowMap) {
      if (count > 1) {
        const [bank, ref] = key.split('|')
        issues.push({
          id: `duplicate_import-outflow-${key}`,
          ruleId: 'duplicate_import',
          severity: 'critical',
          message: `Outflow reference "${ref}" appears ${count} times on bank "${bank}"`,
          evidence: { ref, bank, count, table: 'outflow_transactions' },
          suggestedFix: 'Open Outflows page, filter by this reference number, and delete the duplicate entry.',
          bankName: bank,
        })
      }
    }
    return issues
  },
}

// ── Rule 4: Pending deduction detection ───────────────────────────────────────
// Outflow transactions marked is_pending_deduction that are older than 30 days.

const pendingDeductionRule: ReconciliationRule = {
  id: 'pending_deduction',
  name: 'Stale Pending Deduction',
  description: 'Pending deductions older than 30 days that have not been cleared',
  async run(orgId) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const res = await allRows(
      supabase
        .from('outflow_transactions')
        .select('id, date, bank_name, amount_disbursed, description')
        .eq('org_id', orgId)
        .eq('is_pending_deduction', true)
        .lte('date', cutoffStr),
    )
    if (res.error) return []

    return res.data.map(t => {
      const r = t as { id: string; date: string; bank_name: string | null; amount_disbursed: number; description: string | null }
      return {
        id: `pending_deduction-${r.id}`,
        ruleId: 'pending_deduction',
        severity: 'warning' as const,
        message: `Pending deduction of ${r.amount_disbursed} on ${r.date} from "${r.bank_name ?? 'unknown bank'}" has been pending for over 30 days`,
        evidence: { transactionId: r.id, date: r.date, bank: r.bank_name, amount: r.amount_disbursed, description: r.description },
        suggestedFix: 'Open the Pending Deductions page, locate this transaction, and either clear it or mark it resolved.',
        bankName: r.bank_name ?? undefined,
        transactionId: r.id,
      }
    })
  },
}

// ── Rule 5: Expected vs imported balance mismatch ─────────────────────────────
// Compares computed book balance for each bank against a user-provided reference
// balance stored in bank_statement_balances. If no reference exists, flags as info.

const balanceMismatchRule: ReconciliationRule = {
  id: 'balance_mismatch',
  name: 'Balance Mismatch',
  description: 'Difference between computed book balance and the reference statement balance',
  async run(orgId) {
    const [banksRes, inflowRes, outflowRes, depositsRes, transfersRes, refRes] = await Promise.all([
      supabase.from('banks').select('id, name, starting_balance').eq('org_id', orgId),
      allRows(supabase
        .from('inflow_transactions')
        .select('bank_name, amount, transaction_type, offset_role')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('outflow_transactions')
        .select('bank_name, amount_disbursed, transaction_type, offset_role, is_pending_deduction')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('bank_deposits')
        .select('bank_name, amount')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('intrabank_transfers')
        .select('from_bank_name, to_bank_name, amount')
        .eq('org_id', orgId)),
      // bank_statement_balances may not exist — catch gracefully via empty data
      supabase
        .from('bank_statement_balances')
        .select('bank_name, reference_balance, statement_date')
        .eq('org_id', orgId)
        .order('statement_date', { ascending: false }),
    ])

    if (banksRes.error) return []

    const refMap = new Map<string, { balance: number; date: string }>()
    if (!refRes.error) {
      for (const r of refRes.data ?? []) {
        const row = r as { bank_name: string; reference_balance: number; statement_date: string }
        if (!refMap.has(row.bank_name)) refMap.set(row.bank_name, { balance: row.reference_balance, date: row.statement_date })
      }
    }

    const bookBalance = new Map<string, number>()
    for (const b of banksRes.data ?? []) {
      const bank = b as { name: string; starting_balance: number }
      bookBalance.set(bank.name, Number(bank.starting_balance ?? 0))
    }
    for (const t of inflowRes.data) {
      const r = t as { bank_name: string | null; amount: number; transaction_type: string | null; offset_role: string | null }
      if (!r.bank_name || r.offset_role === 'offset' || r.transaction_type === 'balance_brought_forward') continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) + Number(r.amount))
    }
    for (const t of outflowRes.data) {
      const r = t as { bank_name: string | null; amount_disbursed: number; offset_role: string | null; is_pending_deduction: boolean }
      if (!r.bank_name || r.offset_role === 'offset' || r.is_pending_deduction) continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) - Number(r.amount_disbursed))
    }
    for (const t of depositsRes.data) {
      const r = t as { bank_name: string | null; amount: number }
      if (!r.bank_name) continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) + Number(r.amount))
    }
    for (const t of transfersRes.data) {
      const r = t as { from_bank_name: string; to_bank_name: string; amount: number }
      bookBalance.set(r.from_bank_name, (bookBalance.get(r.from_bank_name) ?? 0) - Number(r.amount))
      bookBalance.set(r.to_bank_name, (bookBalance.get(r.to_bank_name) ?? 0) + Number(r.amount))
    }

    const issues: ReconciliationIssue[] = []
    for (const b of banksRes.data ?? []) {
      const bank = b as { name: string }
      const book = bookBalance.get(bank.name) ?? 0
      const ref  = refMap.get(bank.name)

      if (!ref) {
        issues.push({
          id: `balance_mismatch-noref-${bank.name}`,
          ruleId: 'balance_mismatch',
          severity: 'info',
          message: `No reference balance set for "${bank.name}" — cannot verify against bank statement`,
          evidence: { bank: bank.name, bookBalance: book },
          suggestedFix: 'Go to the Reconciliation Center and enter the closing balance from your latest bank statement for this account.',
          bankName: bank.name,
        })
        continue
      }

      const diff = book - ref.balance
      if (Math.abs(diff) > 0.01) {
        const severity = Math.abs(diff) > 10000 ? 'critical' : 'warning'
        issues.push({
          id: `balance_mismatch-${bank.name}`,
          ruleId: 'balance_mismatch',
          severity,
          message: `"${bank.name}" book balance (${book.toLocaleString()}) differs from statement reference (${ref.balance.toLocaleString()}) by ${diff > 0 ? '+' : ''}${diff.toLocaleString()}`,
          evidence: { bank: bank.name, bookBalance: book, referenceBalance: ref.balance, difference: diff, statementDate: ref.date },
          suggestedFix: diff > 0
            ? 'Book exceeds statement — check for unrecognised inflows, missing outflows, or duplicate imports.'
            : 'Statement exceeds book — check for missing inflows, unrecorded deposits, or pending deductions.',
          bankName: bank.name,
        })
      }
    }
    return issues
  },
}

// ── Rule 6: Category allocation inconsistency ──────────────────────────────────
// Locked percentage allocation configs whose percentage rows do not sum to 100%.

const allocationInconsistencyRule: ReconciliationRule = {
  id: 'allocation_inconsistency',
  name: 'Allocation Config Inconsistency',
  description: 'Locked percentage allocation configs whose rows do not sum to 100%',
  async run(orgId) {
    const res = await supabase
      .from('allocation_configs')
      .select('id, rows, allocation_type')
      .eq('org_id', orgId)
      .eq('status', 'locked')

    if (res.error) return []

    const issues: ReconciliationIssue[] = []
    for (const c of res.data ?? []) {
      const cfg = c as { id: string; rows: unknown; allocation_type: string | null }
      if (cfg.allocation_type === 'amount') continue

      const rows = Array.isArray(cfg.rows) ? (cfg.rows as Record<string, unknown>[]) : []
      const pctRows = rows.filter(r => !r.budget_portion || r.budget_portion === 'Percentage')
      const total = pctRows.reduce((sum, r) => sum + Number(r.percentage ?? 0), 0)

      if (Math.abs(total - 100) > 0.01 && total > 0) {
        issues.push({
          id: `allocation_inconsistency-${cfg.id}`,
          ruleId: 'allocation_inconsistency',
          severity: 'warning',
          message: `Allocation config rows sum to ${total.toFixed(2)}% instead of 100% — transactions using this config may be misallocated`,
          evidence: { configId: cfg.id, percentageTotal: total, rowCount: pctRows.length },
          suggestedFix: 'Open Allocation Configs, unlock this config, adjust the percentages to sum to 100%, then re-lock.',
        })
      }
    }
    return issues
  },
}

// ── Rule 7: Negative balance detection ────────────────────────────────────────
// Any bank whose computed book balance is negative.

const negativeBalanceRule: ReconciliationRule = {
  id: 'negative_balance',
  name: 'Negative Balance',
  description: 'Bank accounts with a negative computed book balance',
  async run(orgId) {
    const [banksRes, inflowRes, outflowRes, depositsRes, transfersRes] = await Promise.all([
      supabase.from('banks').select('name, starting_balance').eq('org_id', orgId),
      allRows(supabase
        .from('inflow_transactions')
        .select('bank_name, amount, transaction_type, offset_role')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('outflow_transactions')
        .select('bank_name, amount_disbursed, offset_role')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('bank_deposits')
        .select('bank_name, amount')
        .eq('org_id', orgId)),
      allRows(supabase
        .from('intrabank_transfers')
        .select('from_bank_name, to_bank_name, amount')
        .eq('org_id', orgId)),
    ])

    if (banksRes.error) return []

    const bookBalance = new Map<string, number>()
    for (const b of banksRes.data ?? []) {
      const bank = b as { name: string; starting_balance: number }
      bookBalance.set(bank.name, Number(bank.starting_balance ?? 0))
    }
    for (const t of inflowRes.data) {
      const r = t as { bank_name: string | null; amount: number; transaction_type: string | null; offset_role: string | null }
      if (!r.bank_name || r.offset_role === 'offset' || r.transaction_type === 'balance_brought_forward') continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) + Number(r.amount))
    }
    for (const t of outflowRes.data) {
      const r = t as { bank_name: string | null; amount_disbursed: number; offset_role: string | null }
      if (!r.bank_name || r.offset_role === 'offset') continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) - Number(r.amount_disbursed))
    }
    for (const t of depositsRes.data) {
      const r = t as { bank_name: string | null; amount: number }
      if (!r.bank_name) continue
      bookBalance.set(r.bank_name, (bookBalance.get(r.bank_name) ?? 0) + Number(r.amount))
    }
    for (const t of transfersRes.data) {
      const r = t as { from_bank_name: string; to_bank_name: string; amount: number }
      bookBalance.set(r.from_bank_name, (bookBalance.get(r.from_bank_name) ?? 0) - Number(r.amount))
      bookBalance.set(r.to_bank_name, (bookBalance.get(r.to_bank_name) ?? 0) + Number(r.amount))
    }

    const issues: ReconciliationIssue[] = []
    for (const [bankName, balance] of bookBalance) {
      if (balance < 0) {
        issues.push({
          id: `negative_balance-${bankName}`,
          ruleId: 'negative_balance',
          severity: 'critical',
          message: `"${bankName}" has a negative computed balance of ${balance.toLocaleString()} — more has been recorded as paid out than received`,
          evidence: { bank: bankName, computedBalance: balance },
          suggestedFix: 'Open the Bank Ledger for this account and review recent outflows. Check for missing inflows, incorrect amounts, or entries on the wrong account.',
          bankName,
        })
      }
    }
    return issues
  },
}

// ── Rule 8: Incomplete reversal detection ─────────────────────────────────────
// Reversals that lack an original_transaction_id — the reversal is unlinked.

const incompleteReversalRule: ReconciliationRule = {
  id: 'incomplete_reversal',
  name: 'Incomplete Reversal',
  description: 'Reversal transactions that are not linked to an original transaction',
  async run(orgId) {
    const [inflowRes, outflowRes] = await Promise.all([
      allRows(supabase
        .from('inflow_transactions')
        .select('id, date, bank_name, amount, original_transaction_id')
        .eq('org_id', orgId)
        .eq('transaction_type', 'reversal')),
      allRows(supabase
        .from('outflow_transactions')
        .select('id, date, bank_name, amount_disbursed, original_transaction_id')
        .eq('org_id', orgId)
        .eq('transaction_type', 'reversal')),
    ])

    const issues: ReconciliationIssue[] = []

    for (const t of inflowRes.data) {
      const r = t as { id: string; date: string; bank_name: string | null; amount: number; original_transaction_id: string | null }
      if (!r.original_transaction_id) {
        issues.push({
          id: `incomplete_reversal-inflow-${r.id}`,
          ruleId: 'incomplete_reversal',
          severity: 'warning',
          message: `Inflow reversal on ${r.date} for ${r.amount} on "${r.bank_name ?? 'unknown bank'}" has no linked original transaction`,
          evidence: { transactionId: r.id, date: r.date, bank: r.bank_name, amount: r.amount },
          suggestedFix: 'Open the Reversals page, edit this record, and link it to the original transaction it reverses.',
          bankName: r.bank_name ?? undefined,
          transactionId: r.id,
        })
      }
    }
    for (const t of outflowRes.data) {
      const r = t as { id: string; date: string; bank_name: string | null; amount_disbursed: number; original_transaction_id: string | null }
      if (!r.original_transaction_id) {
        issues.push({
          id: `incomplete_reversal-outflow-${r.id}`,
          ruleId: 'incomplete_reversal',
          severity: 'warning',
          message: `Outflow reversal on ${r.date} for ${r.amount_disbursed} on "${r.bank_name ?? 'unknown bank'}" has no linked original transaction`,
          evidence: { transactionId: r.id, date: r.date, bank: r.bank_name, amount: r.amount_disbursed },
          suggestedFix: 'Open the Reversals page, edit this record, and link it to the original transaction it reverses.',
          bankName: r.bank_name ?? undefined,
          transactionId: r.id,
        })
      }
    }
    return issues
  },
}

// ── Exported rule registry ─────────────────────────────────────────────────────

export const ALL_RULES: ReconciliationRule[] = [
  orphanTransferRule,
  missingTransferPairRule,
  duplicateImportRule,
  pendingDeductionRule,
  balanceMismatchRule,
  allocationInconsistencyRule,
  negativeBalanceRule,
  incompleteReversalRule,
]
