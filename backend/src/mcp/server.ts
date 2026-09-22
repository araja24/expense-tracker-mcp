import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';

import { userClient, userId as userIdOf } from '../lib/supabase.js';
import * as data from '../lib/expenses.js';
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
        'budget, mention it once, briefly.'
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
