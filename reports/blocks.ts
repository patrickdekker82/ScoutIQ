import type { ReportBlockType } from '@prisma/client';
import { STYLE_LABELS } from '@/analytics/team-style';

/**
 * Report blocks (§50).
 *
 * A report is an ordered list of typed blocks. Building them is separate from
 * rendering them so the same content can be rendered to HTML, to PDF, or
 * (later) to anything else without duplicating the logic.
 */

export interface Block {
  type: ReportBlockType;
  title?: string;
  content: Record<string, unknown>;
}

export interface PlayerReportData {
  player: {
    id: string;
    fullName: string;
    age: number | null;
    nationality: string | null;
    position: string;
    positionGroup: string;
    preferredFoot: string;
    heightCm: number | null;
    teamName: string | null;
    isDemo: boolean;
  };
  season: { id: string; name: string; competition: string } | null;
  metrics: Record<string, number> | null;
  percentiles: { metricKey: string; value: number; percentile: number }[];
  dna: Record<string, number> | null;
  dnaInputs: unknown;
  roles: { roleName: string; score: number; isPrimary: boolean; breakdown: unknown }[];
  similar: { playerName: string; teamName: string | null; similarity: number }[];
  clubFit: { teamName: string; fitScore: number; note: string }[];
  notes: { author: string; createdAt: string; minute: number | null; body: string }[];
  scoutRatings: {
    author: string;
    technical: number;
    tactical: number;
    physical: number;
    mental: number;
    potential: number;
    overall: number;
  }[];
  quality: {
    minutes: number;
    matches: number;
    confidence: string;
    summary: string;
  };
  heatmap: { cols: number; rows: number; cells: { x: number; y: number; value: number }[] } | null;
  shots: { x: number; y: number; xg: number; isGoal: boolean; onTarget: boolean }[];
}

const strengthsAndRisks = (
  percentiles: PlayerReportData['percentiles'],
): { strengths: string[]; risks: string[] } => {
  const sorted = [...percentiles].sort((a, b) => b.percentile - a.percentile);
  return {
    strengths: sorted
      .filter((entry) => entry.percentile >= 75)
      .slice(0, 5)
      .map((entry) => `${humanise(entry.metricKey)} - ${entry.percentile.toFixed(0)}th percentile`),
    risks: sorted
      .filter((entry) => entry.percentile <= 30)
      .slice(-5)
      .map((entry) => `${humanise(entry.metricKey)} - ${entry.percentile.toFixed(0)}th percentile`),
  };
};

export function humanise(metricKey: string): string {
  return metricKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/P90/gi, 'per 90')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

/** Build the standard player report (§50). */
export function buildPlayerReportBlocks(
  data: PlayerReportData,
  options: { title: string; summary?: string; recommendation?: string },
): Block[] {
  const { strengths, risks } = strengthsAndRisks(data.percentiles);
  const primaryRole = data.roles.find((role) => role.isPrimary) ?? data.roles[0] ?? null;

  const blocks: Block[] = [
    {
      type: 'TITLE',
      content: {
        title: options.title,
        subject: data.player.fullName,
        season: data.season?.name ?? null,
        competition: data.season?.competition ?? null,
        isDemo: data.player.isDemo,
      },
    },
    {
      type: 'EXECUTIVE_SUMMARY',
      title: 'Executive summary',
      content: {
        text:
          options.summary ??
          defaultSummary(data, primaryRole?.roleName ?? null),
      },
    },
    {
      type: 'IDENTITY',
      title: 'Identity',
      content: { ...data.player, season: data.season },
    },
    {
      type: 'KEY_METRICS',
      title: 'Key metrics',
      // An ORDERED array, not an object: the snapshot is stored as jsonb,
      // which does not preserve object key order, and a report must re-render
      // identically from its snapshot (§52).
      content: {
        metrics: Object.entries(data.metrics ?? {})
          .filter(([, value]) => typeof value === 'number')
          .map(([key, value]) => ({ key, value })),
        minutes: data.quality.minutes,
      },
    },
    {
      type: 'PERCENTILES',
      title: 'Percentile ranks',
      content: {
        percentiles: data.percentiles,
        population: `${data.season?.competition ?? 'competition'} ${data.season?.name ?? ''}, ${data.player.positionGroup}`,
      },
    },
  ];

  if (data.dna) {
    blocks.push({
      type: 'RADAR',
      title: 'Player DNA',
      content: {
        dna: Object.entries(data.dna).map(([category, score]) => ({ category, score })),
        inputs: data.dnaInputs,
      },
    });
  }

  if (data.heatmap) {
    blocks.push({ type: 'HEATMAP', title: 'Activity heatmap', content: { heatmap: data.heatmap } });
  }

  if (data.shots.length > 0) {
    blocks.push({ type: 'SHOT_MAP', title: 'Shot map', content: { shots: data.shots } });
  }

  if (data.roles.length > 0) {
    blocks.push({
      type: 'TACTICAL_PROFILE',
      title: 'Role profile',
      content: { roles: data.roles.slice(0, 5), primary: primaryRole },
    });
  }

  blocks.push(
    { type: 'STRENGTHS', title: 'Strengths', content: { items: strengths } },
    { type: 'RISKS', title: 'Risks', content: { items: risks } },
  );

  if (data.clubFit.length > 0) {
    blocks.push({
      type: 'CLUB_FIT',
      title: 'Club fit',
      content: { fits: data.clubFit.slice(0, 8) },
    });
  }

  if (data.similar.length > 0) {
    blocks.push({
      type: 'COMPARABLE_PLAYERS',
      title: 'Comparable players',
      content: { players: data.similar.slice(0, 8) },
    });
  }

  if (data.notes.length > 0 || data.scoutRatings.length > 0) {
    blocks.push({
      type: 'SCOUT_NOTES',
      title: 'Scout notes and ratings',
      content: { notes: data.notes, ratings: data.scoutRatings },
    });
  }

  blocks.push({
    type: 'RECOMMENDATION',
    title: 'Recommendation',
    content: {
      text: options.recommendation ?? 'No recommendation recorded.',
    },
  });

  return blocks;
}

