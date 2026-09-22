import * as React from 'react'
import { Pencil, Plus, SlidersHorizontal, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createCategory,
  deleteCategory,
  fetchBudgets,
  fetchCategories,
  fetchCategoryCounts,
  updateCategory,
  updateProfile,
} from '@/lib/api'
import { money } from '@/lib/format'
import { ConnectAssistant } from '@/components/connect-assistant'
import type { Budget, Category } from '@/lib/types'
import { useAuth, useCurrency } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import {
  CategoryDot,
  ErrorNote,
  GhostButton,
  Panel,
  PanelHead,
  PageBody,
  PageHeader,
  PrimaryButton,
  Toggle,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — Pound Sterling' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
]

/** Shared with the schema defaults, so charts and badges agree. */
const PALETTE = [
  '#2563EB',
  '#EC4899',
  '#F97316',
  '#8B5CF6',
  '#14B8A6',
  '#EAB308',
  '#06B6D4',
  '#EF4444',
]

/** The native select, restyled to the mockup's 200px control. */
function SettingSelect({
  id,
  value,
  onChange,
  children,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[38px] w-[200px] shrink-0 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-[13.5px] font-medium text-ink-strong outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
    >
      {children}
    </select>
  )
}

function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string
  description: string
  htmlFor?: string
  children: React.ReactNode
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-divider px-[22px] py-[15px]">
      <Label
        {...(htmlFor ? { htmlFor } : {})}
        className="flex min-w-0 grow flex-col gap-0.5"
      >
        <span className="text-[13.5px] font-semibold text-ink-strong">{title}</span>
        <span className="text-[12.5px] font-medium text-ink-muted">{description}</span>
      </Label>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const { profile, refreshProfile, user } = useAuth()
  const currency = useCurrency()

  const [categories, setCategories] = React.useState<Category[] | null>(null)
  const [counts, setCounts] = React.useState<Record<string, number>>({})
  const [budgets, setBudgets] = React.useState<Budget[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [categoryDialog, setCategoryDialog] = React.useState<Category | 'new' | null>(null)

  const [displayName, setDisplayName] = React.useState('')
  const [currencyCode, setCurrencyCode] = React.useState('USD')
  const [monthStart, setMonthStart] = React.useState('1')
  const [weeklyEmail, setWeeklyEmail] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const now = new Date()
      const [cats, countMap, monthBudgets] = await Promise.all([
        fetchCategories(),
        fetchCategoryCounts(),
        fetchBudgets(now.getFullYear(), now.getMonth() + 1),
      ])
      setCategories(cats)
      setCounts(countMap)
      setBudgets(monthBudgets)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load settings')
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!profile) return
    setDisplayName(profile.display_name ?? '')
    setCurrencyCode(profile.currency)
    setMonthStart(String(profile.month_start_day))
  }, [profile])

  /*
   * Preferences save as they change, like the rest of this page — categories
   * and connections already commit immediately, and a staged Save for three
   * fields meant two different models on one screen.
   *
   * The optimistic local state is kept so the control does not snap back while
   * the write is in flight; it is rolled back if the write fails.
   */
  async function savePreference(
    patch: { display_name?: string; currency?: string; month_start_day?: number },
    rollback: () => void,
  ) {
    try {
      await updateProfile(patch)
      await refreshProfile()
      // Quiet, but present: without it an instant save is indistinguishable
      // from nothing having happened.
      toast.success('Saved')
    } catch (cause) {
      rollback()
      toast.error(cause instanceof Error ? cause.message : 'Could not save that change')
    }
  }

  /** Free text should not write on every keystroke — commit on blur instead. */
  function commitDisplayName() {
    const next = displayName.trim()
    const current = profile?.display_name ?? ''
    if (next === current) return
    void savePreference({ display_name: next }, () => setDisplayName(current))
  }

  async function handleDeleteCategory(category: Category) {
    const count = counts[category.id] ?? 0
    const message =
      count > 0
        ? `Delete "${category.name}"? Its ${count} ${count === 1 ? 'expense becomes' : 'expenses become'} Uncategorized.`
        : `Delete "${category.name}"?`
    if (!window.confirm(message)) return

    try {
      await deleteCategory(category.id)
      toast.success('Category deleted')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete the category')
    }
  }

  return (
    <>
      <PageHeader title="Settings" />

      <PageBody width="narrow">
        {error && <ErrorNote message={error} />}

        <ConnectAssistant />

        <Panel>
          <PanelHead
            icon={Tag}
            tint="#8B5CF6"
            title="Categories"
            description="Each category keeps its colour everywhere — charts, badges and budget bars."
            action={
              <GhostButton size="sm" onClick={() => setCategoryDialog('new')}>
                <Plus className="size-[15px] text-ink-muted" strokeWidth={2.1} />
                Add category
              </GhostButton>
            }
          />

          {!categories ? (
            <div className="space-y-2 px-[22px] pb-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : (
            categories.map((category) => {
              const budget = budgets.find((b) => b.category_id === category.id)
              const count = counts[category.id] ?? 0
              return (
                <div
                  key={category.id}
                  className="flex flex-wrap items-center gap-4 border-t border-divider px-[22px] py-[13px]"
                >
                  <CategoryDot color={category.color} />
                  <span className="min-w-0 grow truncate text-[13.5px] font-semibold text-ink-strong">
                    {category.name}
                  </span>
                  <span className="tabular w-[170px] shrink-0 text-[13px] font-medium text-ink-muted">
                    {budget ? `${money(budget.amount, currency)} monthly limit` : 'No limit set'}
                  </span>
                  <span className="tabular w-[110px] shrink-0 text-right text-[13px] font-medium text-ink-muted">
                    {count} {count === 1 ? 'expense' : 'expenses'}
                  </span>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Edit ${category.name}`}
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
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onSelect={() => setCategoryDialog(category)}>
                        <Pencil />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => handleDeleteCategory(category)}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })
          )}
        </Panel>

        <Panel>
          <PanelHead
            icon={SlidersHorizontal}
            tint="#14B8A6"
            title="Preferences"
            description="How amounts are shown and when your month rolls over."
          />

          <SettingRow
            title="Display name"
            description="Shown in the sidebar and used by your assistant."
            htmlFor="pref-name"
          >
            <input
              id="pref-name"
              value={displayName}
              placeholder={user?.email?.split('@')[0] ?? 'Your name'}
              onChange={(event) => setDisplayName(event.target.value)}
              onBlur={commitDisplayName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              className="h-[38px] w-[200px] shrink-0 rounded-lg border border-border bg-card px-2.5 text-[13.5px] font-medium text-ink-strong outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </SettingRow>

          <SettingRow
            title="Currency"
            description="Used for every amount and budget."
            htmlFor="pref-currency"
          >
            <SettingSelect
              id="pref-currency"
              value={currencyCode}
              onChange={(next) => {
                const previous = currencyCode
                setCurrencyCode(next)
                void savePreference({ currency: next }, () => setCurrencyCode(previous))
              }}
            >
              {CURRENCIES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </SettingSelect>
          </SettingRow>

          <SettingRow
            title="Budget month starts on"
            description="Set this to your payday if your month does not start on the 1st."
            htmlFor="pref-start"
          >
            <SettingSelect
              id="pref-start"
              value={monthStart}
              onChange={(next) => {
                const previous = monthStart
                setMonthStart(next)
                void savePreference({ month_start_day: Number(next) }, () => setMonthStart(previous))
              }}
            >
              {[1, 5, 10, 15, 20, 25, 28].map((day) => (
                <option key={day} value={String(day)}>
                  Day {day}
                </option>
              ))}
            </SettingSelect>
          </SettingRow>

          <SettingRow
            title="Weekly email summary"
            description="A Monday recap of what you spent and what is left."
          >
            <Toggle
              checked={weeklyEmail}
              onCheckedChange={(next) => {
                setWeeklyEmail(next)
                // Nothing sends mail yet; say so rather than pretend it saved.
                toast.message('Email summaries are not wired up yet.')
              }}
              label="Weekly email summary"
            />
          </SettingRow>
        </Panel>
      </PageBody>

      <CategoryDialog
        value={categoryDialog}
        onClose={() => setCategoryDialog(null)}
        onSaved={load}
      />
    </>
  )
}

function CategoryDialog({
  value,
  onClose,
  onSaved,
}: {
  value: Category | 'new' | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = value !== null && value !== 'new' ? value : null
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(PALETTE[0]!)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!value) return
    setName(editing?.name ?? '')
    setColor(editing?.color ?? PALETTE[0]!)
  }, [value, editing])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error('Give the category a name')
      return
    }

    setBusy(true)
    try {
      if (editing) await updateCategory(editing.id, { name: name.trim(), color })
      else await createCategory({ name: name.trim(), color })
      toast.success(editing ? 'Category updated' : 'Category created')
      onClose()
      onSaved()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save the category'
      // The unique index is what stops near-duplicate buckets; say so plainly.
      toast.error(
        message.includes('categories_user_name_key')
          ? 'You already have a category with that name.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="category-name" className="text-[12.5px] font-semibold">
              Name
            </label>
            <input
              id="category-name"
              value={name}
              placeholder="Groceries"
              onChange={(event) => setName(event.target.value)}
              className="h-10 rounded-lg border border-input bg-muted px-3 text-[13.5px] font-medium outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>

          <div className="grid gap-2">
            <span className="text-[12.5px] font-semibold">Colour</span>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Use colour ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                  className={cn(
                    'size-7 cursor-pointer rounded-full ring-offset-2 ring-offset-card transition-shadow',
                    color === option && 'ring-2 ring-foreground',
                  )}
                  style={{ background: option }}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
            </PrimaryButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
