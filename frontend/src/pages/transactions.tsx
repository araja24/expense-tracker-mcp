import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  ChevronsUpDown,
  Download,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteExpenses,
  fetchAllExpenses,
  fetchCategories,
  fetchExpenses,
  recategorizeExpenses,
} from '@/lib/api'
import { downloadCsv, expensesToCsv } from '@/lib/csv'
import { longDate, money } from '@/lib/format'
import type { Category, Expense, ExpenseFilters } from '@/lib/types'
import { useCurrency } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { ExpenseDialog } from '@/components/expense-dialog'
import {
  CategoryPill,
  EmptyState,
  ErrorNote,
  GhostButton,
  Panel,
  PageBody,
  PageHeader,
  PrimaryButton,
  SelectButton,
} from '@/components/tally'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 10
const UNCATEGORIZED = '__none__'

export function TransactionsPage() {
  const currency = useCurrency()
  const [searchParams, setSearchParams] = useSearchParams()

  const [categories, setCategories] = React.useState<Category[]>([])
  const [expenses, setExpenses] = React.useState<Expense[] | null>(null)
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<Expense | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const [searchInput, setSearchInput] = React.useState(searchParams.get('q') ?? '')
  const [search, setSearch] = React.useState(searchInput)
  const [categoryId, setCategoryId] = React.useState<string | null>(searchParams.get('category'))
  const [from, setFrom] = React.useState(searchParams.get('from') ?? '')
  const [to, setTo] = React.useState(searchParams.get('to') ?? '')
  const [minAmount, setMinAmount] = React.useState(searchParams.get('min') ?? '')
  const [maxAmount, setMaxAmount] = React.useState(searchParams.get('max') ?? '')

  // Debounced so typing does not fire a query per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  const filters = React.useMemo<ExpenseFilters>(
    () => ({
      categoryId: categoryId === null ? undefined : categoryId === UNCATEGORIZED ? null : categoryId,
      from: from || undefined,
      to: to || undefined,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      search: search || undefined,
    }),
    [categoryId, from, to, minAmount, maxAmount, search],
  )

  // Keep the URL in step, so a filtered view can be linked or reloaded.
  React.useEffect(() => {
    const next = new URLSearchParams()
    if (search) next.set('q', search)
    if (categoryId) next.set('category', categoryId)
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (minAmount) next.set('min', minAmount)
    if (maxAmount) next.set('max', maxAmount)
    setSearchParams(next, { replace: true })
  }, [search, categoryId, from, to, minAmount, maxAmount, setSearchParams])

  React.useEffect(() => {
    setPage(0)
  }, [filters])

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [cats, result] = await Promise.all([
        fetchCategories(),
        fetchExpenses(filters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      ])
      setCategories(cats)
      setExpenses(result.expenses)
      setTotal(result.total)
      // Drop selections that are no longer on screen.
      setSelected((current) => {
        const visible = new Set(result.expenses.map((e) => e.id))
        return new Set([...current].filter((id) => visible.has(id)))
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load transactions')
    }
  }, [filters, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const dateLabel = rangeLabel(from, to)

  const categoryLabel =
    categoryId === null
      ? 'Category'
      : categoryId === UNCATEGORIZED
        ? 'Uncategorized'
        : (categories.find((c) => c.id === categoryId)?.name ?? 'Category')

  const chips = [
    search && { key: 'q', label: `"${search}"`, clear: () => { setSearchInput(''); setSearch('') } },
    categoryId && { key: 'category', label: categoryLabel, clear: () => setCategoryId(null) },
    (from || to) && { key: 'dates', label: dateLabel, clear: () => { setFrom(''); setTo('') } },
    (minAmount || maxAmount) && {
      key: 'amount',
      label: `${minAmount ? money(Number(minAmount), currency) : 'any'} – ${maxAmount ? money(Number(maxAmount), currency) : 'any'}`,
      clear: () => { setMinAmount(''); setMaxAmount('') },
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  function clearAll() {
    setSearchInput('')
    setSearch('')
    setCategoryId(null)
    setFrom('')
    setTo('')
    setMinAmount('')
    setMaxAmount('')
  }

  const allSelected = Boolean(expenses?.length) && selected.size === expenses?.length

  function toggleAll() {
    if (!expenses) return
    setSelected(allSelected ? new Set() : new Set(expenses.map((e) => e.id)))
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Passing null exports everything the filters describe, not just this page. */
  async function exportRows(rows: Expense[] | null) {
    try {
      const data = rows ?? (await fetchAllExpenses(filters))
      if (data.length === 0) {
        toast.error('Nothing to export with these filters')
        return
      }
      downloadCsv(`tally-expenses-${new Date().toISOString().slice(0, 10)}.csv`, expensesToCsv(data))
      toast.success(`Exported ${data.length} ${data.length === 1 ? 'expense' : 'expenses'}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Export failed')
    }
  }

  async function removeExpenses(ids: string[], confirmMessage: string) {
    if (ids.length === 0) return
    if (!window.confirm(confirmMessage)) return
    try {
      await deleteExpenses(ids)
      toast.success(`Deleted ${ids.length}`)
      setSelected(new Set())
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete')
    }
  }

  async function bulkRecategorize(value: string) {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      await recategorizeExpenses(ids, value === UNCATEGORIZED ? null : value)
      toast.success(`Moved ${ids.length} ${ids.length === 1 ? 'expense' : 'expenses'}`)
      setSelected(new Set())
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not change category')
    }
  }

  const start = total === 0 ? 0 : page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <>
      <PageHeader title="Transactions">
        <SelectButton>{dateLabel}</SelectButton>
        <PrimaryButton
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-4" strokeWidth={2.1} />
          Add expense
        </PrimaryButton>
      </PageHeader>

      <PageBody>
        {error && <ErrorNote message={error} />}

        <Panel className="gap-3.5 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangeMenu
              from={from}
              to={to}
              onChange={(nextFrom, nextTo) => {
                setFrom(nextFrom)
                setTo(nextTo)
              }}
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SelectButton icon={Tag} count={categoryId ? 1 : 0}>
                  {categoryLabel}
                </SelectButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onSelect={() => setCategoryId(null)}>
                  All categories
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCategoryId(UNCATEGORIZED)}>
                  Uncategorized
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {categories.map((category) => (
                  <DropdownMenuItem key={category.id} onSelect={() => setCategoryId(category.id)}>
                    <span
                      className="size-[7px] rounded-[2px]"
                      style={{ background: category.color }}
                    />
                    {category.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5">
              <label htmlFor="tx-min" className="text-[13px] font-medium text-ink-muted">
                $
              </label>
              <input
                id="tx-min"
                type="number"
                min="0"
                placeholder="0"
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
                className="tabular w-11 border-0 bg-transparent text-[13.5px] font-medium text-ink-strong outline-none"
              />
              <span className="text-[13px] font-medium text-ink-subtle">–</span>
              <label htmlFor="tx-max" className="sr-only">
                Maximum amount
              </label>
              <input
                id="tx-max"
                type="number"
                min="0"
                placeholder="any"
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
                className="tabular w-12 border-0 bg-transparent text-[13.5px] font-medium text-ink-strong outline-none"
              />
            </div>

            <div className="flex h-10 min-w-0 grow items-center gap-2 rounded-lg border border-border bg-muted px-3">
              <Search className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.9} />
              <label htmlFor="tx-merchant" className="sr-only">
                Search merchant
              </label>
              <input
                id="tx-merchant"
                type="text"
                placeholder="Search merchant or description"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="min-w-0 grow border-0 bg-transparent text-[13.5px] font-medium text-ink-strong outline-none placeholder:text-ink-subtle"
              />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-0.5 text-[12.5px] font-medium text-ink-muted">Filters</span>
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card pl-2.5 pr-1.5 text-[12.5px] font-medium text-ink-mid"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label} filter`}
                    className="flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-background text-ink-muted hover:text-ink-strong"
                  >
                    <X className="size-[11px]" strokeWidth={2.6} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="cursor-pointer px-1 text-[12.5px] font-semibold text-primary hover:text-primary-hover"
              >
                Clear all
              </button>
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">
                All expenses
              </h2>
              <span className="tabular text-[13px] font-medium text-ink-muted">
                {total} {total === 1 ? 'result' : 'results'}
              </span>
            </div>
            <GhostButton size="sm" onClick={() => exportRows(null)}>
              <Download className="size-[15px] text-ink-muted" strokeWidth={1.85} />
              Export CSV
            </GhostButton>
          </div>

          {selected.size > 0 && (
            <div className="px-5 pb-3.5">
              <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-[10px] border border-blue-100 bg-primary-tint px-3.5 py-2">
                <span className="tabular text-[13px] font-semibold text-accent-foreground">
                  {selected.size} selected
                </span>
                <span className="h-5 w-px bg-blue-100" aria-hidden />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-blue-100 bg-card px-2.5 text-[12.5px] font-medium text-accent-foreground hover:bg-secondary"
                    >
                      <Tag className="size-3.5" strokeWidth={1.9} />
                      Change category
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuLabel>Move to</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => bulkRecategorize(UNCATEGORIZED)}>
                      Uncategorized
                    </DropdownMenuItem>
                    {categories.map((category) => (
                      <DropdownMenuItem
                        key={category.id}
                        onSelect={() => bulkRecategorize(category.id)}
                      >
                        <span
                          className="size-[7px] rounded-[2px]"
                          style={{ background: category.color }}
                        />
                        {category.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  type="button"
                  onClick={() =>
                    exportRows((expenses ?? []).filter((expense) => selected.has(expense.id)))
                  }
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-blue-100 bg-card px-2.5 text-[12.5px] font-medium text-accent-foreground hover:bg-secondary"
                >
                  <Download className="size-3.5" strokeWidth={1.9} />
                  Export
                </button>

                <button
                  type="button"
                  onClick={() =>
                    removeExpenses(
                      [...selected],
                      `Delete ${selected.size} ${selected.size === 1 ? 'expense' : 'expenses'}? This cannot be undone.`,
                    )
                  }
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-danger-border bg-card px-2.5 text-[12.5px] font-medium text-danger-strong hover:bg-danger-tint"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.9} />
                  Delete
                </button>

                <span className="grow" />
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer text-[12.5px] font-semibold text-accent-foreground"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="flex h-11 shrink-0 items-center gap-4 border-y border-border bg-muted px-5 text-[12px] font-semibold text-ink-label">
            <span className="flex w-[18px] shrink-0 items-center">
              <input
                id="tx-all"
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all expenses"
                className="size-4 cursor-pointer accent-[var(--primary)]"
              />
            </span>
            <span className="inline-flex w-24 shrink-0 items-center gap-1">
              Date
              <ChevronsUpDown className="size-[13px] text-ink-subtle" strokeWidth={2} />
            </span>
            <span className="min-w-0 grow">Description</span>
            <span className="hidden w-[150px] shrink-0 sm:block">Category</span>
            <span className="inline-flex w-[120px] shrink-0 items-center justify-end gap-1 text-right">
              Amount
              <ChevronsUpDown className="size-[13px] text-ink-subtle" strokeWidth={2} />
            </span>
            <span className="w-9 shrink-0" />
          </div>

          {!expenses ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <EmptyState
              title="No expenses found"
              description={
                chips.length > 0
                  ? 'Nothing matches these filters. Try clearing one.'
                  : 'Add your first expense, or tell your assistant what you bought.'
              }
              action={
                chips.length > 0 ? (
                  <GhostButton size="sm" onClick={clearAll}>
                    Clear filters
                  </GhostButton>
                ) : (
                  <PrimaryButton
                    size="sm"
                    onClick={() => {
                      setEditing(null)
                      setDialogOpen(true)
                    }}
                  >
                    <Plus className="size-4" strokeWidth={2.1} />
                    Add expense
                  </PrimaryButton>
                )
              }
            />
          ) : (
            expenses.map((expense) => {
              const checked = selected.has(expense.id)
              return (
                <div
                  key={expense.id}
                  className={cn(
                    'flex items-center gap-4 border-b border-divider px-5 py-[13px]',
                    checked && 'bg-muted',
                  )}
                >
                  <span className="flex w-[18px] shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(expense.id)}
                      aria-label={`Select ${expense.description}`}
                      className="size-4 cursor-pointer accent-[var(--primary)]"
                    />
                  </span>
                  <span className="tabular w-24 shrink-0 text-[13px] font-medium text-ink-label">
                    {longDate(expense.expense_date)}
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-semibold text-ink-strong">
                      {expense.description}
                    </span>
                    <span className="truncate text-[12px] font-medium text-ink-muted">
                      {expense.source === 'ai' ? 'Logged via chat' : 'Added manually'}
                      {expense.notes ? ` · ${expense.notes}` : ''}
                    </span>
                  </span>
                  <span className="hidden w-[150px] shrink-0 sm:block">
                    <CategoryPill
                      name={expense.categories?.name}
                      color={expense.categories?.color}
                    />
                  </span>
                  <span className="tabular w-[120px] shrink-0 text-right text-[14px] font-semibold text-ink-strong">
                    {money(expense.amount, currency)}
                  </span>
                  <span className="flex w-9 shrink-0 justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${expense.description}`}
                          className="flex size-8 cursor-pointer items-center justify-center rounded-[7px] text-ink-subtle transition-colors hover:bg-secondary hover:text-ink-mid"
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
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(expense)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            removeExpenses([expense.id], `Delete "${expense.description}"?`)
                          }
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              )
            })
          )}

          {total > 0 && (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="tabular text-[12.5px] font-medium text-ink-muted">
                Showing {start}–{end} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                  className="h-[34px] cursor-pointer rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-ink-mid hover:bg-secondary disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-card"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={end >= total}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-[34px] cursor-pointer rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-ink-mid hover:bg-secondary disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-card"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Panel>
      </PageBody>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        categories={categories}
        expense={editing}
        onSaved={load}
      />
    </>
  )
}

function rangeLabel(from: string, to: string): string {
  if (from && to) return `${longDate(from)} – ${longDate(to)}`
  if (from) return `From ${longDate(from)}`
  if (to) return `Until ${longDate(to)}`
  return 'Any date'
}

/** The date pill opens a small two-field popover rather than a full calendar. */
function DateRangeMenu({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectButton icon={CalendarDays}>{rangeLabel(from, to)}</SelectButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-3">
        <div className="grid gap-2.5">
          <label className="grid gap-1 text-[12.5px] font-semibold text-ink-strong">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => onChange(event.target.value, to)}
              className="h-9 rounded-lg border border-border bg-muted px-2.5 text-[13px] font-medium outline-none"
            />
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-ink-strong">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => onChange(from, event.target.value)}
              className="h-9 rounded-lg border border-border bg-muted px-2.5 text-[13px] font-medium outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="cursor-pointer text-left text-[12.5px] font-semibold text-primary hover:text-primary-hover"
          >
            Clear dates
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
