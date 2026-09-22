export interface Category {
  id: string
  name: string
  color: string
  icon: string
}

export interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
  /** 'ai' means it was logged through the assistant over MCP. */
  source: 'manual' | 'ai'
  notes: string | null
  category_id: string | null
  categories: Pick<Category, 'id' | 'name' | 'color' | 'icon'> | null
}

export interface SummaryRow {
  category_id: string | null
  category_name: string
  category_color: string
  total: number
  expense_count: number
}

export interface BudgetStatusRow {
  category_id: string | null
  category_name: string
  category_color: string
  budget: number
  spent: number
  remaining: number
  pct_used: number
  exceeded: boolean
}

export interface Budget {
  id: string
  category_id: string | null
  year: number
  month: number
  amount: number
}

export interface Profile {
  user_id: string
  display_name: string | null
  currency: string
  month_start_day: number
}

export interface ExpenseFilters {
  categoryId?: string | null
  from?: string
  to?: string
  minAmount?: number
  maxAmount?: number
  search?: string
}

export interface McpConnection {
  client_id: string
  client_name: string
  scope: string
  connected_at: string
  last_used_at: string | null
}