function defaultSummary(data: PlayerReportData, roleName: string | null): string {
  const parts: string[] = [];
  const { player, quality } = data;

  parts.push(
    `${player.fullName}${player.age ? `, ${player.age}` : ''} ` +
      `(${player.position}${player.teamName ? `, ${player.teamName}` : ''}).`,
  );

  if (roleName) parts.push(`Profile most closely matches the ${roleName} role.`);

  const top = [...data.percentiles].sort((a, b) => b.percentile - a.percentile)[0];
  if (top && top.percentile >= 70) {
    parts.push(
      `Standout output in ${humanise(top.metricKey).toLowerCase()} ` +
        `(${top.percentile.toFixed(0)}th percentile).`,
    );
  }

  parts.push(quality.summary + '.');

  if (player.isDemo) parts.push('This profile is generated from DEMO DATA.');

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Club, match and comparison reports (§50, §51)
// ---------------------------------------------------------------------------

export interface ClubReportData {
  team: { id: string; name: string; country: string | null; isDemo: boolean };
  season: { id: string; name: string; competition: string } | null;
  metrics: Record<string, number> | null;
  /** Style dimension -> percentile within the competition (§31). */
  style: Record<string, number> | null;
  squad: {
    playerName: string;
    position: string | null;
    minutes: number;
    goalsP90: number;
    xgP90: number;
    xaP90: number;
  }[];
  matches: {
    date: string;
    opponent: string;
    homeAway: string;
    score: string;
    xg: number;
    possession: number;
  }[];
  quality: { matches: number; confidence: string; summary: string };
}

export interface MatchReportData {
  match: {
    id: string;
    kickoff: string;
    competition: string;
    season: string;
    homeTeam: string;
    awayTeam: string;
    score: string;
    isDemo: boolean;
  };
  /** One row per metric, with the two teams side by side. */
  teamMetrics: { key: string; home: number; away: number }[];
  shots: { x: number; y: number; xg: number; isGoal: boolean; onTarget: boolean }[];
  lineups: { team: string; playerName: string; position: string | null; minutes: number }[];
  network: {
    team: string;
    nodes: { name: string; passes: number; received: number }[];
    edges: { from: string; to: string; passes: number }[];
  } | null;
  quality: { events: number; confidence: string; summary: string };
}

export interface ComparisonReportData {
  players: {
    id: string;
    fullName: string;
    position: string;
    positionGroup: string;
    age: number | null;
    teamName: string | null;
    season: string | null;
    minutes: number;
    confidence: string;
    metrics: Record<string, number>;
    percentiles: Record<string, number>;
    dna: Record<string, number>;
    topRole: string | null;
  }[];
  sharedPopulation: boolean;
  metricKeys: string[];
  quality: { summary: string };
}

/** Style dimensions have their own names; everything else falls back to humanise. */
const styleLabel = (dimension: string): string =>
  STYLE_LABELS[dimension as keyof typeof STYLE_LABELS] ?? humanise(dimension);

/** Club report (§50, §51). */
export function buildClubReportBlocks(
  data: ClubReportData,
  options: { title: string; summary?: string; recommendation?: string },
): Block[] {
  const style = Object.entries(data.style ?? {});
  const strong = style.filter(([, score]) => score >= 70).sort((a, b) => b[1] - a[1]);
  const weak = style.filter(([, score]) => score <= 30).sort((a, b) => a[1] - b[1]);

  const blocks: Block[] = [
    {
      type: 'TITLE',
      content: {
        title: options.title,
        subject: data.team.name,
        season: data.season?.name ?? null,
        competition: data.season?.competition ?? null,
        isDemo: data.team.isDemo,
      },
    },
    {
      type: 'EXECUTIVE_SUMMARY',
      title: 'Executive summary',
      content: {
        text:
          options.summary ??
          `${data.team.name} over ${data.quality.matches} matches in ${
            data.season?.competition ?? 'this competition'
          } ${data.season?.name ?? ''}. ${data.quality.summary}`,
      },
    },
    {
      type: 'IDENTITY',
      title: 'Identity',
      content: {
        fullName: data.team.name,
        nationality: data.team.country,
        season: data.season,
        isDemo: data.team.isDemo,
      },
    },
    {
      type: 'KEY_METRICS',
      title: 'Season metrics',
      content: {
        metrics: Object.entries(data.metrics ?? {})
          .filter(([, value]) => typeof value === 'number')
          .map(([key, value]) => ({ key, value })),
        minutes: data.quality.matches,
      },
    },
  ];

  if (data.style) {
    blocks.push({
      type: 'RADAR',
      title: 'Tactical style',
      content: {
        dna: style.map(([category, score]) => ({ category, score })),
        inputs: null,
      },
    });
  }

  blocks.push(
    {
      type: 'STRENGTHS',
      title: 'Style strengths',
      content: {
        items: strong.map(
          ([dimension, score]) =>
            `${styleLabel(dimension)} - ${score.toFixed(0)}th percentile in the competition`,
        ),
      },
    },
    {
      type: 'RISKS',
      title: 'Style weaknesses',
      content: {
        items: weak.map(
          ([dimension, score]) =>
            `${styleLabel(dimension)} - ${score.toFixed(0)}th percentile in the competition`,
        ),
      },
    },
    {
      type: 'DATA_QUALITY',
      title: 'Squad',
      content: {
        table: {
          columns: [
            { key: 'playerName', label: 'Player' },
            { key: 'position', label: 'Pos' },
            { key: 'minutes', label: 'Minutes', align: 'right' },
            { key: 'goalsP90', label: 'Goals /90', align: 'right' },
            { key: 'xgP90', label: 'xG /90', align: 'right' },
            { key: 'xaP90', label: 'xA /90', align: 'right' },
          ],
          rows: data.squad,
        },
        note: 'Players with recorded minutes this season, most first.',
      },
    },
    {
      type: 'DATA_SOURCES',
      title: 'Matches',
      content: {
        table: {
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'homeAway', label: 'H/A' },
            { key: 'opponent', label: 'Opponent' },
            { key: 'score', label: 'Score' },
            { key: 'xg', label: 'xG', align: 'right' },
            { key: 'possession', label: 'Possession', align: 'right' },
          ],
          rows: data.matches,
        },
      },
    },
  );

  if (options.recommendation) {
    blocks.push({
      type: 'RECOMMENDATION',
      title: 'Recommendation',
      content: { text: options.recommendation },
    });
  }

  return blocks;
}

