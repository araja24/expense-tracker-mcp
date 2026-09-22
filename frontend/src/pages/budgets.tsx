import * as React from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteBudget,
  fetchBudgetStatus,
  fetchBudgets,
  fetchCategories,
  setBudget,
} from '@/lib/api'
import { daysLeftInMonth, money, monthLabel, percent } from '@/lib/format'
import type { Budget, BudgetStatusRow, Category } from '@/lib/types'
import { useCurrency } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import {
  CategoryDot,
  EmptyState,
  ErrorNote,
  GhostButton,
  Meter,
  OverBadge,
  Panel,
  PageBody,
  PageHeader,
  PrimaryButton,
  StatusPill,
} from '@/components/tally'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const OVERALL = '__overall__'

export function BudgetsPage() {
  const currency = useCurrency()
  const now = new Date()
  const [year, setYear] = React.useState(now.getFullYear())
  const [month, setMonth] = React.useState(now.getMonth() + 1)

  const [status, setStatus] = React.useState<BudgetStatusRow[] | null>(null)
  const [budgets, setBudgets] = React.useState<Budget[]>([])
  const [categories, setCategories] = React.useState<Category[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingCategory, setEditingCategory] = React.useState<string>(OVERALL)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [rows, existing, cats] = await Promise.all([
        fetchBudgetStatus(year, month),
        fetchBudgets(year, month),
        fetchCategories(),
      ])
      setStatus(rows)
      setBudgets(existing)
      setCategories(cats)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load budgets')
    }
  }, [year, month])

  React.useEffect(() => {
    void load()
  }, [load])

  function shiftMonth(by: number) {
    const next = new Date(year, month - 1 + by, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
  }

  const overall = status?.find((row) => row.category_id === null)
  const perCategory = status?.filter((row) => row.category_id !== null) ?? []
  const daysLeft = daysLeftInMonth(year, month)
  const monthOnly = monthLabel(year, month).split(' ')[0]

  function openEditor(categoryId: string | null) {
    setEditingCategory(categoryId ?? OVERALL)
    setDialogOpen(true)
  }

  async function handleDelete(categoryId: string | null) {
    const budget = budgets.find((b) => b.category_id === categoryId)
    if (!budget) return
    if (!window.confirm('Remove this budget?')) return
    try {
      await deleteBudget(budget.id)
      toast.success('Budget removed')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not remove the budget')
    }
  }

  return (
    <>
      <PageHeader title="Budgets">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-ink-mid hover:bg-secondary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular min-w-[132px] text-center text-[13.5px] font-medium text-ink-mid">
            {monthLabel(year, month)}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-ink-mid hover:bg-secondary"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <PrimaryButton onClick={() => openEditor(null)}>
          <Plus className="size-4" strokeWidth={2.1} />
          New budget
        </PrimaryButton>
      </PageHeader>

      <PageBody>
        {error && <ErrorNote message={error} />}

        {!status ? (
          <Skeleton className="h-[164px] w-full rounded-xl" />
        ) : (
          <Panel className="gap-4 p-[22px]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-muted">
                  Overall budget · {monthOnly}
                </span>
                {overall ? (
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-[30px] font-semibold tracking-[-0.025em] text-ink-strong">
                      {money(overall.spent, currency)}
                    </span>
                    <span className="tabular text-[15px] font-medium text-ink-muted">
                      of {money(overall.budget, currency)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[13.5px] text-ink-muted">
                    No overall budget for this month yet.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {overall && (
                  <StatusPill tone={overall.exceeded ? 'danger' : 'positive'}>
                    {overall.exceeded
                      ? `${money(Math.abs(overall.remaining), currency)} over`
                      : `${money(overall.remaining, currency)} left`}
                  </StatusPill>
                )}
                <GhostButton size="sm" onClick={() => openEditor(null)}>
                  {overall ? 'Edit limit' : 'Set limit'}
                </GhostButton>
                {overall && (
                  <GhostButton size="sm" tone="danger" onClick={() => handleDelete(null)}>
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Remove overall budget</span>
                  </GhostButton>
                )}
              </div>
            </div>

            {overall && (
              <>
                <Meter value={overall.pct_used} exceeded={overall.exceeded} height={12} />
                <div className="flex items-center justify-between text-[12.5px] font-medium text-ink-muted">
                  <span className="tabular">{percent(overall.pct_used, 0)} used</span>
                  <span className="tabular">
                    {daysLeft > 0
                      ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in ${monthOnly}`
                      : monthLabel(year, month)}
                  </span>
                </div>
              </>
            )}
          </Panel>
        )}

        <Panel>
          <div className="flex items-center justify-between px-[22px] py-[18px]">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">
              By category
            </h2>
            <span className="text-[12.5px] font-medium text-ink-muted">
              {perCategory.length} {perCategory.length === 1 ? 'category' : 'categories'}
            </span>
          </div>

          {!status ? (
            <div className="space-y-2 px-[22px] pb-5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : perCategory.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No category budgets"
              description="Set a limit per category to see where the month is heading before it ends."
              action={
                <PrimaryButton size="sm" onClick={() => openEditor(categories[0]?.id ?? null)}>
                  <Plus className="size-4" strokeWidth={2.1} />
                  New budget
                </PrimaryButton>
              }
            />
          ) : (
            perCategory.map((row) => (
              <div
                key={row.category_id}
                className="flex flex-wrap items-center gap-5 border-t border-divider px-[22px] py-4"
              >
                <span className="flex w-[190px] shrink-0 items-center gap-2.5">
                  <CategoryDot color={row.category_color} />
                  <span className="truncate text-[14px] font-semibold text-ink-strong">
                    {row.category_name}
                  </span>
                  {row.exceeded && <OverBadge />}
                </span>

                <span className="min-w-[120px] grow">
                  <Meter
                    value={row.pct_used}
                    color={row.category_color}
                    exceeded={row.exceeded}
                    height={10}
                  />
                </span>

                <span className="tabular w-[190px] shrink-0 text-right text-[13.5px] font-medium text-ink-mid">
                  <span className="font-semibold text-ink-strong">
                    {money(row.spent, currency)}
                  </span>{' '}
                  of {money(row.budget, currency)}
                </span>

                <span
                  className={cn(
                    'tabular w-[120px] shrink-0 text-right text-[13px]',
                    row.exceeded ? 'font-semibold text-danger-strong' : 'font-medium text-ink-muted',
                  )}
                >
                  {row.exceeded
                    ? `${money(Math.abs(row.remaining), currency)} over`
                    : `${money(row.remaining, currency)} left`}
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Edit ${row.category_name} budget`}
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-ink-subtle transition-colors hover:bg-secondary hover:text-ink-mid"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <circle cx="5" cy="12" r="1" />
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="19" cy="12" r="1" />
                      </svg>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => openEditor(row.category_id)}>
                      <Pencil />
                      Edit limit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => handleDelete(row.category_id)}
                    >
                      <Trash2 />
                      Remove budget
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </Panel>
      </PageBody>

      <BudgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories}
        budgets={budgets}
        initialCategory={editingCategory}
        year={year}
        month={month}
        currency={currency}
        onSaved={load}
      />
    </>
  )
}

function BudgetDialog({
  open,
  onOpenChange,
  categories,
  budgets,
  initialCategory,
  year,
  month,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  budgets: Budget[]
  initialCategory: string
  year: number
  month: number
  currency: string
  onSaved: () => void
}) {
  const [categoryId, setCategoryId] = React.useState(initialCategory)
  const [amount, setAmount] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCategoryId(initialCategory)
  }, [open, initialCategory])

  // Show the existing limit when one is already set for the chosen target,
  // rather than a blank field.
  React.useEffect(() => {
    if (!open) return
    const target = categoryId === OVERALL ? null : categoryId
    const existing = budgets.find((b) => b.category_id === target)
    setAmount(existing ? String(existing.amount) : '')
  }, [categoryId, budgets, open])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = Number(amount)
    if (!amount || Number.isNaN(value) || value <= 0) {
      toast.error('Enter an amount greater than zero')
      return
    }

    setBusy(true)
    try {
      await setBudget({
        amount: value,
        year,
        month,
        categoryId: categoryId === OVERALL ? null : categoryId,
      })
      toast.success('Budget saved')
      onOpenChange(false)
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not save the budget')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set a budget</DialogTitle>
          <DialogDescription>
            A monthly limit for {monthLabel(year, month)}. You will be warned here and in chat when
            spending goes past it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="budget-category" className="text-[12.5px] font-semibold">
              Applies to
            </label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="budget-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OVERALL}>Overall (everything)</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="budget-amount" className="text-[12.5px] font-semibold">
              Monthly limit ({currency})
            </label>
            <input
              id="budget-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="750.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="tabular h-10 rounded-lg border border-input bg-muted px-3 text-[13.5px] font-medium outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>

          <DialogFooter>
            <GhostButton onClick={() => onOpenChange(false)}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save budget'}
            </PrimaryButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
