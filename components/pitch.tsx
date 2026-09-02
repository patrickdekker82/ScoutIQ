'use client';

import { useMemo } from 'react';

/**
 * Pitch visualisations (§34, §39).
 *
 * All coordinates are canonical metres (105 x 68), so the same component draws
 * events from any provider. Built here rather than embedded from a provider,
 * which is what makes the filters in §35 possible.
 */

const LENGTH = 105;
const WIDTH = 68;

function Markings({ half = false }: { half?: boolean }) {
  const stroke = '#94a3b8';
  return (
    <g fill="none" stroke={stroke} strokeWidth={0.4}>
      <rect x={0} y={0} width={LENGTH} height={WIDTH} />
      {!half && <line x1={LENGTH / 2} y1={0} x2={LENGTH / 2} y2={WIDTH} />}
      {!half && <circle cx={LENGTH / 2} cy={WIDTH / 2} r={9.15} />}
      <rect x={0} y={13.84} width={16.5} height={40.32} />
      <rect x={LENGTH - 16.5} y={13.84} width={16.5} height={40.32} />
      <rect x={0} y={24.84} width={5.5} height={18.32} strokeWidth={0.3} />
      <rect x={LENGTH - 5.5} y={24.84} width={5.5} height={18.32} strokeWidth={0.3} />
      <circle cx={11} cy={WIDTH / 2} r={0.4} fill={stroke} />
      <circle cx={LENGTH - 11} cy={WIDTH / 2} r={0.4} fill={stroke} />
    </g>
  );
}

export interface HeatmapCell {
  col: number;
  row: number;
  x: number;
  y: number;
  value: number;
}

export function HeatmapPitch({
  cells,
  cols,
  rows,
  className = '',
}: {
  cells: HeatmapCell[];
  cols: number;
  rows: number;
  className?: string;
}) {
  const cellWidth = LENGTH / cols;
  const cellHeight = WIDTH / rows;

  return (
    <svg
      viewBox={`-1 -1 ${LENGTH + 2} ${WIDTH + 2}`}
      className={`w-full rounded-md border border-ink-200 bg-ink-50 ${className}`}
      role="img"
      aria-label="Activity heatmap"
    >
      {cells
        .filter((cell) => cell.value > 0.02)
        .map((cell) => (
          <rect
            key={`${cell.col}-${cell.row}`}
            x={cell.x - cellWidth / 2}
            y={cell.y - cellHeight / 2}
            width={cellWidth}
            height={cellHeight}
            fill="#1b5ea0"
            opacity={Math.min(0.85, cell.value * 0.85)}
          />
        ))}
      <Markings />
      <text x={2} y={WIDTH - 2} fontSize={2.6} fill="#94a3b8">
        Own goal
      </text>
      <text x={LENGTH - 2} y={WIDTH - 2} fontSize={2.6} fill="#94a3b8" textAnchor="end">
        Attacking
      </text>
    </svg>
  );
}

export interface Shot {
  id?: string;
  x: number;
  y: number;
  xg: number;
  isGoal: boolean;
  onTarget: boolean;
  minute?: number;
  playerName?: string | null;
}

export function ShotMap({ shots, className = '' }: { shots: Shot[]; className?: string }) {
  const sorted = useMemo(() => [...shots].sort((a, b) => a.xg - b.xg), [shots]);

  return (
    <div className={className}>
      <svg
        viewBox={`50 -1 ${LENGTH - 49} ${WIDTH + 2}`}
        className="w-full rounded-md border border-ink-200 bg-ink-50"
        role="img"
        aria-label="Shot map"
      >
        <Markings half />
        {sorted.map((shot, index) => (
          <circle
            key={shot.id ?? index}
            cx={shot.x}
            cy={shot.y}
            r={Math.max(0.7, Math.sqrt(Math.max(0.01, shot.xg)) * 4)}
            fill={shot.isGoal ? '#16a34a' : shot.onTarget ? '#f59e0b' : '#94a3b8'}
            fillOpacity={0.75}
            stroke="#1e293b"
            strokeWidth={0.15}
          >
            <title>
              {`${shot.playerName ?? 'Shot'}${shot.minute !== undefined ? ` ${shot.minute}'` : ''} - xG ${shot.xg.toFixed(2)}${shot.isGoal ? ' (goal)' : ''}`}
            </title>
          </circle>
        ))}
      </svg>
      <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-good" /> Goal
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-warn" /> On target
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-ink-400" /> Off target
        </span>
        <span>Marker size is xG</span>
      </p>
    </div>
  );
}

/** Passing network (§38): nodes are players, edges are pass volume. */
export interface NetworkNode {
  playerId: string;
  name: string;
  x: number;
  y: number;
  passes: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  passes: number;
}

export function PassingNetwork({
  nodes,
  edges,
  className = '',
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  className?: string;
}) {
  const byId = new Map(nodes.map((node) => [node.playerId, node]));
  const maxPasses = Math.max(1, ...edges.map((edge) => edge.passes));
  const maxNode = Math.max(1, ...nodes.map((node) => node.passes));

  return (
    <svg
      viewBox={`-1 -1 ${LENGTH + 2} ${WIDTH + 2}`}
      className={`w-full rounded-md border border-ink-200 bg-ink-50 ${className}`}
      role="img"
      aria-label="Passing network"
    >
      <Markings />
      {edges.map((edge, index) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={index}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#2b74bd"
            strokeOpacity={0.25 + (edge.passes / maxPasses) * 0.5}
            strokeWidth={0.25 + (edge.passes / maxPasses) * 1.4}
          />
        );
      })}
      {nodes.map((node) => (
        <g key={node.playerId}>
          <circle
            cx={node.x}
            cy={node.y}
            r={1.4 + (node.passes / maxNode) * 2.2}
            fill="#1b5ea0"
            fillOpacity={0.85}
          >
            <title>{`${node.name} - ${node.passes} passes`}</title>
          </circle>
          <text x={node.x} y={node.y - 3} fontSize={2.2} textAnchor="middle" fill="#334155">
            {node.name.split(' ').slice(-1)[0]}
          </text>
        </g>
      ))}
    </svg>
  );
}
