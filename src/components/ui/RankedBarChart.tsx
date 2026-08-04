import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer } from 'recharts'

// Shared single-value ranked bar chart: shrink-to-fit sizing (always fits in
// one screen, no scrolling), truncated Y-axis labels, and a plain HTML
// click-overlay per row (recharts' own Bar onClick only registers on the
// bar's own rendered rectangle, which is unusably thin for near-zero
// values — see Fund Accounts chart fix). Caller supplies already-
// bucketed items (e.g. with a synthetic "Other (N)" row folded in).

const NORMAL_ROW_HEIGHT = 34
const MIN_ROW_HEIGHT     = 18
const MAX_CHART_HEIGHT   = 420
export const RANKED_CHART_MAX_ROWS = Math.floor(MAX_CHART_HEIGHT / MIN_ROW_HEIGHT)

const Y_AXIS_LABEL_MAX_CHARS = 16

function CategoryAxisTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
  const name = payload.value
  const truncated = name.length > Y_AXIS_LABEL_MAX_CHARS ? `${name.slice(0, Y_AXIS_LABEL_MAX_CHARS - 1)}…` : name
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#374151">
      {truncated}
      {truncated !== name && <title>{name}</title>}
    </text>
  )
}

export interface RankedBarItem {
  name:  string
  value: number
  muted?: boolean   // true for an aggregated "Other" row — rendered in a neutral color
}

interface RankedBarChartProps {
  items:      RankedBarItem[]
  color:      string
  mutedColor?: string
  activeName: string | null
  onSelect:   (name: string) => void
}

export function RankedBarChart({ items, color, mutedColor = '#94a3b8', activeName, onSelect }: RankedBarChartProps) {
  const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.min(NORMAL_ROW_HEIGHT, MAX_CHART_HEIGHT / Math.max(1, items.length)))

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={rowHeight * items.length}>
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
          {/* Hidden — a visible tick strip would eat vertical space from the
              plot area, throwing off the overlay's row-height math below. */}
          <XAxis type="number" hide />
          {/* interval={0} forces every row's label to render — recharts'
              default auto-skips category ticks it guesses will collide once
              rows get this thin, even though each has its own legible slot. */}
          <YAxis type="category" dataKey="name" width={110} interval={0} tick={<CategoryAxisTick x={0} y={0} payload={{ value: '' }} />} axisLine={false} tickLine={false} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {items.map(row => (
              <Cell
                key={row.name}
                fill={row.muted ? mutedColor : color}
                fillOpacity={!activeName || row.name === activeName ? 1 : 0.35}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Click overlay — one plain div per row, full width, exact row height.
          Sidesteps recharts' SVG hit-testing entirely (reliable regardless
          of how thin a bar's visible rectangle is) and gives a free hover
          highlight across the whole row. */}
      <div className="absolute inset-0">
        {items.map((row, i) => (
          <div
            key={row.name}
            onClick={() => onSelect(row.name)}
            className="absolute left-0 right-0 cursor-pointer rounded hover:bg-black/5 transition-colors"
            style={{ top: i * rowHeight, height: rowHeight }}
          />
        ))}
      </div>
    </div>
  )
}
