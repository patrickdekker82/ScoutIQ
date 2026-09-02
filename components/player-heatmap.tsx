'use client';

import { useEffect, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import { HeatmapPitch, type HeatmapCell } from '@/components/pitch';

/**
 * Interactive heatmap (§34, §35).
 *
 * Filters are applied server-side and only the resulting grid is returned, so
 * changing a filter never ships raw events to the browser (§59).
 */

const TYPES = [
  { key: 'TOUCH', label: 'Touches' },
  { key: 'PASS_ORIGIN', label: 'Pass origin' },
  { key: 'PASS_DESTINATION', label: 'Pass destination' },
  { key: 'CARRY', label: 'Carries' },
  { key: 'SHOT', label: 'Shots' },
  { key: 'DEFENSIVE_ACTION', label: 'Defensive actions' },
  { key: 'PRESSURE', label: 'Pressures' },
  { key: 'COMBINED_ACTIVITY', label: 'Combined' },
];

const ALGORITHMS = [
  { key: 'GAUSSIAN_KDE', label: 'KDE' },
  { key: 'GRID_DENSITY', label: 'Grid' },
  { key: 'HEXBIN', label: 'Hexbin' },
];

export function PlayerHeatmap({ playerId }: { playerId: string }) {
  const [type, setType] = useState('TOUCH');
  const [algorithm, setAlgorithm] = useState('GAUSSIAN_KDE');
  const [half, setHalf] = useState('');
  const [resolution, setResolution] = useState('24');
  const [data, setData] = useState<{
    cells: HeatmapCell[];
    cols: number;
    rows: number;
    sampleSize: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      const params = new URLSearchParams({
        type,
        algorithm,
        cols: resolution,
        rows: String(Math.round(Number(resolution) * 0.66)),
      });
      if (half) params.set('half', half);

      const response = await fetch(
        `/api/v1/players/${playerId}/heatmap?${params.toString()}`,
        { signal: controller.signal },
      ).catch(() => null);

      if (response?.ok) {
        setData(await response.json());
      }
      setLoading(false);
    }

    void load();
    return () => controller.abort();
  }, [playerId, type, algorithm, half, resolution]);

  const select = 'rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500';

  return (
    <Card
      title="Heatmap"
      subtitle={data ? `${data.sampleSize} events` : undefined}
      actions={
        <div className="flex flex-wrap gap-1.5">
          <select value={type} onChange={(event) => setType(event.target.value)} className={select}>
            {TYPES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value)}
            className={select}
          >
            {ALGORITHMS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          <select value={half} onChange={(event) => setHalf(event.target.value)} className={select}>
            <option value="">Full match</option>
            <option value="1">1st half</option>
            <option value="2">2nd half</option>
          </select>
          <select
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            className={select}
          >
            <option value="16">Coarse</option>
            <option value="24">Medium</option>
            <option value="36">Fine</option>
          </select>
        </div>
      }
    >
      {loading && !data ? (
        <div className="h-56 animate-pulse rounded-md bg-ink-100" />
      ) : data && data.sampleSize > 0 ? (
        <HeatmapPitch cells={data.cells} cols={data.cols} rows={data.rows} />
      ) : (
        <Empty>No events of this type for this player.</Empty>
      )}
    </Card>
  );
}
