import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthLabel } from '@/lib/format'

/** Previous / next month stepper shared by the pages that scope data to a month. */
export function MonthSwitcher({
  year,
  month,
  onChange,
}: {
  year: number
  month: number
  onChange: (year: number, month: number) => void
}) {
  function shift(by: number) {
    const next = new Date(year, month - 1 + by, 1)
    onChange(next.getFullYear(), next.getMonth() + 1)
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => shift(-1)}
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
        onClick={() => shift(1)}
        aria-label="Next month"
        className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-ink-mid hover:bg-secondary"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
