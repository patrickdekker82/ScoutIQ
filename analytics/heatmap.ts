import { PITCH_LENGTH_M, PITCH_WIDTH_M } from '@/analytics/coordinates';

/**
 * Heatmap engine (§34, §35).
 *
 * ScoutIQ builds its own heatmaps from canonical coordinates rather than
 * embedding a provider's picture, so the same filters, resolution and
 * normalisation apply no matter where the events came from.
 *
 * Three algorithms: grid density, hexbin, and Gaussian KDE.
 */

export type HeatmapAlgorithmKey = 'GRID_DENSITY' | 'HEXBIN' | 'GAUSSIAN_KDE';

export interface HeatmapInput {
  x: number;
  y: number;
  weight?: number;
}

export interface HeatmapOptions {
  algorithm?: HeatmapAlgorithmKey;
  cols?: number;
  rows?: number;
  /** KDE bandwidth in metres. */
  bandwidth?: number;
  /** Rescale the surface so the peak is 1. */
  normalize?: boolean;
}

export interface HeatmapCell {
  col: number;
  row: number;
  /** Cell centre in canonical metres. */
  x: number;
  y: number;
  value: number;
  count: number;
}

export interface HeatmapResult {
  algorithm: HeatmapAlgorithmKey;
  cols: number;
  rows: number;
  bandwidth: number | null;
  cells: HeatmapCell[];
  totalWeight: number;
  maxValue: number;
  sampleSize: number;
}

const DEFAULT_COLS = 24;
const DEFAULT_ROWS = 16;
const DEFAULT_BANDWIDTH = 6;

const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const inBounds = (point: HeatmapInput): boolean =>
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  point.x >= 0 &&
  point.x <= PITCH_LENGTH_M &&
  point.y >= 0 &&
  point.y <= PITCH_WIDTH_M;

function emptyGrid(cols: number, rows: number): HeatmapCell[] {
  const cellWidth = PITCH_LENGTH_M / cols;
  const cellHeight = PITCH_WIDTH_M / rows;
  const cells: HeatmapCell[] = [];

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      cells.push({
        col,
        row,
        x: round(cellWidth * (col + 0.5), 2),
        y: round(cellHeight * (row + 0.5), 2),
        value: 0,
        count: 0,
      });
    }
  }
  return cells;
}

/** Straight binning: fast, exact counts, blocky. */
function gridDensity(points: readonly HeatmapInput[], cols: number, rows: number): HeatmapCell[] {
  const cells = emptyGrid(cols, rows);
  const index = new Map(cells.map((cell) => [`${cell.col}:${cell.row}`, cell]));

  for (const point of points) {
    const col = Math.min(cols - 1, Math.floor((point.x / PITCH_LENGTH_M) * cols));
    const row = Math.min(rows - 1, Math.floor((point.y / PITCH_WIDTH_M) * rows));
    const cell = index.get(`${col}:${row}`);
    if (!cell) continue;
    cell.value += point.weight ?? 1;
    cell.count += 1;
  }

  return cells;
}

/**
 * Hexbin: pointy-top hexagons approximated on the same cell grid, with rows
 * offset by half a cell. Reads better than squares for spatial density.
 */
function hexbin(points: readonly HeatmapInput[], cols: number, rows: number): HeatmapCell[] {
  const cellWidth = PITCH_LENGTH_M / cols;
  const cellHeight = PITCH_WIDTH_M / rows;
  const cells: HeatmapCell[] = [];
  const index = new Map<string, HeatmapCell>();

  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 1 ? cellWidth / 2 : 0;
    for (let col = 0; col < cols; col += 1) {
      const cell: HeatmapCell = {
        col,
        row,
        x: round(Math.min(PITCH_LENGTH_M, cellWidth * col + offset + cellWidth / 2), 2),
        y: round(cellHeight * (row + 0.5), 2),
        value: 0,
        count: 0,
      };
      cells.push(cell);
      index.set(`${col}:${row}`, cell);
    }
  }

  for (const point of points) {
    const row = Math.min(rows - 1, Math.floor((point.y / PITCH_WIDTH_M) * rows));
    const offset = row % 2 === 1 ? cellWidth / 2 : 0;
    const col = Math.max(
      0,
      Math.min(cols - 1, Math.floor((point.x - offset) / cellWidth + 0.5)),
    );
    const cell = index.get(`${col}:${row}`);
    if (!cell) continue;
    cell.value += point.weight ?? 1;
    cell.count += 1;
  }

  return cells;
}

/**
 * Gaussian kernel density estimate.
 *
 * Each point spreads influence over nearby cells; `bandwidth` is the standard
 * deviation in metres. Contributions beyond 3 sigma are skipped, which keeps
 * this O(points x local cells) instead of O(points x all cells).
 */
