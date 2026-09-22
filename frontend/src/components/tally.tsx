import * as React from 'react'
import {
  Car,
  ChevronDown,
  CalendarDays,
  Coffee,
  CreditCard,
  Home,
  MessageSquare,
  Plane,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Utensils,
  Zap,
} from 'lucide-react'
import { categoryStyle } from '@/lib/category-style'
import { cn } from '@/lib/utils'

/** Lucide icons, as consumed here: sized by class, tinted by inline style. */
type IconComponent = React.ComponentType<{
  className?: string
  strokeWidth?: number
  style?: React.CSSProperties
}>

/**
 * The building blocks the mockups are made of. Sizes, colours and radii here
 * are transcribed from the design rather than approximated, so the pages that
 * compose them come out pixel-faithful.
 */

// ---------------------------------------------------------------- page header

/** The 64px white bar across the top of every screen. */
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-6">
      <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-ink-strong">{title}</h1>
      <div className="flex items-center gap-2.5">{children}</div>
    </header>
  )
}

export function PageBody({
  children,
  width = 'wide',
}: {
  children: React.ReactNode
  width?: 'wide' | 'narrow'
}) {
  return (
    <main className="min-h-0 grow bg-background p-6">
      <div
        className={cn(
          'flex flex-col gap-6',
          width === 'wide' ? 'mx-auto max-w-[1400px]' : 'max-w-[920px]',
        )}
      >
        {children}
      </div>
    </main>
  )
}

// --------------------------------------------------------------------- buttons

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

export function GhostButton({
  className,
  size = 'md',
  tone = 'default',
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'md' | 'sm' | 'xs'
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      className={cn(
        BUTTON_BASE,
        'border-border bg-card hover:bg-secondary',
        size === 'md' && 'h-10 px-3 text-[13.5px]',
        size === 'sm' && 'h-9 px-3 text-[13px]',
        size === 'xs' && 'h-8 px-2.5 text-[12.5px]',
        tone === 'danger' ? 'text-danger-strong' : 'text-ink-mid',
        className,
      )}
      {...props}
    />
  )
}

export function PrimaryButton({
  className,
  size = 'md',
  ...props
}: React.ComponentProps<'button'> & { size?: 'md' | 'sm' }) {
  return (
    <button
      type="button"
      className={cn(
        BUTTON_BASE,
        'border-primary bg-primary font-semibold text-primary-foreground hover:border-primary-hover hover:bg-primary-hover',
        size === 'md' ? 'h-10 gap-[7px] px-3.5 text-[13.5px]' : 'h-9 gap-[7px] px-3 text-[13px]',
        className,
      )}
      {...props}
    />
  )
}

/** The outlined pill in the header: icon, label, chevron. */
export function SelectButton({
  icon: Icon = CalendarDays,
  children,
  count,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  icon?: IconComponent
  count?: number
}) {
  return (
    <button
      type="button"
      className={cn(
        BUTTON_BASE,
        'h-10 whitespace-nowrap border-border bg-card px-3 text-[13.5px] text-ink-mid hover:bg-secondary',
        className,
      )}
      {...props}
    >
      <Icon className="size-4 text-ink-muted" strokeWidth={1.75} />
      {children}
      {count !== undefined && count > 0 && (
        <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-primary-tint px-[5px] text-[11px] font-semibold text-accent-foreground">
          {count}
        </span>
      )}
      <ChevronDown className="size-[15px] text-ink-subtle" strokeWidth={2} />
    </button>
  )
}

// ---------------------------------------------------------------------- panels

/** The white 12px-radius card every section sits in. */
export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <section
      className={cn('flex flex-col rounded-xl border border-border bg-card', className)}
      {...props}
    />
  )
}

