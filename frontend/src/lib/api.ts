import { supabase } from './supabase'
import type {
  Budget,
  BudgetStatusRow,
  Category,
  Expense,
  ExpenseFilters,
  McpConnection,
  SummaryRow,
} from './types'

/**
 * Every call here goes straight to Supabase under RLS. The MCP server runs the
 * same operations against the same schema, so behaviour cannot drift between
 * "added it myself" and "told the assistant".
 */

const EXPENSE_COLUMNS =
  'id, description, amount, expense_date, source, notes, category_id, categories ( id, name, color, icon )'

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function unwrap<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`)
  return data as T
}

function normalizeExpense(row: Record<string, unknown>): Expense {
  return {
    id: String(row.id),
    description: String(row.description),
    amount: num(row.amount),
    expense_date: String(row.expense_date),
    source: row.source === 'ai' ? 'ai' : 'manual',
    notes: (row.notes as string | null) ?? null,
    category_id: (row.category_id as string | null) ?? null,
    categories: (row.categories as Expense['categories']) ?? null,
  }
}

// ---------------------------------------------------------------- categories

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, color, icon')
    .order('name')
  return unwrap(data, error, 'Could not load categories') as Category[]
}

export async function createCategory(input: {
  name: string
  color: string
  icon?: string
}): Promise<Category> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: auth.user.id,
      name: input.name.trim(),
      color: input.color,
      icon: input.icon ?? 'tag',
    })
    .select('id, name, color, icon')
    .single()

  return unwrap(data, error, 'Could not create category') as Category
}

export async function updateCategory(
  id: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const { error } = await supabase.from('categories').update(patch).eq('id', id)
  unwrap(null, error, 'Could not update category')
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  unwrap(null, error, 'Could not delete category')
}

/** Expense counts per category, for the Settings list. */
export async function fetchCategoryCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('expenses').select('category_id')
  const rows = unwrap(data, error, 'Could not count expenses') as { category_id: string | null }[]

  const counts: Record<string, number> = {}
  for (const row of rows) {
    const key = row.category_id ?? 'uncategorized'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

// ------------------------------------------------------------------ expenses

/**
 * Structurally typed over the query builder rather than importing PostgREST's
 * generics: every method below returns the same builder, which is all this
 * needs to know, and it keeps one filter implementation for the table and the
 * export.
 */
interface FilterableQuery {
  is(column: string, value: null): this
  eq(column: string, value: string): this
  gte(column: string, value: string | number): this
  lte(column: string, value: string | number): this
  ilike(column: string, value: string): this
}

function applyFilters<T extends FilterableQuery>(query: T, filters: ExpenseFilters): T {
  let q = query
  if (filters.categoryId === null) q = q.is('category_id', null)
  else if (filters.categoryId) q = q.eq('category_id', filters.categoryId)
  if (filters.from) q = q.gte('expense_date', filters.from)
  if (filters.to) q = q.lte('expense_date', filters.to)
  if (filters.minAmount !== undefined) q = q.gte('amount', filters.minAmount)
  if (filters.maxAmount !== undefined) q = q.lte('amount', filters.maxAmount)
  if (filters.search) {
    // Escape PostgREST pattern metacharacters so "100%" is not a wildcard.
    const escaped = filters.search.replace(/[%_\\]/g, (m) => `\\${m}`)
    q = q.ilike('description', `%${escaped}%`)
  }
  return q
}

export async function fetchExpenses(
  filters: ExpenseFilters = {},
  page = { limit: 10, offset: 0 },
): Promise<{ expenses: Expense[]; total: number }> {
  const base = supabase.from('expenses').select(EXPENSE_COLUMNS, { count: 'exact' })
  const { data, error, count } = await applyFilters(base, filters)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1)

  if (error) throw new Error(`Could not load expenses: ${error.message}`)
  return {
    expenses: (data ?? []).map((row) => normalizeExpense(row as Record<string, unknown>)),
    total: count ?? 0,
  }
}

/** Unpaginated, for CSV export — respects the same filters as the table. */
export async function fetchAllExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  const base = supabase.from('expenses').select(EXPENSE_COLUMNS)
  const { data, error } = await applyFilters(base, filters).order('expense_date', {
    ascending: false,
  })

  if (error) throw new Error(`Could not export expenses: ${error.message}`)
  return (data ?? []).map((row) => normalizeExpense(row as Record<string, unknown>))
}

export interface ExpenseInput {
  description: string
  amount: number
  category_id: string | null
  expense_date: string
  notes?: string | null
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...input, user_id: auth.user.id, source: 'manual' })
    .select(EXPENSE_COLUMNS)
    .single()

  if (error) throw new Error(`Could not add expense: ${error.message}`)
  return normalizeExpense(data as Record<string, unknown>)
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>): Promise<void> {
  const { error } = await supabase.from('expenses').update(patch).eq('id', id)
  unwrap(null, error, 'Could not update expense')
}

export async function deleteExpenses(ids: string[]): Promise<void> {
  const { error } = await supabase.from('expenses').delete().in('id', ids)
  unwrap(null, error, 'Could not delete expenses')
}

export async function recategorizeExpenses(
  ids: string[],
  categoryId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({ category_id: categoryId })
    .in('id', ids)
  unwrap(null, error, 'Could not change category')
}

// ----------------------------------------------------------------- reporting

export async function fetchSummary(
  from?: string,
  to?: string,
): Promise<{ total: number; byCategory: SummaryRow[] }> {
  const { data, error } = await supabase.rpc('expense_summary', {
    from_date: from ?? null,
    to_date: to ?? null,
  })

  const rows = (unwrap(data, error, 'Could not build summary') ?? []) as Record<string, unknown>[]
  const byCategory: SummaryRow[] = rows.map((row) => ({
    category_id: (row.category_id as string | null) ?? null,
    category_name: String(row.category_name),
    category_color: String(row.category_color),
    total: num(row.total),
    expense_count: num(row.expense_count),
  }))

  return { total: byCategory.reduce((sum, row) => sum + row.total, 0), byCategory }
}

export async function fetchMonthlyTotals(
  monthsBack = 6,
): Promise<{ period: string; total: number }[]> {
  const { data, error } = await supabase.rpc('monthly_totals', { months_back: monthsBack })
  const rows = (unwrap(data, error, 'Could not load monthly totals') ?? []) as Record<
    string,
    unknown
  >[]
  return rows.map((row) => ({ period: String(row.period), total: num(row.total) }))
}

export async function fetchBudgetStatus(
  year?: number,
  month?: number,
): Promise<BudgetStatusRow[]> {
  const { data, error } = await supabase.rpc('budget_status', {
    target_year: year ?? null,
    target_month: month ?? null,
  })

  const rows = (unwrap(data, error, 'Could not load budgets') ?? []) as Record<string, unknown>[]
  return rows.map((row) => ({
    category_id: (row.category_id as string | null) ?? null,
    category_name: String(row.category_name),
    category_color: String(row.category_color),
    budget: num(row.budget),
    spent: num(row.spent),
    remaining: num(row.remaining),
    pct_used: num(row.pct_used),
    exceeded: Boolean(row.exceeded),
  }))
}

// ------------------------------------------------------------------- budgets

export async function fetchBudgets(year: number, month: number): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('budgets')
    .select('id, category_id, year, month, amount')
    .eq('year', year)
    .eq('month', month)

  const rows = (unwrap(data, error, 'Could not load budgets') ?? []) as Record<string, unknown>[]
  return rows.map((row) => ({
    id: String(row.id),
    category_id: (row.category_id as string | null) ?? null,
    year: num(row.year),
    month: num(row.month),
    amount: num(row.amount),
  }))
}

export async function setBudget(input: {
  amount: number
  year: number
  month: number
  categoryId: string | null
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in')

  // Upserted by hand: uniqueness is split across two partial indexes (overall
  // vs. per-category), which `on conflict` cannot target directly.
  let lookup = supabase
    .from('budgets')
    .select('id')
    .eq('year', input.year)
    .eq('month', input.month)

  lookup = input.categoryId
    ? lookup.eq('category_id', input.categoryId)
    : lookup.is('category_id', null)

  const { data: existing, error: findError } = await lookup.maybeSingle()
  unwrap(null, findError, 'Could not check existing budget')

  if (existing) {
    const { error } = await supabase
      .from('budgets')
      .update({ amount: input.amount })
      .eq('id', (existing as { id: string }).id)
    unwrap(null, error, 'Could not update budget')
    return
  }

  const { error } = await supabase.from('budgets').insert({
    user_id: auth.user.id,
    category_id: input.categoryId,
    year: input.year,
    month: input.month,
    amount: input.amount,
  })
  unwrap(null, error, 'Could not create budget')
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  unwrap(null, error, 'Could not delete budget')
}

// ------------------------------------------------------------------- profile

export async function updateProfile(patch: {
  display_name?: string
  currency?: string
  month_start_day?: number
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in')

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: auth.user.id, ...patch }, { onConflict: 'user_id' })
  unwrap(null, error, 'Could not save settings')
}

// ----------------------------------------------------------- mcp connections

/**
 * Reads the grants the MCP server holds for this user. Returns null when the
 * backing functions are not installed yet (migration 0004), so the settings
 * panel can say so instead of showing a misleading "no clients connected".
 */
export async function fetchMcpConnections(): Promise<McpConnection[] | null> {
  const { data, error } = await supabase.rpc('list_mcp_connections')

  if (error) {
    // PGRST202: the function does not exist in the schema cache.
    if (error.code === 'PGRST202' || /list_mcp_connections/.test(error.message)) return null
    throw new Error(`Could not load connected clients: ${error.message}`)
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    client_id: String(row.client_id),
    client_name: String(row.client_name),
    scope: String(row.scope ?? ''),
    connected_at: String(row.connected_at),
    last_used_at: (row.last_used_at as string | null) ?? null,
  }))
}

export async function revokeMcpConnection(clientId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_mcp_connection', {
    target_client_id: clientId,
  })
  unwrap(null, error, 'Could not disconnect that client')
}
