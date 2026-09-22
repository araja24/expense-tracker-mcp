import type { SupabaseClient } from '@supabase/supabase-js';

// ----------------------------------------------------------------- row shapes

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  expense_date: string;
  source: 'manual' | 'ai';
  notes: string | null;
  category_id: string | null;
  categories: Pick<Category, 'id' | 'name' | 'color'> | null;
}

export interface SummaryRow {
  category_id: string | null;
  category_name: string;
  category_color: string;
  total: number;
  expense_count: number;
}

export interface BudgetStatusRow {
  category_id: string | null;
  category_name: string;
  category_color: string;
  budget: number;
  spent: number;
  remaining: number;
  pct_used: number;
  exceeded: boolean;
}

export interface ExpenseFilters {
  categoryId?: string | null;
  categoryName?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

const EXPENSE_COLUMNS =
  'id, description, amount, expense_date, source, notes, category_id, categories ( id, name, color )';

/** supabase-js returns numeric columns as strings; money must come back as numbers. */
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
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
    categories: (row.categories as Expense['categories']) ?? null
  };
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

// ----------------------------------------------------------------- categories

export async function listCategories(db: SupabaseClient): Promise<Category[]> {
  const { data, error } = await db.from('categories').select('id, name, color, icon').order('name');
  fail('Could not load categories', error);
  return (data ?? []) as Category[];
}

export async function findCategoryByName(
  db: SupabaseClient,
  name: string
): Promise<Category | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  // ilike with no wildcards is an exact, case-insensitive match — the same
  // notion of "same category" the unique index in the schema enforces.
  const { data, error } = await db
    .from('categories')
    .select('id, name, color, icon')
    .ilike('name', trimmed)
    .maybeSingle();

  fail('Could not look up category', error);
  return (data as Category | null) ?? null;
}

/** Colors for auto-created categories, matching the app's category palette. */
const PALETTE = ['#2563EB', '#EC4899', '#F97316', '#8B5CF6', '#14B8A6', '#EAB308', '#06B6D4', '#EF4444'];

export async function createCategory(
  db: SupabaseClient,
  userId: string,
  name: string,
  color?: string,
  icon?: string
): Promise<Category> {
  const existing = await listCategories(db);
  const chosen = color ?? PALETTE[existing.length % PALETTE.length]!;

  const { data, error } = await db
    .from('categories')
    .insert({ user_id: userId, name: name.trim(), color: chosen, icon: icon ?? 'tag' })
    .select('id, name, color, icon')
    .single();

  fail('Could not create category', error);
  return data as Category;
}

/**
 * Resolve a free-text category name to a category, creating it if it is new.
 * This is what lets the assistant accept "I bought a plant" without the user
 * ever having to think about which bucket it belongs in.
 */
export async function resolveCategory(
  db: SupabaseClient,
  userId: string,
  name: string | undefined | null,
  { create = true }: { create?: boolean } = {}
): Promise<Category | null> {
  if (!name || !name.trim()) return null;
  const found = await findCategoryByName(db, name);
  if (found) return found;
  if (!create) return null;
  return createCategory(db, userId, name);
}

export async function renameCategory(
  db: SupabaseClient,
  id: string,
  name: string,
  color?: string
): Promise<Category> {
  const patch: Record<string, string> = { name: name.trim() };
  if (color) patch.color = color;

  const { data, error } = await db
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select('id, name, color, icon')
    .single();

  fail('Could not rename category', error);
  return data as Category;
}

/** Expenses survive: the FK is `on delete set null`, so they become Uncategorized. */
export async function deleteCategory(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('categories').delete().eq('id', id);
  fail('Could not delete category', error);
}

// ------------------------------------------------------------------- expenses

export interface ExpenseInput {
  description: string;
  amount: number;
  category?: string | null;
  date?: string | null;
  notes?: string | null;
}