/** Match report (§50, §51). */
export function buildMatchReportBlocks(
  data: MatchReportData,
  options: { title: string; summary?: string },
): Block[] {
  const blocks: Block[] = [
    {
      type: 'TITLE',
      content: {
        title: options.title,
        subject: `${data.match.homeTeam} ${data.match.score} ${data.match.awayTeam}`,
        season: data.match.season,
        competition: data.match.competition,
        isDemo: data.match.isDemo,
      },
    },
    {
      type: 'EXECUTIVE_SUMMARY',
      title: 'Executive summary',
      content: {
        text:
          options.summary ??
          `${data.match.homeTeam} ${data.match.score} ${data.match.awayTeam}, ${
            data.match.competition
          } ${data.match.season}, ${data.match.kickoff.slice(0, 10)}. ${data.quality.summary}`,
      },
    },
    {
      type: 'KEY_METRICS',
      title: 'Team comparison',
      content: {
        table: {
          columns: [
            { key: 'metric', label: 'Metric' },
            { key: 'home', label: data.match.homeTeam, align: 'right' },
            { key: 'away', label: data.match.awayTeam, align: 'right' },
          ],
          rows: data.teamMetrics.map((entry) => ({
            metric: humanise(entry.key),
            home: entry.home,
            away: entry.away,
          })),
        },
      },
    },
  ];

  if (data.shots.length > 0) {
    blocks.push({
      type: 'SHOT_MAP',
      title: 'Shot map',
      content: { shots: data.shots },
    });
  }

  if (data.network && data.network.edges.length > 0) {
    blocks.push({
      type: 'PASSING_NETWORK',
      title: `Passing network - ${data.network.team}`,
      content: {
        table: {
          columns: [
            { key: 'from', label: 'From' },
            { key: 'to', label: 'To' },
            { key: 'passes', label: 'Passes', align: 'right' },
          ],
          rows: data.network.edges.slice(0, 15),
        },
        note: 'The fifteen most frequent passing links. Completed passes with a named recipient only.',
      },
    });
  }

  if (data.lineups.length > 0) {
    blocks.push({
      type: 'DATA_SOURCES',
      title: 'Lineups',
      content: {
        table: {
          columns: [
            { key: 'team', label: 'Team' },
            { key: 'playerName', label: 'Player' },
            { key: 'position', label: 'Pos' },
            { key: 'minutes', label: 'Minutes', align: 'right' },
          ],
          rows: data.lineups,
        },
      },
    });
  }

  return blocks;
}

