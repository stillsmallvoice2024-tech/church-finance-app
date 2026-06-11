export interface TimezoneOption {
  value: string
  label: string
  offset: string
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'UTC',                    label: 'UTC',                          offset: '+00:00' },
  { value: 'Africa/Lagos',           label: 'Lagos / Abuja (WAT)',          offset: '+01:00' },
  { value: 'Africa/Accra',           label: 'Accra / Lomé (GMT)',           offset: '+00:00' },
  { value: 'Africa/Nairobi',         label: 'Nairobi (EAT)',                offset: '+03:00' },
  { value: 'Africa/Johannesburg',    label: 'Johannesburg (SAST)',          offset: '+02:00' },
  { value: 'Africa/Cairo',           label: 'Cairo (EET)',                  offset: '+02:00' },
  { value: 'Africa/Addis_Ababa',     label: 'Addis Ababa (EAT)',            offset: '+03:00' },
  { value: 'Africa/Douala',          label: 'Douala / Yaoundé (WAT)',       offset: '+01:00' },
  { value: 'Africa/Dakar',           label: 'Dakar (GMT)',                  offset: '+00:00' },
  { value: 'Africa/Abidjan',         label: 'Abidjan (GMT)',                offset: '+00:00' },
  { value: 'Europe/London',          label: 'London (GMT/BST)',             offset: '+00:00' },
  { value: 'Europe/Paris',           label: 'Paris / Berlin (CET)',         offset: '+01:00' },
  { value: 'Europe/Moscow',          label: 'Moscow (MSK)',                 offset: '+03:00' },
  { value: 'America/New_York',       label: 'New York (ET)',                offset: '-05:00' },
  { value: 'America/Chicago',        label: 'Chicago (CT)',                 offset: '-06:00' },
  { value: 'America/Los_Angeles',    label: 'Los Angeles (PT)',             offset: '-08:00' },
  { value: 'America/Sao_Paulo',      label: 'São Paulo (BRT)',              offset: '-03:00' },
  { value: 'America/Mexico_City',    label: 'Mexico City (CST)',            offset: '-06:00' },
  { value: 'Asia/Dubai',             label: 'Dubai (GST)',                  offset: '+04:00' },
  { value: 'Asia/Kolkata',           label: 'Kolkata / Mumbai (IST)',       offset: '+05:30' },
  { value: 'Asia/Shanghai',          label: 'Shanghai / Beijing (CST)',     offset: '+08:00' },
  { value: 'Asia/Tokyo',             label: 'Tokyo (JST)',                  offset: '+09:00' },
  { value: 'Asia/Singapore',         label: 'Singapore (SGT)',              offset: '+08:00' },
  { value: 'Asia/Hong_Kong',         label: 'Hong Kong (HKT)',              offset: '+08:00' },
  { value: 'Australia/Sydney',       label: 'Sydney (AEST)',                offset: '+10:00' },
  { value: 'Pacific/Auckland',       label: 'Auckland (NZST)',              offset: '+12:00' },
]

// Default timezone per currency code (best-guess home region)
export const CURRENCY_TIMEZONE: Record<string, string> = {
  NGN: 'Africa/Lagos',
  GHS: 'Africa/Accra',
  KES: 'Africa/Nairobi',
  UGX: 'Africa/Nairobi',
  TZS: 'Africa/Nairobi',
  ZAR: 'Africa/Johannesburg',
  EGP: 'Africa/Cairo',
  XOF: 'Africa/Dakar',
  XAF: 'Africa/Douala',
  GBP: 'Europe/London',
  EUR: 'Europe/Paris',
  USD: 'America/New_York',
  CAD: 'America/New_York',
  BRL: 'America/Sao_Paulo',
  MXN: 'America/Mexico_City',
  AED: 'Asia/Dubai',
  INR: 'Asia/Kolkata',
  CNY: 'Asia/Shanghai',
  JPY: 'Asia/Tokyo',
  SGD: 'Asia/Singapore',
  HKD: 'Asia/Hong_Kong',
  AUD: 'Australia/Sydney',
  NZD: 'Pacific/Auckland',
  CHF: 'Europe/Paris',
  SEK: 'Europe/Paris',
  NOK: 'Europe/Paris',
  DKK: 'Europe/Paris',
}

/** Returns the stored org timezone, falling back to the currency-based default, then UTC. */
export function getOrgTimezone(storedTimezone: string | null, currencyCode: string | null): string {
  if (storedTimezone) return storedTimezone
  if (currencyCode && CURRENCY_TIMEZONE[currencyCode]) return CURRENCY_TIMEZONE[currencyCode]
  return 'UTC'
}
