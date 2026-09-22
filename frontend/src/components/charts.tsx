import { categoryStyle } from '@/lib/category-style'
import { money, moneyShort } from '@/lib/format'

/**
 * Both charts are drawn by hand rather than through a charting library: the
 * mockups specify exact bar widths, corner radii, gridline colours and label
 * chips, and reproducing that through a library's theming layer is more work
 * than drawing it — and drifts the moment the library restyles anything.
 */

// ------------------------------------------------------------------ bar chart

const PLOT_HEIGHT = 330
const GRID_LINES = 5

/** Round a maximum up to a clean axis top, so the labels read $1k/$2k/$3k. */
function axisMax(highest: number): number {
  if (highest <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(highest))
  const step = magnitude / 2
  return Math.max(Math.ceil(highest / step) * step, step)
}

export function SpendingBars({
  data,
  currency,
}: {
  data: { period: string; total: number }[]
  currency: string
}) {
  const max = axisMax(Math.max(...data.map((row) => row.total), 0))

  // Top gridline down to zero, matching the mockup's five labels.
  const ticks = Array.from({ length: GRID_LINES }, (_, index) => max - (max / (GRID_LINES - 1)) * index)

  const bars = data.map((row, index) => {
    const date = new Date(`${row.period}T00:00:00`)
    return {
      key: row.period,
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      total: row.total,
      height: max > 0 ? Math.round((row.total / max) * PLOT_HEIGHT) : 0,
      current: index === data.length - 1,
    }
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-3">
        <div
          className="tabular flex w-[30px] shrink-0 flex-col items-end justify-between text-[11.5px] font-medium text-ink-subtle"
          style={{ height: PLOT_HEIGHT }}
          aria-hidden
        >
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1.5">
              {moneyShort(tick, currency)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 grow" style={{ height: PLOT_HEIGHT }}>
          <div className="absolute inset-0 flex flex-col justify-between" aria-hidden>
            {ticks.map((tick, index) => (
              <div
                key={tick}
                className="h-px"
                // The baseline is a touch darker than the rules above it.
                style={{ background: index === ticks.length - 1 ? 'var(--border)' : 'var(--divider)' }}
              />
            ))}
          </div>

          <div className="absolute inset-0 flex items-end gap-6">
            {bars.map((bar) => (
              <div
                key={bar.key}
                className="flex shrink grow basis-0 flex-col items-center gap-2"
                title={`${bar.label}: ${money(bar.total, currency)}`}
              >
                {bar.current && (
                  <span className="tabular whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[12px] font-semibold text-ink-strong">
                    {money(bar.total, currency, { maximumFractionDigits: 0 })}
                  </span>
                )}
                <div
                  className="w-full max-w-[54px] rounded-t-md"
                  style={{
                    height: Math.max(bar.height, bar.total > 0 ? 2 : 0),
                    // Past months recede; the month being asked about is solid.
                    background: bar.current ? 'var(--primary)' : 'var(--blue-100)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="w-[30px] shrink-0" />
        <div className="flex min-w-0 grow gap-6 text-[12px] font-medium text-ink-muted">
          {bars.map((bar) => (
            <span
              key={bar.key}
              className={
                bar.current
                  ? 'shrink grow basis-0 text-center font-semibold text-ink-strong'
                  : 'shrink grow basis-0 text-center'
              }
            >
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- donut

const SIZE = 184
const RADIUS = 70
const STROKE = 22
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** A hairline of surface between segments, as in the mockup. */
const GAP = 3

export function CategoryDonut({
  slices,
  total,
  currency,
}: {
  slices: { id: string; name: string; color: string; total: number }[]
  total: number
  currency: string
}) {
  let offset = 0

  const segments = slices.map((slice) => {
    const share = total > 0 ? slice.total / total : 0
    const length = Math.max(share * CIRCUMFERENCE - GAP, 0)
    const segment = {
      ...slice,
      length,
      // Negative offsets advance clockwise from the 12 o'clock start.
      dashOffset: -offset,
    }
    offset += share * CIRCUMFERENCE
    return segment
  })

  return (
    <div className="relative self-center" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Spending by category donut chart"
      >
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} fill="none" strokeLinecap="butt" strokeWidth={STROKE}>
          {total === 0 ? (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="var(--divider)" />
          ) : (
            segments.map((segment) => (
              <circle
                key={segment.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                stroke={categoryStyle(segment.color).dot}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
                strokeDashoffset={segment.dashOffset}
              >
                <title>{`${segment.name}: ${money(segment.total, currency)}`}</title>
              </circle>
            ))
          )}
        </g>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3px]">
        <span className="text-[12px] font-medium text-ink-muted">Total</span>
        <span className="tabular text-[21px] font-semibold tracking-[-0.02em] text-ink-strong">
          {money(total, currency)}
        </span>
      </div>
    </div>
  )
}
