import type { TourDefinition } from '../../types/onboarding'

export const importTour: TourDefinition = {
  id: 'importTour',
  pageId: 'import',
  title: 'Statement Import Tour',
  description: 'Learn how to upload and process bank statements.',
  steps: [
    {
      id: 'import-header',
      target: '[data-tour="page-header"]',
      title: 'Statement Import',
      content:
        'This is the sole entry point for transactions. Upload a bank statement (Excel or CSV) and the system will parse and import all transactions automatically.',
      placement: 'bottom',
    },
    {
      id: 'import-upload',
      target: '[data-tour="upload-zone"]',
      title: 'Upload Your File',
      content:
        'Drag and drop your bank statement here, or click to browse. Excel (.xlsx) and CSV formats are supported.',
      placement: 'bottom',
    },
    {
      id: 'import-column-map',
      target: '[data-tour="column-mapper"]',
      title: 'Map Columns',
      content:
        'After upload, match the file\'s columns (date, description, amount, etc.) to the expected fields. The system remembers your mappings for future imports from the same bank.',
      placement: 'top',
    },
    {
      id: 'import-duplicates',
      target: '[data-tour="duplicate-check"]',
      title: 'Duplicate Detection',
      content:
        'Before finalising, the system highlights any rows that look like duplicates of existing records. Review and de-select them to avoid double-counting.',
      placement: 'top',
    },
    {
      id: 'import-confirm',
      target: '[data-tour="import-confirm"]',
      title: 'Confirm Import',
      content:
        'Click Confirm to save all selected transactions. They\'ll immediately appear in the Inflows and Outflows pages.',
      placement: 'top',
    },
  ],
}
