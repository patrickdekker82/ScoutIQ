import type { ReportBlockType } from '@prisma/client';

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
