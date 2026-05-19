/**
 * Downloads rows as a UTF-8 CSV file.
 *
 * @param filename  e.g. "inflows-2024-12-01.csv"
 * @param headers   Column labels in order
 * @param rows      2-D array of cell values (same order as headers)
 */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: unknown[][],
): void {
  const escape = (v: unknown): string =>
    `"${String(v ?? '').replace(/"/g, '""')}"`

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ]

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
