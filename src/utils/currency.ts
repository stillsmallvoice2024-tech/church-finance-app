/** Format a number or numeric string with thousand-separator commas. */
export function formatCurrency(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return ''
  const raw = String(value).replace(/[^0-9.]/g, '')
  if (raw === '' || raw === '.') return raw
  const [integer, decimal] = raw.split('.')
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decimal !== undefined ? `${formatted}.${decimal}` : formatted
}

/** Strip commas from a currency display string and return a plain numeric string. */
export function stripCurrencyFormat(value: string): string {
  return value.replace(/,/g, '')
}

/** Parse a formatted currency string into a number, or undefined if empty/invalid. */
export function parseCurrency(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const stripped = value.replace(/,/g, '')
  const num = parseFloat(stripped)
  return isNaN(num) ? undefined : num
}