export async function addExpense(
  db: SupabaseClient,
  userId: string,
  input: ExpenseInput,
  source: 'manual' | 'ai'
): Promise<Expense> {
  const category = await resolveCategory(db, userId, input.category);

  const { data, error } = await db
    .from('expenses')
    .insert({
      user_id: userId,
      description: input.description.trim(),
      amount: input.amount,
      category_id: category?.id ?? null,
      expense_date: input.date ?? new Date().toISOString().slice(0, 10),
      notes: input.notes ?? null,
      source
    })
    .select(EXPENSE_COLUMNS)
    .single();

  fail('Could not add expense', error);
  return normalizeExpense(data as Record<string, unknown>);
}

export async function addExpensesBulk(
  db: SupabaseClient,
  userId: string,
  inputs: ExpenseInput[],
  source: 'manual' | 'ai'
): Promise<Expense[]> {
  // Resolved one at a time on purpose: two items in the same message may name
  // the same new category, and the second must reuse what the first created.
  const rows = [];
  for (const input of inputs) {
    const category = await resolveCategory(db, userId, input.category);
    rows.push({
      user_id: userId,
      description: input.description.trim(),
      amount: input.amount,
      category_id: category?.id ?? null,
      expense_date: input.date ?? new Date().toISOString().slice(0, 10),
      notes: input.notes ?? null,
      source
    });
  }

  const { data, error } = await db.from('expenses').insert(rows).select(EXPENSE_COLUMNS);
  fail('Could not add expenses', error);
  return (data ?? []).map(row => normalizeExpense(row as Record<string, unknown>));
}

export async function updateExpense(
  db: SupabaseClient,
  userId: string,
  id: string,
  patch: Partial<ExpenseInput>
): Promise<Expense> {
  const update: Record<string, unknown> = {};

  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.amount !== undefined) update.amount = patch.amount;
  if (patch.date !== undefined && patch.date !== null) update.expense_date = patch.date;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.category !== undefined) {
    // An explicit null or empty string means "move to Uncategorized".
    const category = await resolveCategory(db, userId, patch.category);
    update.category_id = category?.id ?? null;
  }

  if (Object.keys(update).length === 0) {
    throw new Error('Nothing to update — pass at least one field to change.');
  }

  const { data, error } = await db
    .from('expenses')
    .update(update)
    .eq('id', id)
    .select(EXPENSE_COLUMNS)
    .maybeSingle();

  fail('Could not update expense', error);
  if (!data) throw new Error(`No expense with id ${id}`);
  return normalizeExpense(data as Record<string, unknown>);
}

export async function deleteExpense(db: SupabaseClient, id: string): Promise<Expense | null> {
  const { data, error } = await db
    .from('expenses')
    .delete()
    .eq('id', id)
    .select(EXPENSE_COLUMNS)
    .maybeSingle();

  fail('Could not delete expense', error);
  return data ? normalizeExpense(data as Record<string, unknown>) : null;
}

