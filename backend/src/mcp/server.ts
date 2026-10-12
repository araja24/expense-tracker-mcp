import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';

import { userClient, userId as userIdOf } from '../lib/supabase.js';
import * as data from '../lib/expenses.js';
import { parseBankCsv } from '../lib/bank-csv.js';
import * as batches from './import-batches.js';
import { budgetText, expenseLine, expensesToCsv, money, monthName, summaryText } from '../lib/format.js';

/**
 * Every tool call runs as the authenticated user through RLS, so the tools
 * here are deliberately thin: they validate input, call the same data layer
 * the app's rules are written against, and render a result the assistant can
 * read back to the user.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Date in YYYY-MM-DD format');

const amount = z
  .number()
  .positive('Amount must be greater than zero')
  .max(99_999_999, 'Amount is implausibly large');

const expenseShape = {
  description: z.string().min(1).max(200).describe('What was bought, e.g. "Blue Bottle coffee"'),
  amount: amount.describe('Amount spent, in the account currency'),
  category: z
    .string()
    .max(60)
    .optional()
    .describe(
      'Category name. Matched case-insensitively against existing categories and created if new. Omit if unsure — the expense lands in Uncategorized.'
    ),
  date: isoDate.optional().describe('Defaults to today'),
  notes: z.string().max(500).optional().describe('Optional free-text note')
};

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function failure(body: string) {
  return { content: [{ type: 'text' as const, text: body }], isError: true };
}

/** Tool bodies throw plain Errors; the client wants them as tool results. */
async function guard(run: () => Promise<{ content: { type: 'text'; text: string }[] }>) {
  try {
    return await run();
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : String(cause));
  }
}

