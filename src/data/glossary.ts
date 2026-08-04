export interface GlossaryTerm {
  term:       string
  definition: string
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term:       'Inflow',
    definition: 'Money received by the organisation — tithes, offerings, donations, grants, or any income. Also called a credit or receipt.',
  },
  {
    term:       'Outflow',
    definition: 'Money paid out by the organisation — salaries, utilities, maintenance, ministry expenses. Also called a debit or expenditure.',
  },
  {
    term:       'Bank Ledger',
    definition: 'A running record of every transaction (in and out) for a specific bank account, like a bank statement you can filter and search.',
  },
  {
    term:       'Distribution Rule',
    definition: 'A preset rule that divides incoming funds across Regular Funds, Designated Gifts, and Savings. For example, 60% to Regular Funds, 30% to a project, 10% to Savings.',
  },
  {
    term:       'Regular Funds',
    definition: 'The account that holds the percentage-based share of regular income. Funds arrive here through your Distribution Rules and cover everyday operations.',
  },
  {
    term:       'Designated Gifts',
    definition: 'A donation earmarked for one particular purpose (e.g. "Building Fund"). The money is restricted and should only be spent on that purpose.',
  },
  {
    term:       'Savings Funds',
    definition: 'A portion of income set aside as savings or a reserve fund. It is deducted by your Distribution Rules before operating expenses.',
  },
  {
    term:       'Category Fund Transfer',
    definition: 'A transfer of funds between two bank accounts within the same organisation — not income or expense, just a movement of money.',
  },
  {
    term:       'Bank Deposit',
    definition: 'Cash physically deposited into a bank account. Records the deposit date, amount, and which bank received it.',
  },
  {
    term:       'Fund Accounts',
    definition: 'A view of all spending grouped by outflow fund (e.g. Utilities, Salaries) so you can see where money is going.',
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
    definition: 'Money returned — either income given back to a donor, or an overpaid expense reimbursed to the organisation. Tagged on the original transaction.',
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
    definition: 'A planned spending target for a fund or department over a period. The system compares actual outflows against the budget to show variance.',
  },
  {
    term:       'Reconciliation',
    definition: 'Matching the organisation\'s internal records against the bank statement to confirm they agree. Any differences are investigated and corrected.',
  },
  {
    term:       'Department',
    definition: 'An organisational unit that receives and spends funds (e.g. Worship, Youth, Administration). Allocations and reports can be filtered by department.',
  },
]