function gaussianKde(
  points: readonly HeatmapInput[],
  cols: number,
  rows: number,
  bandwidth: number,
): HeatmapCell[] {
  const cells = emptyGrid(cols, rows);
  const index = new Map(cells.map((cell) => [`${cell.col}:${cell.row}`, cell]));

  const cellWidth = PITCH_LENGTH_M / cols;
  const cellHeight = PITCH_WIDTH_M / rows;
  const reach = bandwidth * 3;
  const colReach = Math.ceil(reach / cellWidth);
  const rowReach = Math.ceil(reach / cellHeight);
  const denominator = 2 * bandwidth * bandwidth;

  for (const point of points) {
    const centreCol = Math.min(cols - 1, Math.floor((point.x / PITCH_LENGTH_M) * cols));
    const centreRow = Math.min(rows - 1, Math.floor((point.y / PITCH_WIDTH_M) * rows));
    const weight = point.weight ?? 1;

    for (let col = centreCol - colReach; col <= centreCol + colReach; col += 1) {
      if (col < 0 || col >= cols) continue;
      for (let row = centreRow - rowReach; row <= centreRow + rowReach; row += 1) {
        if (row < 0 || row >= rows) continue;
        const cell = index.get(`${col}:${row}`);
        if (!cell) continue;

        const squared = (cell.x - point.x) ** 2 + (cell.y - point.y) ** 2;
        if (squared > reach * reach) continue;

        cell.value += weight * Math.exp(-squared / denominator);
      }
    }

    const centre = index.get(`${centreCol}:${centreRow}`);
    if (centre) centre.count += 1;
  }

  return cells;
}

export function buildHeatmap(
  points: readonly HeatmapInput[],
  options: HeatmapOptions = {},
): HeatmapResult {
  const {
    algorithm = 'GRID_DENSITY',
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
    bandwidth = DEFAULT_BANDWIDTH,
    normalize = true,
  } = options;

  if (cols < 1 || rows < 1) throw new Error('Heatmap resolution must be at least 1x1');

  const usable = points.filter(inBounds);

  let cells: HeatmapCell[];
  switch (algorithm) {
    case 'HEXBIN':
      cells = hexbin(usable, cols, rows);
      break;
    case 'GAUSSIAN_KDE':
      cells = gaussianKde(usable, cols, rows, bandwidth);
      break;
    default:
      cells = gridDensity(usable, cols, rows);
      break;
  }

  const totalWeight = usable.reduce((sum, point) => sum + (point.weight ?? 1), 0);
  let maxValue = cells.reduce((max, cell) => Math.max(max, cell.value), 0);

  if (normalize && maxValue > 0) {
    for (const cell of cells) cell.value = round(cell.value / maxValue);
    maxValue = 1;
  } else {
    for (const cell of cells) cell.value = round(cell.value);
  }

  return {
    algorithm,
    cols,
    rows,
    bandwidth: algorithm === 'GAUSSIAN_KDE' ? bandwidth : null,
    cells,
    totalWeight: round(totalWeight, 2),
    maxValue: round(maxValue),
    sampleSize: usable.length,
  };
}

export interface HeatmapFilters {
  half?: 1 | 2 | null;
  minuteFrom?: number | null;
  minuteTo?: number | null;
  possession?: 'IN' | 'OUT' | null;
  eventTypes?: string[] | null;
  teamId?: string | null;
  playerId?: string | null;
}

export interface FilterableEvent {
  minute: number;
  period?: number | null;
  type: string;
  teamId?: string | null;
  playerId?: string | null;
  /** Whether the acting team had possession at this moment. */
  inPossession?: boolean | null;
}

/** Apply the §35 filter set. Kept separate so it is testable on its own. */
export function applyHeatmapFilters<T extends FilterableEvent>(
  events: readonly T[],
  filters: HeatmapFilters,
): T[] {
  return events.filter((event) => {
    if (filters.half && (event.period ?? 1) !== filters.half) return false;
    if (filters.minuteFrom != null && event.minute < filters.minuteFrom) return false;
    if (filters.minuteTo != null && event.minute > filters.minuteTo) return false;
    if (filters.teamId && event.teamId !== filters.teamId) return false;
    if (filters.playerId && event.playerId !== filters.playerId) return false;
    if (filters.eventTypes?.length && !filters.eventTypes.includes(event.type)) return false;
    if (filters.possession === 'IN' && event.inPossession === false) return false;
    if (filters.possession === 'OUT' && event.inPossession !== false) return false;
    return true;
  });
}