export async function listExpenses(
  db: SupabaseClient,
  filters: ExpenseFilters = {}
): Promise<{ expenses: Expense[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  let categoryId = filters.categoryId;
  if (categoryId === undefined && filters.categoryName) {
    const category = await findCategoryByName(db, filters.categoryName);
    if (!category) return { expenses: [], total: 0 };
    categoryId = category.id;
  }

  let queryBuilder = db.from('expenses').select(EXPENSE_COLUMNS, { count: 'exact' });

  if (categoryId === null) queryBuilder = queryBuilder.is('category_id', null);
  else if (categoryId) queryBuilder = queryBuilder.eq('category_id', categoryId);

  if (filters.from) queryBuilder = queryBuilder.gte('expense_date', filters.from);
  if (filters.to) queryBuilder = queryBuilder.lte('expense_date', filters.to);
  if (filters.minAmount !== undefined) queryBuilder = queryBuilder.gte('amount', filters.minAmount);
  if (filters.maxAmount !== undefined) queryBuilder = queryBuilder.lte('amount', filters.maxAmount);
  if (filters.search) {
    // Escape PostgREST's pattern metacharacters so a search for "100%" does
    // not turn into a wildcard.
    const escaped = filters.search.replace(/[%_\\]/g, m => `\\${m}`);
    queryBuilder = queryBuilder.ilike('description', `%${escaped}%`);
  }

  const { data, error, count } = await queryBuilder
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  fail('Could not list expenses', error);
  return {
    expenses: (data ?? []).map(row => normalizeExpense(row as Record<string, unknown>)),
    total: count ?? 0
  };
}

// ------------------------------------------------------------------ reporting

export async function summary(
  db: SupabaseClient,
  from?: string | null,
  to?: string | null
): Promise<{ total: number; byCategory: SummaryRow[] }> {
  const { data, error } = await db.rpc('expense_summary', {
    from_date: from ?? null,
    to_date: to ?? null
  });

  fail('Could not build summary', error);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(row => ({
    category_id: (row.category_id as string | null) ?? null,
    category_name: String(row.category_name),
    category_color: String(row.category_color),
    total: num(row.total),
    expense_count: num(row.expense_count)
  }));

  return { total: rows.reduce((sum, row) => sum + row.total, 0), byCategory: rows };
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export async function monthlySummary(
  db: SupabaseClient,
  year: number,
  month: number
): Promise<{ total: number; byCategory: SummaryRow[]; from: string; to: string }> {
  const { from, to } = monthBounds(year, month);
  const result = await summary(db, from, to);
  return { ...result, from, to };
}

export async function monthlyTotals(
  db: SupabaseClient,
  monthsBack = 6
): Promise<{ period: string; total: number }[]> {
  const { data, error } = await db.rpc('monthly_totals', { months_back: monthsBack });
  fail('Could not load monthly totals', error);
  return ((data ?? []) as Record<string, unknown>[]).map(row => ({
    period: String(row.period),
    total: num(row.total)
  }));
}

export async function budgetStatus(
  db: SupabaseClient,
  year?: number,
  month?: number
): Promise<BudgetStatusRow[]> {
  const { data, error } = await db.rpc('budget_status', {
    target_year: year ?? null,
    target_month: month ?? null
  });

  fail('Could not load budget status', error);
  return ((data ?? []) as Record<string, unknown>[]).map(row => ({
    category_id: (row.category_id as string | null) ?? null,
    category_name: String(row.category_name),
    category_color: String(row.category_color),
    budget: num(row.budget),
    spent: num(row.spent),
    remaining: num(row.remaining),
    pct_used: num(row.pct_used),
    exceeded: Boolean(row.exceeded)
  }));
}

export async function setBudget(
  db: SupabaseClient,
  userId: string,
  {
    amount,
    year,
    month,
    categoryId = null
  }: { amount: number; year: number; month: number; categoryId?: string | null }
): Promise<void> {
  // Upsert by hand: the uniqueness rule is split across two partial indexes
  // (overall vs. per-category), which `on conflict` cannot target directly.
  let existing = db
    .from('budgets')
    .select('id')
    .eq('year', year)
    .eq('month', month);

  existing = categoryId ? existing.eq('category_id', categoryId) : existing.is('category_id', null);

  const { data: found, error: findError } = await existing.maybeSingle();
  fail('Could not check existing budget', findError);

  if (found) {
    const { error } = await db.from('budgets').update({ amount }).eq('id', (found as { id: string }).id);
    fail('Could not update budget', error);
    return;
  }

  const { error } = await db
    .from('budgets')
    .insert({ user_id: userId, category_id: categoryId, year, month, amount });
  fail('Could not create budget', error);
}

export async function deleteBudget(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('budgets').delete().eq('id', id);
  fail('Could not delete budget', error);
}

export async function listBudgets(
  db: SupabaseClient,
  year: number,
  month: number
): Promise<{ id: string; category_id: string | null; amount: number }[]> {
  const { data, error } = await db
    .from('budgets')
    .select('id, category_id, amount')
    .eq('year', year)
    .eq('month', month);

  fail('Could not list budgets', error);
  return ((data ?? []) as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    category_id: (row.category_id as string | null) ?? null,
    amount: num(row.amount)
  }));
}

// ------------------------------------------------------------------- profile

export async function getProfile(
  db: SupabaseClient
): Promise<{ currency: string; display_name: string | null }> {
  const { data, error } = await db
    .from('profiles')
    .select('currency, display_name')
    .maybeSingle();

  fail('Could not load profile', error);
  return {
    currency: (data as { currency?: string } | null)?.currency ?? 'USD',
    display_name: (data as { display_name?: string | null } | null)?.display_name ?? null
  };
}
