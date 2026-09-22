import type { BudgetStatusRow, Expense, SummaryRow } from './expenses.js';

export function money(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
}

export function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export function expenseLine(expense: Expense, currency: string): string {
  const category = expense.categories?.name ?? 'Uncategorized';
  return `${expense.expense_date}  ${money(expense.amount, currency).padStart(11)}  ${category.padEnd(12)}  ${expense.description}`;
}

export function summaryText(
  rows: SummaryRow[],
  total: number,
  currency: string,
  heading: string
): string {
  if (rows.length === 0) return `${heading}\nNo expenses recorded.`;

  const lines = rows.map(row => {
    const share = total > 0 ? ((row.total / total) * 100).toFixed(1) : '0.0';
    return `  ${row.category_name.padEnd(14)} ${money(row.total, currency).padStart(11)}  ${share.padStart(5)}%  (${row.expense_count} ${row.expense_count === 1 ? 'expense' : 'expenses'})`;
  });

  return [`${heading}`, `Total: ${money(total, currency)}`, '', ...lines].join('\n');
}

export function budgetText(rows: BudgetStatusRow[], currency: string, heading: string): string {
  if (rows.length === 0) {
    return `${heading}\nNo budgets set for this month.`;
  }

  const lines = rows.map(row => {
    const state = row.exceeded
      ? `OVER by ${money(Math.abs(row.remaining), currency)}`
      : `${money(row.remaining, currency)} left`;
    return `  ${row.category_name.padEnd(14)} ${money(row.spent, currency).padStart(11)} of ${money(row.budget, currency).padStart(11)}  ${String(row.pct_used).padStart(5)}%  ${state}`;
  });

  const over = rows.filter(row => row.exceeded);
  const warning =
    over.length > 0
      ? `\n\n⚠ Over budget: ${over.map(row => row.category_name).join(', ')}.`
      : '';

  return `${heading}\n\n${lines.join('\n')}${warning}`;
}

/** RFC 4180 quoting, so descriptions with commas, quotes or newlines survive. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function expensesToCsv(expenses: Expense[]): string {
  const header = ['Date', 'Description', 'Category', 'Amount', 'Source', 'Notes'];
  const rows = expenses.map(expense => [
    expense.expense_date,
    expense.description,
    expense.categories?.name ?? 'Uncategorized',
    expense.amount.toFixed(2),
    expense.source,
    expense.notes ?? ''
  ]);

  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