/** Panel heading with the 36px tinted icon tile, title, blurb and an action. */
export function PanelHead({
  icon: Icon,
  tint,
  title,
  titleBadge,
  description,
  action,
  className,
}: {
  icon?: IconComponent
  /** Hex for the icon tile; the tile background is derived from it. */
  tint?: string
  title: string
  /** Small pill beside the title, e.g. the protocol a panel is about. */
  titleBadge?: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const style = categoryStyle(tint ?? '#2563EB')

  return (
    <div className={cn('flex items-start gap-3.5 px-[22px] py-5', className)}>
      {Icon && (
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: style.bg }}
        >
          <Icon className="size-[18px]" strokeWidth={1.85} style={{ color: style.dot }} />
        </span>
      )}
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">{title}</h2>
          {titleBadge && (
            <span className="rounded-md bg-primary-tint px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
              {titleBadge}
            </span>
          )}
        </div>
        {description && (
          <p className="max-w-[560px] text-[13px] font-medium leading-[1.55] text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

/** Lighter heading used on the dashboard cards: title over a small subtitle. */
export function CardHeading({
  title,
  subtitle,
  action,
  className,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex flex-col gap-[3px]">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-strong">{title}</h2>
        {subtitle && <span className="text-[12.5px] font-medium text-ink-muted">{subtitle}</span>}
      </div>
      {action}
    </div>
  )
}

// ------------------------------------------------------------------- category

const ICONS: Record<string, IconComponent> = {
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  utensils: Utensils,
  coffee: Coffee,
  car: Car,
  plane: Plane,
  zap: Zap,
  home: Home,
  'credit-card': CreditCard,
  receipt: Receipt,
  message: MessageSquare,
  tag: Tag,
}

export function categoryIcon(icon: string | null | undefined) {
  return ICONS[icon ?? 'tag'] ?? Tag
}

/** The tinted pill with a 7px rounded-square dot. */
export function CategoryPill({
  name,
  color,
  className,
}: {
  name: string | null | undefined
  color: string | null | undefined
  className?: string
}) {
  const style = categoryStyle(color)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-[9px] py-1 text-[12px] font-medium',
        className,
      )}
      style={{ background: style.bg, color: style.fg }}
    >
      <span
        className="size-[7px] shrink-0 rounded-[2px]"
        style={{ background: style.dot }}
        aria-hidden
      />
      {name ?? 'Uncategorized'}
    </span>
  )
}

/** The 34px rounded icon tile beside each recent transaction. */
export function CategoryIconTile({
  icon,
  color,
  className,
}: {
  icon: string | null | undefined
  color: string | null | undefined
  className?: string
}) {
  const style = categoryStyle(color)
  const Icon = categoryIcon(icon)
  return (
    <span
      className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-[9px]', className)}
      style={{ background: style.bg }}
      aria-hidden
    >
      <Icon className="size-4" strokeWidth={1.85} style={{ color: style.dot }} />
    </span>
  )
}

/** The small square dot used in lists and legends. */
export function CategoryDot({ color, size = 10 }: { color: string | null | undefined; size?: number }) {
  return (
    <span
      className="shrink-0 rounded-[3px]"
      style={{ background: categoryStyle(color).dot, width: size, height: size }}
      aria-hidden
    />
  )
}

// ---------------------------------------------------------------------- meters

/** Budget bar: category-coloured, or red once the budget is blown. */
export function Meter({
  value,
  color,
  exceeded,
  height = 8,
}: {
  value: number
  color?: string | null
  exceeded?: boolean
  height?: number
}) {
  return (
    <span
      className="block w-full overflow-hidden rounded-full bg-divider"
      style={{ height }}
      role="presentation"
    >
      <span
        className="block rounded-full transition-[width]"
        style={{
          width: `${Math.min(Math.max(value, 0), 100)}%`,
          height,
          background: exceeded ? 'var(--danger-strong)' : (categoryStyle(color).dot ?? 'var(--primary)'),
        }}
      />
    </span>
  )
}

// --------------------------------------------------------------------- toggle

export function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        checked ? 'justify-end bg-primary' : 'justify-start bg-border',
      )}
    >
      <span className="block size-5 rounded-full bg-white shadow-sm" />
    </button>
  )
}

// ------------------------------------------------------------------ feedback

export function StatusPill({
  tone,
  children,
}: {
  tone: 'positive' | 'danger'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'tabular inline-flex items-center rounded-[7px] px-[11px] py-[7px] text-[13px] font-semibold',
        tone === 'positive'
          ? 'bg-positive-tint text-positive-strong'
          : 'bg-danger-tint text-danger-strong',
      )}
    >
      {children}
    </span>
  )
}

export function OverBadge() {
  return (
    <span className="rounded-[5px] bg-danger-tint px-[7px] py-[3px] text-[11.5px] font-semibold text-danger-strong">
      Over
    </span>
  )
}

export function EmptyState({
  icon: Icon = Receipt,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-ink-subtle" />
      </span>
      <div className="space-y-1">
        <p className="text-[14px] font-semibold text-ink-strong">{title}</p>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>
      </div>
      {action}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-[13px] text-danger-strong">
      {message}
    </div>
  )
}
