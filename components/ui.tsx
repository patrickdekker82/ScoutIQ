import type { ReactNode } from 'react';

/**
 * Small presentational primitives shared across the app.
 *
 * Deliberately plain: a scouting UI lives or dies on data density and
 * readability, not on component machinery.
 */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-ink-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-bad'
          : 'text-brand-600';

  return (
    <div className="rounded-md bg-ink-50 px-3 py-2.5">
      <div className={`tabular text-xl font-semibold leading-tight ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-400">{hint}</div>}
    </div>
  );
}

/** Confidence chip - every score is shown with the sample behind it (§54). */
export function ConfidenceBadge({
  confidence,
  minutes,
  matches,
}: {
  confidence: string | null | undefined;
  minutes?: number;
  matches?: number;
}) {
  const map: Record<string, string> = {
    HIGH: 'bg-good/10 text-good border-good/30',
    MEDIUM: 'bg-warn/10 text-warn border-warn/30',
    LOW: 'bg-bad/10 text-bad border-bad/30',
    INSUFFICIENT: 'bg-ink-100 text-ink-500 border-ink-300',
  };
  const key = confidence ?? 'INSUFFICIENT';
  const label = key.charAt(0) + key.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        map[key] ?? map.INSUFFICIENT
      }`}
      title="Confidence reflects minutes played, matches and how much of the required data was present"
    >
      {label}
      {minutes !== undefined && (
        <span className="tabular font-normal opacity-80">
          {minutes} min{matches !== undefined ? ` / ${matches} m` : ''}
        </span>
      )}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span
      className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn"
      title="Fabricated demonstration data - not a real player, team or match"
    >
      Demo data
    </span>
  );
}

export function PercentileBar({ percentile }: { percentile: number }) {
  const tone =
    percentile >= 70 ? 'bg-good' : percentile >= 40 ? 'bg-warn' : 'bg-ink-300';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-ink-200">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(1, Math.min(100, percentile))}%` }}
        />
      </div>
      <span className="tabular w-8 shrink-0 text-right text-xs font-semibold text-ink-700">
        {percentile.toFixed(0)}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-ink-300 px-4 py-6 text-center text-sm text-ink-500">
      {children}
    </p>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`border-b border-ink-200 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`border-b border-ink-100 px-2 py-1.5 ${
        align === 'right' ? 'tabular text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}
