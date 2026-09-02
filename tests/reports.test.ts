import { describe, expect, it } from 'vitest';
import { buildPlayerReportBlocks, humanise, type PlayerReportData } from '@/reports/blocks';
import { renderReportHtml } from '@/reports/render';
import { buildSnapshotMeta, snapshotId } from '@/reports/snapshot';
import { ANALYTICS_VERSION, REPORT_VERSION } from '@/analytics/version';

const data: PlayerReportData = {
  player: {
    id: 'player-1',
    fullName: 'Sem de Vries',
    age: 23,
    nationality: 'Netherlands',
    position: 'LW',
    positionGroup: 'FW',
    preferredFoot: 'RIGHT',
    heightCm: 182,
    teamName: 'Noordwijk United',
    isDemo: true,
  },
  season: { id: 'season-1', name: '2025/2026', competition: 'Demo Eredivisie' },
  metrics: { goalsP90: 0.62, xgP90: 0.55, xaP90: 0.21 },
  percentiles: [
    { metricKey: 'xgP90', value: 0.55, percentile: 94 },
    { metricKey: 'progressivePassesP90', value: 3.1, percentile: 22 },
  ],
  dna: { Finishing: 88, Pressing: 41, 'Chance Creation': 72 },
  dnaInputs: null,
  roles: [
    { roleName: 'Inside Forward', score: 84.2, isPrimary: true, breakdown: [] },
    { roleName: 'Pressing Forward', score: 61.0, isPrimary: false, breakdown: [] },
  ],
  similar: [{ playerName: 'Finn Smit', teamName: 'PSV', similarity: 0.91 }],
  clubFit: [{ teamName: 'Rivierstad FC', fitScore: 87, note: 'model output' }],
  notes: [
    { author: 'Patrick', createdAt: '2026-01-10T12:00:00.000Z', minute: 34, body: 'Sharp movement between the lines.' },
  ],
  scoutRatings: [
    { author: 'Patrick', technical: 8, tactical: 7, physical: 7, mental: 8, potential: 8, overall: 8 },
  ],
  quality: { minutes: 1980, matches: 24, confidence: 'HIGH', summary: 'Confidence: High - 1980 minutes across 24 matches' },
  heatmap: {
    cols: 4,
    rows: 3,
    cells: [
      { x: 90, y: 34, value: 1 },
      { x: 30, y: 34, value: 0.2 },
    ],
  },
  shots: [
    { x: 95, y: 34, xg: 0.42, isGoal: true, onTarget: true },
    { x: 80, y: 20, xg: 0.05, isGoal: false, onTarget: false },
  ],
};

/** Report engine (§50) and PDF rendering input (§51, §87). */
describe('buildPlayerReportBlocks', () => {
  const blocks = buildPlayerReportBlocks(data, { title: 'Scouting report - Sem de Vries' });

  it('includes the blocks §50 requires when the data supports them', () => {
    const types = blocks.map((block) => block.type);
    for (const required of [
      'TITLE',
      'EXECUTIVE_SUMMARY',
      'IDENTITY',
      'KEY_METRICS',
      'PERCENTILES',
      'RADAR',
      'HEATMAP',
      'SHOT_MAP',
      'TACTICAL_PROFILE',
      'STRENGTHS',
      'RISKS',
      'CLUB_FIT',
      'COMPARABLE_PLAYERS',
      'SCOUT_NOTES',
      'RECOMMENDATION',
    ]) {
      expect(types).toContain(required);
    }
  });

  it('stores ordered arrays, because jsonb does not preserve key order', () => {
    const metrics = blocks.find((block) => block.type === 'KEY_METRICS')?.content.metrics;
    const dna = blocks.find((block) => block.type === 'RADAR')?.content.dna;

    expect(Array.isArray(metrics)).toBe(true);
    expect(Array.isArray(dna)).toBe(true);
    expect((metrics as { key: string }[])[0]?.key).toBe('goalsP90');
  });

  it('derives strengths and risks from the percentiles', () => {
    const strengths = blocks.find((block) => block.type === 'STRENGTHS')?.content.items as string[];
    const risks = blocks.find((block) => block.type === 'RISKS')?.content.items as string[];

    expect(strengths[0]).toContain('Xg per 90');
    expect(risks[0]).toContain('Progressive Passes per 90');
  });

  it('writes a summary that names the role, the standout metric and the sample', () => {
    const summary = blocks.find((block) => block.type === 'EXECUTIVE_SUMMARY')?.content
      .text as string;

    expect(summary).toContain('Sem de Vries');
    expect(summary).toContain('Inside Forward');
    expect(summary).toContain('1980 minutes');
    expect(summary).toContain('DEMO DATA');
  });

  it('omits blocks whose data is absent rather than inventing them', () => {
    const sparse = buildPlayerReportBlocks(
      { ...data, dna: null, heatmap: null, shots: [], similar: [], clubFit: [] },
      { title: 'Sparse' },
    );
    const types = sparse.map((block) => block.type);

    expect(types).not.toContain('RADAR');
    expect(types).not.toContain('HEATMAP');
    expect(types).not.toContain('SHOT_MAP');
    expect(types).not.toContain('CLUB_FIT');
  });
});

