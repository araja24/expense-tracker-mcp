/**
 * Every category in the mockups appears as a trio: a saturated dot, a very
 * light tinted pill background, and a darkened label colour — e.g. Dining is
 * `#F97316` / `#FFF7ED` / `#C2410C`.
 *
 * Categories here are user-defined, so those pairs cannot be a fixed lookup.
 * They are derived from the stored hex instead, which reproduces the mockup's
 * pairs closely and keeps the relationship for any colour a user picks.
 */

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(Math.min(Math.max(n, 0), 255))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function mix(color: Rgb, target: Rgb, weight: number): Rgb {
  return {
    r: color.r + (target.r - color.r) * weight,
    g: color.g + (target.g - color.g) * weight,
    b: color.b + (target.b - color.b) * weight,
  }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const NEUTRAL: CategoryStyle = {
  dot: '#A1A1AA',
  bg: '#F4F4F5',
  fg: '#52525B',
}

export interface CategoryStyle {
  /** The saturated colour: dots, bars, donut segments. */
  dot: string
  /** Pill background — the colour at ~6% over white. */
  bg: string
  /** Pill text — the colour darkened enough to read on `bg`. */
  fg: string
}

export function categoryStyle(color: string | null | undefined): CategoryStyle {
  const rgb = color ? parseHex(color) : null
  if (!rgb) return NEUTRAL

  return {
    dot: toHex(rgb),
    bg: toHex(mix(rgb, WHITE, 0.94)),
    fg: toHex(mix(rgb, BLACK, 0.22)),
  }
}
