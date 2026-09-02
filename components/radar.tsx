'use client';

/**
 * DNA radar (§27).
 *
 * Every axis is a 0-100 category score; hovering an axis shows the metrics and
 * weights that produced it, because §85 requires scores to explain themselves.
 */

export interface RadarAxis {
  category: string;
  score: number;
  inputs?: { metricKey: string; percentile: number; weight: number }[];
}

export function DnaRadar({
  axes,
  size = 300,
  className = '',
}: {
  axes: RadarAxis[];
  size?: number;
  className?: string;
}) {
  if (axes.length < 3) {
    return <p className="text-sm text-ink-500">Not enough categories to draw a radar.</p>;
  }

  // The viewBox is wider than it is tall: axis labels sit outside the polygon
  // and the longest ("Chance Creation") needs real room on both sides.
  const width = size * 1.5;
  const centre = size / 2;
  const centreX = width / 2;
  const radius = centre - 34;
  const step = (Math.PI * 2) / axes.length;

  const point = (index: number, value: number): [number, number] => {
    const angle = index * step - Math.PI / 2;
    const distance = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [centreX + Math.cos(angle) * distance, centre + Math.sin(angle) * distance];
  };

  const shape = axes.map((axis, index) => point(index, axis.score).join(',')).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${size}`}
      className={`mx-auto w-full ${className}`}
      role="img"
      aria-label="Player DNA radar"
    >
      {[25, 50, 75, 100].map((level) => (
        <polygon
          key={level}
          points={axes.map((_, index) => point(index, level).join(',')).join(' ')}
          fill="none"
          stroke="#e2e8f0"
        />
      ))}
      {axes.map((_, index) => {
        const [x, y] = point(index, 100);
        return <line key={index} x1={centreX} y1={centre} x2={x} y2={y} stroke="#f1f5f9" />;
      })}

      <polygon points={shape} fill="rgba(27,94,160,0.22)" stroke="#1b5ea0" strokeWidth={2} />

      {axes.map((axis, index) => {
        const angle = index * step - Math.PI / 2;
        const x = centreX + Math.cos(angle) * (radius + 22);
        const y = centre + Math.sin(angle) * (radius + 22);
        const anchor =
          Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';

        return (
          <g key={axis.category}>
            <text x={x} y={y} textAnchor={anchor} fontSize={9} fill="#475569">
              {axis.category}
              <tspan fontWeight={700} fill="#1b5ea0">
                {' '}
                {axis.score.toFixed(0)}
              </tspan>
              <title>
                {axis.inputs?.length
                  ? axis.inputs
                      .map(
                        (input) =>
                          `${input.metricKey}: ${input.percentile.toFixed(0)}th pct (weight ${input.weight})`,
                      )
                      .join('\n')
                  : `${axis.category}: ${axis.score.toFixed(0)}`}
              </title>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Colours used to distinguish players in a comparison (§43). Colour-blind safe. */
export const SERIES_COLOURS = ['#1b5ea0', '#c2410c', '#15803d', '#7c3aed', '#b45309'] as const;

export interface RadarSeries {
  label: string;
  /** Category -> 0-100 score. Missing categories are drawn at the centre. */
  scores: Record<string, number>;
}

/**
 * Overlaid DNA radars for a player comparison (§43).
 *
 * A category absent for a player is drawn at zero radius and named in the
 * legend footnote rather than silently filled in - §92 forbids inventing a
 * number that was never computed.
 */
export function ComparisonRadar({
  categories,
  series,
  size = 320,
  className = '',
}: {
  categories: string[];
  series: RadarSeries[];
  size?: number;
  className?: string;
}) {
  if (categories.length < 3) {
    return <p className="text-sm text-ink-500">Not enough shared categories to draw a radar.</p>;
  }

  const width = size * 1.5;
  const centre = size / 2;
  const centreX = width / 2;
  const radius = centre - 34;
  const step = (Math.PI * 2) / categories.length;

  const point = (index: number, value: number): [number, number] => {
    const angle = index * step - Math.PI / 2;
    const distance = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [centreX + Math.cos(angle) * distance, centre + Math.sin(angle) * distance];
  };

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${size}`}
        className="mx-auto w-full"
        role="img"
        aria-label="Player comparison radar"
      >
        {[25, 50, 75, 100].map((level) => (
          <polygon
            key={level}
            points={categories.map((_, index) => point(index, level).join(',')).join(' ')}
            fill="none"
            stroke="#e2e8f0"
          />
        ))}
        {categories.map((_, index) => {
          const [x, y] = point(index, 100);
          return <line key={index} x1={centreX} y1={centre} x2={x} y2={y} stroke="#f1f5f9" />;
        })}

        {series.map((entry, seriesIndex) => {
          const colour = SERIES_COLOURS[seriesIndex % SERIES_COLOURS.length];
          const shape = categories
            .map((category, index) => point(index, entry.scores[category] ?? 0).join(','))
            .join(' ');
          return (
            <polygon
              key={entry.label}
              points={shape}
              fill={colour}
              fillOpacity={0.12}
              stroke={colour}
              strokeWidth={2}
            />
          );
        })}

        {categories.map((category, index) => {
          const angle = index * step - Math.PI / 2;
          const x = centreX + Math.cos(angle) * (radius + 22);
          const y = centre + Math.sin(angle) * (radius + 22);
          const anchor =
            Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';

          return (
            <text key={category} x={x} y={y} textAnchor={anchor} fontSize={9} fill="#475569">
              {category}
              <title>
                {series
                  .map(
                    (entry) =>
                      `${entry.label}: ${
                        entry.scores[category] === undefined
                          ? 'not computed'
                          : entry.scores[category].toFixed(0)
                      }`,
                  )
                  .join('\n')}
              </title>
            </text>
          );
        })}
      </svg>

      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-ink-600">
        {series.map((entry, index) => (
          <li key={entry.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
