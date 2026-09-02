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