function today(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// ------------------------------------------------------------ statement import

/**
 * How the assistant should categorize an imported statement. Fixed here rather
 * than left to the model's taste, so every import files things the same way —
 * and only into categories the user already has.
 */
const IMPORT_GUIDELINES = [
  'How to categorize:',
  '- Use ONLY the user\'s existing categories listed above, or null for Uncategorized. Never invent a name; if the user wants a new bucket (e.g. Donations, Subscriptions), they create it in Tally first.',
  '- Go by what was most likely bought, not the merchant\'s industry: restaurants, cafés and takeout → dining; supermarkets → groceries; transit, rideshare, bike share, fuel and car insurance → transport; phone and internet → utilities; retail and online stores → shopping.',
  '- Multi-purpose merchants (Amazon, Walmart, pharmacies, convenience stores) go to Uncategorized unless the amounts make it clear. Use list_batch_rows to split one with overrides if the user tells you how.',
  '- Transfers to people, ATM withdrawals, tuition and other large one-offs may not be spending: ask whether to include them, in one combined question. Leave them out if the user does not say.',
  '- Before importing, show the user the plan in a few lines (merchant → category, totals) and wait for a yes.'
].join('\n');

type StagedRow = batches.Batch['rows'][number];

function rowLine(key: string, row: StagedRow, currency: string): string {
  return `  ${key.padEnd(5)} ${row.date}  ${money(row.amount, currency).padStart(11)}  ${row.merchant}${row.notes ? ` (${row.notes})` : ''}`;
}

const SKIP_LABELS: Record<string, string> = {
  credit: 'credits/income',
  reversed: 'reversed or refunded',
  'fee-netted': 'bank fees cancelled by their discount',
  unreadable: 'unreadable (probably cut off — re-send those lines)'
};

function batchSummary(batch: batches.Batch, categoryNames: string[], currency: string): string {
  const groups = new Map<string, { name: string; entries: { row: StagedRow; key: string }[]; total: number }>();
  batch.rows.forEach((row, index) => {
    const id = row.merchant.toLowerCase();
    const group = groups.get(id) ?? { name: row.merchant, entries: [], total: 0 };
    group.entries.push({ row, key: batches.rowKey(index) });
    group.total += row.amount;
    groups.set(id, group);
  });

  const sorted = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = batch.rows.reduce((sum, row) => sum + row.amount, 0);

  const merchantLines = sorted.map(group => {
    const dates = group.entries.map(entry => entry.row.date).sort();
    const span = dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} → ${dates.at(-1)}`;
    const count = group.entries.length;
    return `  ${group.name} — ${count} ${count === 1 ? 'row' : 'rows'}, ${money(group.total, currency)} (${span})`;
  });

  // Rows that stand out — big, or far above what that merchant usually costs —
  // are listed so the assistant can recategorize or exclude them one by one.
  const standouts = sorted.flatMap(group => {
    const amounts = group.entries.map(entry => entry.row.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)] ?? 0;
    return group.entries.filter(
      ({ row }) => row.amount >= 250 || (amounts.length >= 3 && row.amount > median * 3)
    );
  });

  const skippedCounts = new Map<string, number>();
  for (const row of batch.skipped) skippedCounts.set(row.reason, (skippedCounts.get(row.reason) ?? 0) + 1);
  const skippedLine = [...skippedCounts.entries()]
    .map(([reason, count]) => `${count} ${SKIP_LABELS[reason] ?? reason}`)
    .join(', ');

  return [
    `Import batch ${batch.id} — held for 30 minutes.`,
    `${batch.rows.length} purchases to import, totalling ${money(total, currency)}, from ${groups.size} merchants.`,
    batch.alreadyImported > 0 ? `${batch.alreadyImported} lines were already imported earlier and are left out.` : '',
    skippedLine ? `Skipped automatically: ${skippedLine}.` : '',
    '',
    `The user's categories: ${categoryNames.join(', ') || '(none yet)'}.`,
    '',
    'Merchants (largest first):',
    ...merchantLines,
    ...(standouts.length > 0
      ? ['', 'Rows that stand out (row key, date, amount, merchant):', ...standouts.map(({ row, key }) => rowLine(key, row, currency))]
      : []),
    '',
    IMPORT_GUIDELINES,
    '',
    `Then call import_transactions with batch_id "${batch.id}", one { merchant, category } per merchant above, and any overrides or exclusions.`
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
}

export function buildMcpServer(auth: AuthInfo): McpServer {
  const db = userClient(auth);
  const uid = userIdOf(auth);

  const server = new McpServer(
    { name: 'tally-expense-tracker', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      instructions:
        'Tally is the user\'s expense tracker. Log spending the moment they mention it, ' +
        'in their own words — do not ask them to pick a category unless it is genuinely ' +
        'ambiguous; add_expense will match or create one. Read the `tally://categories` ' +
        'resource before guessing a new category name so you reuse what already exists. ' +
        'After logging, if `tally://budget-status` shows a category near or over its ' +
        'budget, mention it once, briefly. When the user shares a bank statement CSV, import it ' +
        'with parse_bank_statement then import_transactions, following the categorization ' +
        'guidelines parse_bank_statement returns.'
    }
  );

  const currencyOf = async () => (await data.getProfile(db)).currency;

  // ------------------------------------------------------------- write tools

  server.registerTool(
    'add_expense',
    {
      title: 'Add an expense',
      description:
        'Record a single expense. The category is optional: pass the user\'s own words and it ' +
        'will be matched to an existing category or created. Date defaults to today.',
      inputSchema: expenseShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async input =>
      guard(async () => {
        const currency = await currencyOf();
        const expense = await data.addExpense(db, uid, input, 'ai');
        const category = expense.categories?.name ?? 'Uncategorized';

        // Surface a budget warning in the same breath — that is the moment the
        // user can still act on it.
        const [year, month] = expense.expense_date.split('-').map(Number) as [number, number];
        const budgets = await data.budgetStatus(db, year, month);
        const hit = budgets.find(
          row => row.category_id === expense.category_id || row.category_id === null
        );
        const note =
          hit && (hit.exceeded || hit.pct_used >= 80)
            ? `\n\n${hit.exceeded ? '⚠' : 'Heads up:'} ${hit.category_name} is at ${hit.pct_used}% of ${money(hit.budget, currency)} this month.`
            : '';

        return text(
          `Logged ${money(expense.amount, currency)} — ${expense.description} (${category}) on ${expense.expense_date}.\nid: ${expense.id}${note}`
        );
      })
  );

  server.registerTool(
    'add_expenses_bulk',
    {
      title: 'Add several expenses',
      description:
        'Record several expenses at once, for messages like "I bought coffee, a metro pass and groceries today".',
      inputSchema: {
        expenses: z.array(z.object(expenseShape)).min(1).max(50)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ expenses }) =>
      guard(async () => {
        const currency = await currencyOf();
        const created = await data.addExpensesBulk(db, uid, expenses, 'ai');
        const total = created.reduce((sum, expense) => sum + expense.amount, 0);

        const lines = created.map(
          expense =>
            `  • ${money(expense.amount, currency)} — ${expense.description} (${expense.categories?.name ?? 'Uncategorized'}) [${expense.id}]`
        );

        return text(
          `Logged ${created.length} ${created.length === 1 ? 'expense' : 'expenses'} totalling ${money(total, currency)}:\n${lines.join('\n')}`
        );
      })
  );

  server.registerTool(
    'update_expense',
    {
      title: 'Update an expense',
      description:
        'Change an existing expense. Pass only the fields to change. Set category to an empty string to move it to Uncategorized.',
      inputSchema: {
        id: z.string().uuid().describe('Expense id, as returned by add_expense or list_expenses'),
        description: z.string().min(1).max(200).optional(),
        amount: amount.optional(),
        category: z.string().max(60).optional(),
        date: isoDate.optional(),
        notes: z.string().max(500).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ id, ...patch }) =>
      guard(async () => {
        const currency = await currencyOf();
        const expense = await data.updateExpense(db, uid, id, patch);
        return text(
          `Updated: ${money(expense.amount, currency)} — ${expense.description} (${expense.categories?.name ?? 'Uncategorized'}) on ${expense.expense_date}.`
        );
      })
  );

  server.registerTool(
    'delete_expense',
    {
      title: 'Delete an expense',
      description: 'Permanently remove an expense by id.',
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    async ({ id }) =>
      guard(async () => {
        const currency = await currencyOf();
        const expense = await data.deleteExpense(db, id);
        if (!expense) return text(`No expense with id ${id} — nothing deleted.`);
        return text(
          `Deleted ${money(expense.amount, currency)} — ${expense.description} (${expense.expense_date}).`
        );
      })
  );

  // -------------------------------------------------------------- read tools

  server.registerTool(
    'list_expenses',
    {
      title: 'List expenses',
      description:
        'List expenses newest first, with optional filters. Returns ids, so this is how you find an expense to update or delete.',
      inputSchema: {
        category: z.string().max(60).optional().describe('Filter to one category by name'),
        from: isoDate.optional().describe('Earliest date, inclusive'),
        to: isoDate.optional().describe('Latest date, inclusive'),
        min_amount: z.number().nonnegative().optional(),
        max_amount: z.number().positive().optional(),
        search: z.string().max(100).optional().describe('Substring match on the description'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
        offset: z.number().int().min(0).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async input =>
      guard(async () => {
        const currency = await currencyOf();
        const { expenses, total } = await data.listExpenses(db, {
          categoryName: input.category,
          from: input.from,
          to: input.to,
          minAmount: input.min_amount,
          maxAmount: input.max_amount,
          search: input.search,
          limit: input.limit,
          offset: input.offset
        });

        if (expenses.length === 0) return text('No expenses match those filters.');

        const shown = (input.offset ?? 0) + expenses.length;
        const sum = expenses.reduce((acc, expense) => acc + expense.amount, 0);

        return text(
          [
            `Showing ${expenses.length} of ${total} (through ${shown}). Subtotal ${money(sum, currency)}.`,
            '',
            ...expenses.map(expense => `${expenseLine(expense, currency)}  [${expense.id}]`)
          ].join('\n')
        );
      })
  );

  server.registerTool(
    'get_summary',
    {
      title: 'Spending summary',
      description:
        'All-time totals and a per-category breakdown. Pass from/to to narrow it to a date range.',
      inputSchema: { from: isoDate.optional(), to: isoDate.optional() },
      annotations: { readOnlyHint: true }
    },
    async ({ from, to }) =>
      guard(async () => {
        const currency = await currencyOf();
        const { total, byCategory } = await data.summary(db, from, to);
        const range = from || to ? ` (${from ?? 'start'} to ${to ?? 'today'})` : ' (all time)';
        return text(summaryText(byCategory, total, currency, `Spending${range}`));
      })
  );

  server.registerTool(
    'get_monthly_summary',
    {
      title: 'Monthly summary',
      description: 'Totals and category breakdown for one month. Defaults to the current month.',
      inputSchema: {
        year: z.number().int().min(2000).max(2100).optional(),
        month: z.number().int().min(1).max(12).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ year, month }) =>
      guard(async () => {
        const now = today();
        const y = year ?? now.year;
        const m = month ?? now.month;
        const currency = await currencyOf();
        const { total, byCategory } = await data.monthlySummary(db, y, m);
        return text(summaryText(byCategory, total, currency, `Spending in ${monthName(y, m)}`));
      })
  );

  // --------------------------------------------------------------- categories

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description:
        'The categories that already exist. Check this before inventing a new category name.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () =>
      guard(async () => {
        const categories = await data.listCategories(db);
        if (categories.length === 0) return text('No categories yet.');
        return text(categories.map(c => `  • ${c.name} (${c.color}) [${c.id}]`).join('\n'));
      })
  );

  server.registerTool(
    'add_category',
    {
      title: 'Add a category',
      description:
        'Create a category. add_expense already creates categories on demand, so use this only when the user explicitly asks to set one up.',
      inputSchema: {
        name: z.string().min(1).max(60),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex color like #2563EB')
          .optional(),
        icon: z.string().max(40).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ name, color, icon }) =>
      guard(async () => {
        const existing = await data.findCategoryByName(db, name);
        if (existing) return text(`"${existing.name}" already exists [${existing.id}].`);
        const category = await data.createCategory(db, uid, name, color, icon);
        return text(`Created category "${category.name}" (${category.color}) [${category.id}].`);
      })
  );

  server.registerTool(
    'rename_category',
    {
      title: 'Rename a category',
      description: 'Rename a category, and optionally change its color. Expenses keep their link.',
      inputSchema: {
        name: z.string().min(1).max(60).describe('The current category name'),
        new_name: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ name, new_name: newName, color }) =>
      guard(async () => {
        const category = await data.findCategoryByName(db, name);
        if (!category) return failure(`No category named "${name}".`);
        const updated = await data.renameCategory(db, category.id, newName, color);
        return text(`Renamed "${category.name}" to "${updated.name}".`);
      })
  );

  server.registerTool(
    'delete_category',
    {
      title: 'Delete a category',
      description:
        'Delete a category. Its expenses are kept and become Uncategorized; any budget for it is removed.',
      inputSchema: { name: z.string().min(1).max(60) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    async ({ name }) =>
      guard(async () => {
        const category = await data.findCategoryByName(db, name);
        if (!category) return failure(`No category named "${name}".`);
        const { total } = await data.listExpenses(db, { categoryId: category.id, limit: 1 });
        await data.deleteCategory(db, category.id);
        return text(
          `Deleted "${category.name}". ${total} ${total === 1 ? 'expense is' : 'expenses are'} now Uncategorized.`
        );
      })
  );

  // ------------------------------------------------------------------ budgets

  server.registerTool(
    'set_budget',
    {
      title: 'Set a budget',
      description:
        'Set or update a monthly budget. Omit category for the overall budget. Defaults to the current month.',
      inputSchema: {
        amount,
        category: z.string().max(60).optional().describe('Omit for the overall monthly budget'),
        year: z.number().int().min(2000).max(2100).optional(),
        month: z.number().int().min(1).max(12).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ amount: value, category, year, month }) =>
      guard(async () => {
        const now = today();
        const y = year ?? now.year;
        const m = month ?? now.month;
        const currency = await currencyOf();

        let categoryId: string | null = null;
        if (category) {
          const resolved = await data.resolveCategory(db, uid, category);
          if (!resolved) return failure(`Could not resolve category "${category}".`);
          categoryId = resolved.id;
        }

        await data.setBudget(db, uid, { amount: value, year: y, month: m, categoryId });
        const label = category ? `${category} budget` : 'Overall budget';
        return text(`${label} for ${monthName(y, m)} set to ${money(value, currency)}.`);
      })
  );

  server.registerTool(
    'get_budget_status',
    {
      title: 'Budget status',
      description:
        'Spent vs. budget for a month, overall and per category, flagging anything over budget. Defaults to the current month.',
      inputSchema: {
        year: z.number().int().min(2000).max(2100).optional(),
        month: z.number().int().min(1).max(12).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ year, month }) =>
      guard(async () => {
        const now = today();
        const y = year ?? now.year;
        const m = month ?? now.month;
        const currency = await currencyOf();
        const rows = await data.budgetStatus(db, y, m);
        return text(budgetText(rows, currency, `Budgets for ${monthName(y, m)}`));
      })
  );

  // ------------------------------------------------------------------- import

  server.registerTool(
    'parse_bank_statement',
    {
      title: 'Read a bank statement',
      description:
        'Step 1 of importing a bank statement CSV (date,description,debit,credit). Nets out reversals, ' +
        'refunds and fee pairs, drops lines already imported, and holds the purchases for 30 minutes. ' +
        'Returns them grouped by merchant, with the user\'s categories and how to categorize them. ' +
        'Long statements can be sent in pieces: pass the batch_id from the first call to add more.',
      inputSchema: {
        csv: z.string().min(1).max(500_000).describe('The statement CSV, as exported by the bank'),
        batch_id: z.string().max(32).optional().describe('Add to an earlier batch instead of starting a new one')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ csv, batch_id }) =>
      guard(async () => {
        const parsed = parseBankCsv(csv);
        if (!parsed.from || !parsed.to) {
          return failure('No dated lines found. Expected rows like: 2026-10-08,<description>,<debit>,<credit>');
        }

        const existing = await data.existingExternalIds(db, parsed.from, parsed.to);
        const fresh = parsed.rows.filter(row => !existing.has(row.id));
        const batch = batches.stageBatch(
          uid,
          { rows: fresh, skipped: parsed.skipped, alreadyImported: parsed.rows.length - fresh.length },
          batch_id
        );

        const [currency, categories] = await Promise.all([currencyOf(), data.listCategories(db)]);
        return text(batchSummary(batch, categories.map(c => c.name), currency));
      })
  );

  server.registerTool(
    'list_batch_rows',
    {
      title: 'Show rows in an import batch',
      description:
        'List the individual purchases for some merchants in a staged import, with their row keys (r1, r2…), ' +
        'so a merchant that sells several kinds of things can be split with overrides.',
      inputSchema: {
        batch_id: z.string().max(32),
        merchants: z.array(z.string().max(200)).min(1).max(50)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ batch_id, merchants }) =>
      guard(async () => {
        const batch = batches.getBatch(uid, batch_id);
        const currency = await currencyOf();
        const wanted = new Set(merchants.map(name => name.trim().toLowerCase()));

        const lines = batch.rows
          .map((row, index) => ({ row, key: batches.rowKey(index) }))
          .filter(({ row }) => wanted.has(row.merchant.toLowerCase()))
          .map(({ row, key }) => rowLine(key, row, currency));

        return text(lines.length > 0 ? lines.join('\n') : 'None of those merchants are in this batch.');
      })
  );

  server.registerTool(
    'import_transactions',
    {
      title: 'Import a categorized bank statement',
      description:
        'Step 2: save a batch from parse_bank_statement. Give every merchant in the batch exactly one ' +
        'category — an existing category name, or null for Uncategorized. Use overrides to recategorize ' +
        'single rows and exclude to leave merchants or rows out. Categories are never created here: ' +
        'an unknown name rejects the whole call and nothing is saved.',
      inputSchema: {
        batch_id: z.string().max(32),
        merchants: z
          .array(z.object({ merchant: z.string().max(200), category: z.string().max(60).nullable() }))
          .max(2_000),
        overrides: z
          .array(
            z.object({
              row: z.string().max(10).describe('Row key such as "r12"'),
              category: z.string().max(60).nullable()
            })
          )
          .max(5_000)
          .optional(),
        exclude: z
          .array(z.string().max(200))
          .max(5_000)
          .optional()
          .describe('Merchant names or row keys to leave out')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ batch_id, merchants, overrides = [], exclude = [] }) =>
      guard(async () => {
        const batch = batches.getBatch(uid, batch_id);
        const [currency, categories] = await Promise.all([currencyOf(), data.listCategories(db)]);
        const byName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c]));
        const categoryFor = (name: string | null) =>
          name === null ? null : (byName.get(name.trim().toLowerCase()) ?? null);
        const inBatch = new Set(batch.rows.map(row => row.merchant.toLowerCase()));

        // Validate everything before writing anything.
        const problems: string[] = [];

        const unknown = [...merchants.map(m => m.category), ...overrides.map(o => o.category)].filter(
          (name): name is string => name !== null && !categoryFor(name)
        );
        if (unknown.length > 0) {
          problems.push(
            `Unknown categories: ${[...new Set(unknown)].join(', ')}. Use one of: ` +
              `${categories.map(c => c.name).join(', ') || '(none yet)'}, or null for Uncategorized.`
          );
        }

        const assigned = new Map<string, string | null>();
        for (const { merchant, category } of merchants) {
          const key = merchant.trim().toLowerCase();
          if (!inBatch.has(key)) problems.push(`"${merchant}" is not a merchant in this batch.`);
          assigned.set(key, category);
        }

        const overridden = new Map<number, string | null>();
        for (const { row, category } of overrides) {
          const index = batches.rowIndex(batch, row);
          if (index === null) problems.push(`"${row}" is not a row in this batch.`);
          else overridden.set(index, category);
        }

        const excludedRows = new Set<number>();
        const excludedMerchants = new Set<string>();
        for (const entry of exclude) {
          const index = batches.rowIndex(batch, entry);
          const key = entry.trim().toLowerCase();
          if (index !== null) excludedRows.add(index);
          else if (inBatch.has(key)) excludedMerchants.add(key);
          else problems.push(`Cannot exclude "${entry}": not a merchant or row key in this batch.`);
        }

        const missing = new Set(
          batch.rows
            .filter(row => {
              const key = row.merchant.toLowerCase();
              return !assigned.has(key) && !excludedMerchants.has(key);
            })
            .map(row => row.merchant)
        );
        if (missing.size > 0) {
          problems.push(
            `No category given for: ${[...missing].join(', ')}. Assign each one (null for Uncategorized) or exclude it.`
          );
        }

        if (problems.length > 0) return failure(`Nothing was imported.\n${problems.join('\n')}`);

        const inputs: data.ImportInput[] = [];
        batch.rows.forEach((row, index) => {
          const key = row.merchant.toLowerCase();
          if (excludedRows.has(index) || excludedMerchants.has(key)) return;
          const name = overridden.has(index) ? overridden.get(index) : assigned.get(key);
          inputs.push({
            externalId: row.id,
            date: row.date,
            description: row.merchant,
            amount: row.amount,
            categoryId: categoryFor(name ?? null)?.id ?? null,
            notes: row.notes
          });
        });

        const { inserted, duplicates } = await data.importExpenses(db, uid, inputs);
        batches.dropBatch(batch.id);

        const byCategory = new Map<string, { total: number; count: number }>();
        for (const expense of inserted) {
          const name = expense.categories?.name ?? 'Uncategorized';
          const entry = byCategory.get(name) ?? { total: 0, count: 0 };
          entry.total += expense.amount;
          entry.count += 1;
          byCategory.set(name, entry);
        }
        const grand = inserted.reduce((sum, expense) => sum + expense.amount, 0);
        const lines = [...byCategory.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(
            ([name, { total, count }]) =>
              `  ${name.padEnd(14)} ${money(total, currency).padStart(12)}  (${count})`
          );

        const leftOut = batch.rows.length - inputs.length;
        const extras = [
          duplicates > 0 ? `${duplicates} already imported` : '',
          leftOut > 0 ? `${leftOut} left out` : ''
        ].filter(Boolean);

        // Only this month's budgets are worth a warning; old months are history.
        const now = today();
        const near = (await data.budgetStatus(db, now.year, now.month)).filter(
          row => row.exceeded || row.pct_used >= 80
        );
        const note =
          near.length > 0
            ? `\n\nHeads up for ${monthName(now.year, now.month)}: ${near
                .map(row => `${row.category_name} at ${row.pct_used}% of ${money(row.budget, currency)}`)
                .join('; ')}.`
            : '';

        return text(
          `Imported ${inserted.length} ${inserted.length === 1 ? 'expense' : 'expenses'} totalling ${money(grand, currency)}` +
            `${extras.length > 0 ? ` (${extras.join(', ')})` : ''}.\n\n${lines.join('\n')}${note}`
        );
      })
  );

  // ------------------------------------------------------------------- export

  server.registerTool(
    'export_expenses_csv',
    {
      title: 'Export expenses to CSV',
      description:
        'Return matching expenses as CSV text, using the same filters as list_expenses. Hand the content to the user or save it to a file.',
      inputSchema: {
        category: z.string().max(60).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        min_amount: z.number().nonnegative().optional(),
        max_amount: z.number().positive().optional(),
        search: z.string().max(100).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async input =>
      guard(async () => {
        const { expenses, total } = await data.listExpenses(db, {
          categoryName: input.category,
          from: input.from,
          to: input.to,
          minAmount: input.min_amount,
          maxAmount: input.max_amount,
          search: input.search,
          // The cap is deliberate: a CSV big enough to blow past it belongs in
          // the app's own export button, not in a chat transcript.
          limit: 500
        });

        if (expenses.length === 0) return text('No expenses match those filters — nothing to export.');

        const truncated =
          total > expenses.length
            ? `\n\n(${expenses.length} of ${total} rows — narrow the filters, or use Export CSV in the app for the full set.)`
            : '';

        return text(`${expensesToCsv(expenses)}${truncated}`);
      })
  );

  // ------------------------------------------------------------------ prompts

  server.registerPrompt(
    'log_expense',
    {
      title: 'Log an expense',
      description:
        'Start from what you bought, in your own words. Pre-filled with your current categories and budget position so nothing has to be looked up first.',
      argsSchema: {
        what: z
          .string()
          .optional()
          .describe('What you bought, e.g. "coffee and a metro pass"')
      }
    },
    async ({ what }) => {
      const currency = await currencyOf();
      const categories = await data.listCategories(db);
      const now = today();
      const budgets = await data.budgetStatus(db, now.year, now.month);

      const categoryList =
        categories.length > 0
          ? categories.map(c => c.name).join(', ')
          : '(none yet — create whatever fits)';

      const budgetLine =
        budgets.length > 0
          ? budgets
              .map(
                row =>
                  `${row.category_name}: ${money(row.spent, currency)} of ${money(row.budget, currency)} (${row.pct_used}%)`
              )
              .join('; ')
          : 'no budgets set';

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                what ? `I spent: ${what}` : 'I want to log what I spent.',
                '',
                `Today is ${new Date().toISOString().slice(0, 10)}.`,
                `My existing categories: ${categoryList}.`,
                `This month so far — ${budgetLine}.`,
                '',
                'Log each item with add_expense (or add_expenses_bulk for several).',
                'Pick the closest existing category; create a new one only if none fits.',
                'Do not ask me to choose a category. Tell me what you logged, and mention any budget I am close to or over.'
              ].join('\n')
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    'import_bank_statement',
    {
      title: 'Import a bank statement',
      description:
        'Load a bank statement CSV into Tally. The assistant nets out refunds and reversals and files every purchase into your existing categories.',
      argsSchema: {
        csv: z.string().optional().describe('The statement CSV (or attach / paste it afterwards)')
      }
    },
    async ({ csv }) => {
      const categories = await data.listCategories(db);
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'Import my bank statement into Tally.',
                `My categories: ${categories.map(c => c.name).join(', ') || '(none yet)'}.`,
                '',
                'Pass the CSV to parse_bank_statement (in pieces if it is very long, reusing the batch_id),',
                'categorize every merchant it returns, show me the plan, then call import_transactions.',
                '',
                IMPORT_GUIDELINES,
                ...(csv ? ['', 'The statement:', csv] : ['', 'I will paste or attach the statement next.'])
              ].join('\n')
            }
          }
        ]
      };
    }
  );

  // ---------------------------------------------------------------- resources

  server.registerResource(
    'categories',
    'tally://categories',
    {
      title: 'Categories',
      description: 'The user\'s current expense categories, so new expenses reuse existing buckets.',
      mimeType: 'application/json'
    },
    async uri => {
      const categories = await data.listCategories(db);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ categories }, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    'budget-status',
    'tally://budget-status',
    {
      title: 'Budget status',
      description: 'This month\'s spend against budget, overall and per category.',
      mimeType: 'application/json'
    },
    async uri => {
      const now = today();
      const [rows, currency] = await Promise.all([
        data.budgetStatus(db, now.year, now.month),
        currencyOf()
      ]);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              { month: monthName(now.year, now.month), currency, budgets: rows },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}
