export interface GlossaryTerm {
  term:       string
  definition: string
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term:       'Inflow',
    definition: 'Money received by the church — tithes, offerings, donations, grants, or any income. Also called a credit or receipt.',
  },
  {
    term:       'Outflow',
    definition: 'Money paid out by the church — salaries, utilities, maintenance, ministry expenses. Also called a debit or expenditure.',
  },
  {
    term:       'Bank Ledger',
    definition: 'A running record of every transaction (in and out) for a specific bank account, like a bank statement you can filter and search.',
  },
  {
    term:       'Allocation',
    definition: 'How an inflow is divided across departments or budget lines. For example, 60% to General Fund, 30% to Missions, 10% to Youth.',
  },
  {
    term:       'Percentage Allocation',
    definition: 'A preset rule that automatically splits incoming funds across departments by percentage. Set it once and every qualifying inflow follows that split.',
  },
  {
    term:       'Specific Giving',
    definition: 'A donation earmarked for one particular purpose (e.g. "Building Fund"). The money is restricted and should only be spent on that purpose.',
  },
  {
    term:       'Savings Portion',
    definition: 'A portion of income set aside as savings or a reserve fund. It shows on the allocation as a deduction before operating expenses.',
  },
  {
    term:       'IntraFlow',
    definition: 'A transfer of funds between two bank accounts within the same organisation — not income or expense, just a movement of money.',
  },
  {
    term:       'Bank Deposit',
    definition: 'Cash physically deposited into a bank account. Records the deposit date, amount, and which bank received it.',
  },
  {
    term:       'Category Ledger',
    definition: 'A view of all spending grouped by outflow category (e.g. Utilities, Salaries) so you can see where money is going.',
  },
  {
    term:       'Pending Deduction',
    definition: 'An approved expense that has not yet been paid. It is recorded to reserve funds and will be cleared when the payment is made.',
  },
  {
    term:       'FX Conversion',
    definition: 'Exchanging foreign currency (e.g. USD) into the base currency (NGN). Records the exchange rate, amounts, and associated bank accounts.',
  },
  {
    term:       'Refund',
    definition: 'Money returned — either income given back to a donor, or an overpaid expense reimbursed to the church. Tagged on the original transaction.',
  },
  {
    term:       'Reversal',
    definition: 'Correcting a transaction that was entered in error by cancelling it out with an equal and opposite entry. Different from a refund — it is an accounting fix, not a real cash movement.',
  },
  {
    term:       'Audit Log',
    definition: 'An automatic record of every change made to financial data — who changed it, what it was before, and what it became. Cannot be edited or deleted.',
  },
  {
    term:       'Budget',
    definition: 'A planned spending target for a category or department over a period. The system compares actual outflows against the budget to show variance.',
  },
  {
    term:       'Reconciliation',
    definition: 'Matching the church\'s internal records against the bank statement to confirm they agree. Any differences are investigated and corrected.',
  },
  {
    term:       'Department',
    definition: 'An organisational unit that receives and spends funds (e.g. Worship, Youth, Administration). Allocations and reports can be filtered by department.',
  },
]