/** Player comparison report (§43, §51). */
export function buildComparisonReportBlocks(
  data: ComparisonReportData,
  options: { title: string; summary?: string; recommendation?: string },
): Block[] {
  const names = data.players.map((player) => player.fullName);

  const blocks: Block[] = [
    {
      type: 'TITLE',
      content: {
        title: options.title,
        subject: names.join(' · '),
        season: data.players[0]?.season ?? null,
        competition: null,
        isDemo: false,
      },
    },
    {
      type: 'EXECUTIVE_SUMMARY',
      title: 'Executive summary',
      content: {
        text:
          options.summary ??
          `${names.join(', ')} compared. ${
            data.sharedPopulation
              ? 'All are ranked within the same competition season and position group, so their percentiles are directly comparable.'
              : 'These players are ranked in different populations: raw per-90 values are comparable, percentiles are not.'
          } ${data.quality.summary}`,
      },
    },
    {
      type: 'IDENTITY',
      title: 'Profiles',
      content: {
        table: {
          columns: [
            { key: 'fullName', label: 'Player' },
            { key: 'position', label: 'Pos' },
            { key: 'age', label: 'Age', align: 'right' },
            { key: 'teamName', label: 'Club' },
            { key: 'season', label: 'Season' },
            { key: 'minutes', label: 'Minutes', align: 'right' },
            { key: 'confidence', label: 'Confidence' },
            { key: 'topRole', label: 'Best role' },
          ],
          rows: data.players.map((player) => ({
            fullName: player.fullName,
            position: player.position,
            age: player.age,
            teamName: player.teamName,
            season: player.season,
            minutes: player.minutes,
            confidence: player.confidence,
            topRole: player.topRole,
          })),
        },
      },
    },
    {
      type: 'KEY_METRICS',
      title: 'Metrics',
      content: {
        table: {
          columns: [
            { key: 'metric', label: 'Metric' },
            ...data.players.map((player) => ({
              key: player.id,
              label: player.fullName,
              align: 'right' as const,
            })),
          ],
          rows: data.metricKeys.map((key) => ({
            metric: humanise(key),
            ...Object.fromEntries(
              data.players.map((player) => [player.id, player.metrics[key] ?? null]),
            ),
          })),
        },
        note: 'Per-90 rates from each player’s own season.',
      },
    },
    {
      type: 'PERCENTILES',
      title: 'Percentile ranks',
      content: {
        table: {
          columns: [
            { key: 'metric', label: 'Metric' },
            ...data.players.map((player) => ({
              key: player.id,
              label: player.fullName,
              align: 'right' as const,
            })),
          ],
          rows: data.metricKeys.map((key) => ({
            metric: humanise(key),
            ...Object.fromEntries(
              data.players.map((player) => [player.id, player.percentiles[key] ?? null]),
            ),
          })),
        },
        note: data.sharedPopulation
          ? 'Ranked within one competition season and position group.'
          : 'Each player is ranked within their own competition season and position group; these columns are not directly comparable.',
      },
    },
  ];

  for (const player of data.players) {
    if (Object.keys(player.dna).length === 0) continue;
    blocks.push({
      type: 'RADAR',
      title: `DNA - ${player.fullName}`,
      content: {
        dna: Object.entries(player.dna).map(([category, score]) => ({ category, score })),
        inputs: null,
      },
    });
  }

  if (options.recommendation) {
    blocks.push({
      type: 'RECOMMENDATION',
      title: 'Recommendation',
      content: { text: options.recommendation },
    });
  }

  return blocks;
}
