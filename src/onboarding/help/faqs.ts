import type { FAQEntry } from '../../types/onboarding'

export const FAQS: FAQEntry[] = [
  {
    id: 'faq-add-transactions',
    question: 'How do I add transactions?',
    answer:
      'Transactions are added by importing bank statements via the **Import** page. The system parses the file and creates inflow or outflow records automatically. There is no manual transaction entry — this ensures accuracy and avoids duplicate entries.',
    category: 'transactions',
    tags: ['transactions', 'import', 'add'],
  },
  {
    id: 'faq-bank-name-null',
    question: 'Why are some transactions missing from the Bank Ledger?',
    answer:
      'The Bank Ledger only shows transactions that have a bank account name set. If a transaction was imported before the corresponding bank account was created, its `bank_name` field may be blank. Edit the transaction in Inflows or Outflows to assign the correct bank, then it will appear in the ledger.',
    category: 'banks',
    tags: ['bank', 'ledger', 'missing'],
  },
  {
    id: 'faq-duplicate-detection',
    question: 'How does duplicate detection work?',
    answer:
      'During import, the system compares each incoming row against existing transactions using a combination of date, description, and amount. Rows that closely match an existing record are flagged as potential duplicates. You can review and de-select them before confirming the import.',
    category: 'import',
    tags: ['import', 'duplicate', 'detection'],
  },
  {
    id: 'faq-change-role',
    question: 'How do I change a team member\'s role?',
    answer:
      'Go to **Team Members**, find the member, click the three-dot menu next to their name, and select **Change Role**. Only Owners and Admins can change roles. Owners can promote members to Owner; Admins cannot.',
    category: 'team',
    tags: ['roles', 'team', 'permissions'],
  },
  {
    id: 'faq-multi-currency',
    question: 'Can I track transactions in multiple currencies?',
    answer:
      'Yes. Each bank account can have its own currency. The system tracks FX rates and converts foreign currency balances to your organisation\'s base currency for reporting. Use the **Foreign Currency** page to record holdings and update exchange rates.',
    category: 'banks',
    tags: ['currency', 'fx', 'multi-currency'],
  },
  {
    id: 'faq-percentage-allocation',
    question: 'What are distribution rules?',
    answer:
      'Distribution rules automatically split inflow amounts across categories or departments. For example, you can configure 10% of all tithes to go to the building fund and 90% to general operations. Configure this on the **Distribution Rules** page.',
    category: 'transactions',
    tags: ['allocation', 'percentage', 'split'],
  },
  {
    id: 'faq-export-report',
    question: 'How do I export a financial report?',
    answer:
      'Open the **Reports** page, set your desired date range and template, then click the **Export** button in the toolbar. You can export to Excel (.xlsx) or PDF.',
    category: 'reports',
    tags: ['report', 'export', 'excel', 'pdf'],
  },
  {
    id: 'faq-dark-mode',
    question: 'How do I switch to dark mode?',
    answer:
      'Go to **Settings** and toggle the appearance switch under the Appearance section. Your preference is saved per device.',
    category: 'settings',
    tags: ['dark mode', 'appearance', 'theme'],
  },
  {
    id: 'faq-invite-member',
    question: 'How do I invite a new team member?',
    answer:
      'Navigate to **Team Members** (Admin or Owner role required) and click **Invite Member**. Enter the person\'s email address, choose their role, and send the invitation. They\'ll receive an email with a secure link to create their account.',
    category: 'team',
    tags: ['invite', 'team', 'member'],
  },
  {
    id: 'faq-categories-vs-departments',
    question: 'What is the difference between categories and departments?',
    answer:
      'Categories (income types / outflow types) classify *what* a transaction is — e.g. Tithes, Salaries. Departments classify *who* the transaction belongs to — e.g. Youth Ministry, Administration. A single transaction can have both a category and a department.',
    category: 'categories',
    tags: ['categories', 'departments', 'classification'],
  },
]
