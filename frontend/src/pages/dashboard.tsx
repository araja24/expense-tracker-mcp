import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CreditCard,
  Plus,
  Tag,
  Wallet,
} from 'lucide-react'
import {
  fetchBudgetStatus,
  fetchCategories,
  fetchExpenses,
  fetchMonthlyTotals,
  fetchSummary,
} from '@/lib/api'
import { money, monthBounds, monthLabel, percent, shortDate } from '@/lib/format'
import type { BudgetStatusRow, Category, Expense, SummaryRow } from '@/lib/types'
import { useCurrency } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { CategoryDonut, SpendingBars } from '@/components/charts'
import { ExpenseDialog } from '@/components/expense-dialog'
import {
  CardHeading,
  CategoryDot,
  CategoryIconTile,
  CategoryPill,
  EmptyState,
  ErrorNote,
  Meter,
  Panel,
  PageBody,
  PageHeader,
  PrimaryButton,
  SelectButton,
} from '@/components/tally'
import { Skeleton } from '@/components/ui/skeleton'

interface DashboardData {
  categories: Category[]
  thisMonth: { total: number; byCategory: SummaryRow[] }
  lastMonth: { total: number }
  monthly: { period: string; total: number }[]
  budgets: BudgetStatusRow[]
  recent: Expense[]
  transactionCount: number
  lastMonthCount: number
}

