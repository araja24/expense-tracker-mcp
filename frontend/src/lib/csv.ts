import type { Expense } from './types'

/** RFC 4180 quoting, so descriptions with commas or quotes survive Excel. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function expensesToCsv(expenses: Expense[]): string {
  const header = ['Date', 'Description', 'Category', 'Amount', 'Source', 'Notes']
  const rows = expenses.map((expense) => [
    expense.expense_date,
    expense.description,
    expense.categories?.name ?? 'Uncategorized',
    expense.amount.toFixed(2),
    expense.source,
    expense.notes ?? '',
  ])

  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, csv: string) {
  // The BOM is what makes Excel read the file as UTF-8 rather than ANSI.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
