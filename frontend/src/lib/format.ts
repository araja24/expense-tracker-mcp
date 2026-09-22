import { format, parseISO } from 'date-fns'

export function money(amount: number, currency = 'USD', options: Intl.NumberFormatOptions = {}) {
  /*
   * Intl throws a RangeError when maximumFractionDigits ends up below
   * minimumFractionDigits. A caller asking for whole pounds — money(x, cur,
   * { maximumFractionDigits: 0 }) — would otherwise collide with the 2 we
   * default to, so the floor follows the ceiling down.
   */
  const max = options.maximumFractionDigits
  const min = options.minimumFractionDigits ?? (max === undefined ? 2 : Math.min(2, max))

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: min,
    ...options,
  }).format(amount)
}

/**
 * Compact form for chart axis ticks: `$4k`, `$0`. Ticks are round numbers, so
 * cents are never wanted — and both bounds are set together because currency
 * styles default the minimum to the currency's own digits (2 for USD), which
 * a bare maximum of 0 would contradict.
 */
export function moneyShort(amount: number, currency = 'USD') {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

  // Intl yields "$4K"; the mockup's axis is lowercase.
  return formatted.replace(/([KMBT])$/, (suffix) => suffix.toLowerCase())
}

export function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

/** Dates from Postgres are plain YYYY-MM-DD — parse them as local, not UTC. */
export function shortDate(iso: string) {
  return format(parseISO(iso), 'MMM d')
}

export function longDate(iso: string) {
  return format(parseISO(iso), 'MMM d, yyyy')
}

export function monthLabel(year: number, month: number) {
  return format(new Date(year, month - 1, 1), 'MMMM yyyy')
}

export function todayIso() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function monthBounds(year: number, month: number) {
  return {
    from: format(new Date(year, month - 1, 1), 'yyyy-MM-dd'),
    to: format(new Date(year, month, 0), 'yyyy-MM-dd'),
  }
}

export function daysLeftInMonth(year: number, month: number) {
  const now = new Date()
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return 0
  return new Date(year, month, 0).getDate() - now.getDate()
}

export function initials(name: string | null | undefined, fallback: string) {
  const source = name?.trim() || fallback
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts.slice(0, 2).map((p) => p[0]).join('') || source[0] || '?').toUpperCase()
}