export function DashboardPage() {
  const currency = useCurrency()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const [data, setData] = React.useState<DashboardData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const current = monthBounds(year, month)
      const previousMonth = month === 1 ? 12 : month - 1
      const previousYear = month === 1 ? year - 1 : year
      const previous = monthBounds(previousYear, previousMonth)

      const [categories, thisMonth, lastMonth, monthly, budgets, recent, lastMonthRows] =
        await Promise.all([
          fetchCategories(),
          fetchSummary(current.from, current.to),
          fetchSummary(previous.from, previous.to),
          fetchMonthlyTotals(6),
          fetchBudgetStatus(year, month),
          fetchExpenses({ from: current.from, to: current.to }, { limit: 5, offset: 0 }),
          fetchExpenses({ from: previous.from, to: previous.to }, { limit: 1, offset: 0 }),
        ])

      setData({
        categories,
        thisMonth,
        lastMonth,
        monthly,
        budgets,
        recent: recent.expenses,
        transactionCount: recent.total,
        lastMonthCount: lastMonthRows.total,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your dashboard')
    }
  }, [year, month])

  React.useEffect(() => {
    void load()
  }, [load])

  const overall = data?.budgets.find((row) => row.category_id === null)
  const perCategory = data?.budgets.filter((row) => row.category_id !== null) ?? []
  const topCategory = data?.thisMonth.byCategory[0]

  return (
    <>
      <PageHeader title="Dashboard">
        <SelectButton>{monthLabel(year, month)}</SelectButton>
        <PrimaryButton onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" strokeWidth={2.1} />
          Add expense
        </PrimaryButton>
      </PageHeader>

      <PageBody>
        {error && <ErrorNote message={error} />}

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? (
            Array.from({ length: 4 }, (_, i) => (
              <Panel key={i} className="gap-3 p-[18px]">
                <Skeleton className="size-9 rounded-[10px]" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-7 w-32" />
              </Panel>
            ))
          ) : (
            <>
              <StatTile
                icon={CreditCard}
                tint="#2563EB"
                label="Spent this month"
                value={money(data.thisMonth.total, currency)}
                change={delta(data.thisMonth.total, data.lastMonth.total)}
                risingIsBad
              />
              <StatTile
                icon={Wallet}
                tint="#8B5CF6"
                label="Budget remaining"
                value={overall ? money(overall.remaining, currency) : '—'}
                caption={
                  overall
                    ? `${percent(overall.pct_used, 0)} of ${money(overall.budget, currency)} used`
                    : 'No overall budget set'
                }
              />
              <StatTile
                icon={Tag}
                tint="#F97316"
                label="Top category"
                value={topCategory?.category_name ?? '—'}
                caption={
                  topCategory ? `${money(topCategory.total, currency)} this month` : 'Nothing logged yet'
                }
              />
              <StatTile
                icon={BarChart3}
                tint="#14B8A6"
                label="Transactions"
                value={String(data.transactionCount)}
                change={delta(data.transactionCount, data.lastMonthCount)}
                risingIsBad={false}
              />
            </>
          )}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Panel className="gap-5 p-5 xl:col-span-2">
            <CardHeading
              title="Spending"
              subtitle="Last 6 months"
              action={
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-[9px] py-[5px] text-[12px] font-medium text-ink-label">
                  <span className="size-2 rounded-[2px] bg-primary" aria-hidden />
                  This month
                </span>
              }
            />
            {!data ? (
              <Skeleton className="h-[370px] w-full" />
            ) : (
              <SpendingBars data={data.monthly} currency={currency} />
            )}
          </Panel>

          <Panel className="gap-[18px] p-5">
            <CardHeading title="By category" subtitle={monthLabel(year, month)} />
            {!data ? (
              <>
                <Skeleton className="size-[184px] self-center rounded-full" />
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </>
            ) : data.thisMonth.byCategory.length === 0 ? (
              <EmptyState
                title="Nothing logged yet"
                description="Add an expense, or tell your assistant what you bought."
              />
            ) : (
              <>
                <CategoryDonut
                  slices={data.thisMonth.byCategory.map((row) => ({
                    id: row.category_id ?? 'uncategorized',
                    name: row.category_name,
                    color: row.category_color,
                    total: row.total,
                  }))}
                  total={data.thisMonth.total}
                  currency={currency}
                />
                <div className="flex flex-col">
                  {data.thisMonth.byCategory.map((row) => (
                    <div
                      key={row.category_id ?? 'uncategorized'}
                      className="flex items-center gap-2.5 border-t border-divider py-[9px]"
                    >
                      <CategoryDot color={row.category_color} size={9} />
                      <span className="grow truncate text-[13px] font-medium text-ink-mid">
                        {row.category_name}
                      </span>
                      <span className="tabular text-[13px] font-semibold text-ink-strong">
                        {money(row.total, currency)}
                      </span>
                      <span className="tabular w-11 text-right text-[12px] font-medium text-ink-muted">
                        {percent(
                          data.thisMonth.total > 0 ? (row.total / data.thisMonth.total) * 100 : 0,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Panel className="gap-1.5 p-5 xl:col-span-2">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">
                Recent transactions
              </h2>
              <Link
                to="/transactions"
                className="text-[13px] font-semibold text-primary hover:text-primary-hover"
              >
                View all
              </Link>
            </div>

            {!data ? (
              Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="my-2 h-[34px] w-full" />
              ))
            ) : data.recent.length === 0 ? (
              <EmptyState
                title="No expenses this month"
                description="Once you add one — here or through your assistant — it shows up here."
              />
            ) : (
              data.recent.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center gap-3.5 border-t border-divider py-3"
                >
                  <CategoryIconTile
                    icon={expense.categories?.icon}
                    color={expense.categories?.color}
                  />
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-semibold text-ink-strong">
                      {expense.description}
                    </span>
                    <span className="truncate text-[12px] font-medium text-ink-muted">
                      {expense.source === 'ai' ? 'Logged via chat' : (expense.notes ?? 'Added manually')}
                      {' · '}
                      {shortDate(expense.expense_date)}
                    </span>
                  </span>
                  <CategoryPill
                    name={expense.categories?.name}
                    color={expense.categories?.color}
                    className="hidden sm:inline-flex"
                  />
                  <span className="tabular w-24 shrink-0 text-right text-[14px] font-semibold text-ink-strong">
                    {money(expense.amount, currency)}
                  </span>
                </div>
              ))
            )}
          </Panel>

          <Panel className="gap-[18px] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">Budgets</h2>
              <Link
                to="/budgets"
                className="text-[13px] font-semibold text-primary hover:text-primary-hover"
              >
                Manage
              </Link>
            </div>

            {!data ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : perCategory.length === 0 && !overall ? (
              <EmptyState
                title="No budgets yet"
                description="Set a monthly limit to see how the month is tracking."
              />
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {perCategory.map((row) => (
                    <div key={row.category_id} className="flex flex-col gap-[7px]">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px] font-semibold text-ink-strong">
                          {row.category_name}
                        </span>
                        <span
                          className={cn(
                            'tabular shrink-0 text-[12.5px] font-medium',
                            row.exceeded ? 'text-danger-strong' : 'text-ink-muted',
                          )}
                        >
                          {row.exceeded
                            ? `${money(Math.abs(row.remaining), currency)} over`
                            : `${money(row.spent, currency)} of ${money(row.budget, currency)}`}
                        </span>
                      </div>
                      <Meter
                        value={row.pct_used}
                        color={row.category_color}
                        exceeded={row.exceeded}
                      />
                    </div>
                  ))}
                </div>

                {overall && (
                  <div className="mt-auto flex items-baseline justify-between border-t border-divider pt-4">
                    <span className="text-[13px] font-medium text-ink-muted">Left to spend</span>
                    <span
                      className={cn(
                        'tabular text-[16px] font-semibold',
                        overall.exceeded ? 'text-danger-strong' : 'text-ink-strong',
                      )}
                    >
                      {money(overall.remaining, currency)}
                    </span>
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
      </PageBody>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={data?.categories ?? []}
        onSaved={load}
      />
    </>
  )
}

function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

function StatTile({
  icon: Icon,
  tint,
  label,
  value,
  caption,
  change,
  changeLabel,
  risingIsBad = false,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
  tint: string
  label: string
  value: string
  caption?: string
  change?: number | null
  changeLabel?: string
  risingIsBad?: boolean
}) {
  const hasChange = change !== null && change !== undefined
  const rising = hasChange && change >= 0
  // Spending more is not "up and to the right" — for money out, a rise is the
  // unwelcome direction, which is why the mockup shows 8.2% up in red.
  const bad = hasChange && (risingIsBad ? rising : !rising)

  return (
    <Panel className="gap-3 p-[18px]">
      <span
        className="flex size-9 items-center justify-center rounded-[10px]"
        style={{ background: `color-mix(in srgb, ${tint} 8%, white)` }}
      >
        <Icon className="size-[18px]" strokeWidth={1.85} style={{ color: tint }} />
      </span>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className="tabular truncate text-[28px] font-semibold tracking-[-0.025em] text-ink-strong">
          {value}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        {hasChange && (
          <>
            {rising ? (
              <ArrowUp
                className="size-3.5"
                strokeWidth={2.2}
                style={{ color: bad ? 'var(--danger-strong)' : 'var(--positive-strong)' }}
              />
            ) : (
              <ArrowDown
                className="size-3.5"
                strokeWidth={2.2}
                style={{ color: bad ? 'var(--danger-strong)' : 'var(--positive-strong)' }}
              />
            )}
            <span
              className="tabular"
              style={{ color: bad ? 'var(--danger-strong)' : 'var(--positive-strong)' }}
            >
              {Math.abs(change).toFixed(1)}%
            </span>
          </>
        )}
        <span className="truncate text-ink-muted">
          {changeLabel ?? caption ?? (hasChange ? 'vs last month' : '')}
        </span>
      </div>
    </Panel>
  )
}
