'use client';

import { SERIES_COLOURS } from '@/components/radar';

/**
 * Small multi-series line chart for match-by-match trends (§44).
 *
 * Deliberately plain: no library, no animation, no dual axes. One metric per
 * chart, matches on the x-axis in the order they were played, and the y-axis
 * always starting at zero so a difference cannot be exaggerated by cropping.
 */

export interface TrendSeries {
  label: string;
  /** One point per match, in playing order. */
  points: { value: number; label: string }[];
}

export function TrendChart({
  title,
  series,
  height = 130,
  className = '',
}: {
  title: string;
  series: TrendSeries[];
  height?: number;
  className?: string;
}) {
  const longest = Math.max(0, ...series.map((entry) => entry.points.length));
  if (longest < 2) {
    return (
      <div className={className}>
        <div className="mb-1 text-xs font-medium text-ink-700">{title}</div>
        <p className="text-xs text-ink-400">
          Not enough matches to draw a trend - a line needs at least two points.
        </p>
      </div>
    );
  }

  const width = 320;
  const pad = { top: 8, right: 6, bottom: 14, left: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxValue = Math.max(
    0.0001,
    ...series.flatMap((entry) => entry.points.map((point) => point.value)),
  );

  const x = (index: number): number => pad.left + (index / (longest - 1)) * plotW;
  const y = (value: number): number => pad.top + plotH - (value / maxValue) * plotH;

  const ticks = [0, maxValue / 2, maxValue];

  return (
    <div className={className}>
      <div className="mb-1 text-xs font-medium text-ink-700">{title}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              y1={y(tick)}
              x2={width - pad.right}
              y2={y(tick)}
              stroke="#e2e8f0"
              strokeWidth={0.5}
            />
            <text x={pad.left - 3} y={y(tick) + 2.5} fontSize={6} textAnchor="end" fill="#94a3b8">
              {tick >= 10 ? tick.toFixed(0) : tick.toFixed(1)}
            </text>
          </g>
        ))}

        {series.map((entry, index) => {
          const colour = SERIES_COLOURS[index % SERIES_COLOURS.length];
          const path = entry.points
            .map((point, position) => `${position === 0 ? 'M' : 'L'}${x(position)},${y(point.value)}`)
            .join(' ');

          return (
            <g key={entry.label}>
              <path d={path} fill="none" stroke={colour} strokeWidth={1.4} />
              {entry.points.map((point, position) => (
                <circle key={position} cx={x(position)} cy={y(point.value)} r={1.5} fill={colour}>
                  <title>{`${entry.label} - ${point.label}: ${point.value.toFixed(2)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        <text x={pad.left} y={height - 3} fontSize={6} fill="#94a3b8">
          first match
        </text>
        <text x={width - pad.right} y={height - 3} fontSize={6} textAnchor="end" fill="#94a3b8">
          latest
        </text>
      </svg>
    </div>
  );
}