describe('renderReportHtml', () => {
  const meta = buildSnapshotMeta({ data }, [
    {
      key: 'scoutiq-demo',
      name: 'ScoutIQ Demo Data',
      version: 'demo-v1',
      licenceName: 'Fabricated demo content',
      attributionRequired: false,
    },
  ]);

  const html = renderReportHtml(
    {
      title: 'Scouting report - Sem de Vries',
      subject: 'Sem de Vries',
      subtitle: 'Demo Eredivisie 2025/2026',
      isDemo: true,
      blocks: buildPlayerReportBlocks(data, { title: 'Scouting report - Sem de Vries' }),
      quality: data.quality,
    },
    { organisation: 'ScoutIQ', baseUrl: 'https://scoutiq.example', meta },
  );

  it('produces a complete A4 document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('@page { size: A4');
    expect(html).toContain('Scouting report - Sem de Vries');
  });

  it('draws charts as inline SVG rather than embedding a screenshot (§51)', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('<polygon');
    expect(html).not.toContain('<img src="data:image/png');
  });

  it('labels fabricated content', () => {
    expect(html).toContain('DEMO DATA');
  });

  it('carries the methodology, data sources, quality and versions (§50, §53)', () => {
    expect(html).toContain('Data sources');
    expect(html).toContain('ScoutIQ Demo Data');
    expect(html).toContain('Methodology');
    expect(html).toContain('1980 minutes across 24 matches');
    expect(html).toContain(ANALYTICS_VERSION);
    expect(html).toContain(REPORT_VERSION);
    expect(html).toContain(meta.dataSnapshotId);
  });

  it('states that club fit is a model, not truth (§32)', () => {
    expect(html).toContain('not objective truth');
  });

  it('escapes user-supplied text', () => {
    const dangerous = renderReportHtml(
      {
        title: 'x',
        subject: '<script>alert(1)</script>',
        isDemo: false,
        blocks: [{ type: 'EXECUTIVE_SUMMARY', title: 'Summary', content: { text: '<img onerror=1>' } }],
        quality: data.quality,
      },
      { organisation: 'ScoutIQ', baseUrl: 'https://scoutiq.example', meta },
    );

    expect(dangerous).not.toContain('<script>alert(1)</script>');
    expect(dangerous).toContain('&lt;script&gt;');
  });
});

describe('snapshots (§52, §86)', () => {
  it('is content addressed, so identical data yields an identical id', () => {
    expect(snapshotId({ a: 1 })).toBe(snapshotId({ a: 1 }));
    expect(snapshotId({ a: 1 })).not.toBe(snapshotId({ a: 2 }));
  });

  it('records the analytics and report versions that produced it', () => {
    const meta = buildSnapshotMeta({ any: 'payload' }, []);
    expect(meta.analyticsVersion).toBe(ANALYTICS_VERSION);
    expect(meta.reportVersion).toBe(REPORT_VERSION);
  });
});

describe('humanise', () => {
  it('turns metric keys into readable labels', () => {
    expect(humanise('progressivePassesP90')).toBe('Progressive Passes per 90');
    expect(humanise('pass_accuracy')).toBe('Pass accuracy');
  });
});
