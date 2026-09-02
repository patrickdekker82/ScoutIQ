import { describe, expect, it } from 'vitest';
import { renderReport, reportKey } from '../src/domain/report.js';

const baseInput = {
  title: 'Scouting report: Sem de Vries',
  summary: 'Direct forward, strong first touch under pressure.',
  rating: 8,
  author: 'Patrick',
  generatedAt: new Date('2026-01-15T10:00:00.000Z'),
  reportId: 'report-1',
  baseUrl: 'https://scoutiq.example',
  player: {
    firstName: 'Sem',
    lastName: 'de Vries',
    position: 'FW',
    nationality: 'Netherlands',
    teamName: 'Ajax',
  },
};

describe('reportKey', () => {
  it('builds a relative key so REPORT_ROOT can move between machines', () => {
    const key = reportKey('2025/2026', 'player-1', 'report-1');
    expect(key).toBe('2025_2026/player-1/report-1.md');
    expect(key.startsWith('/')).toBe(false);
  });
});

describe('renderReport', () => {
  it('renders player details and metrics', () => {
    const document = renderReport({
      ...baseInput,
      metrics: {
        season: '2025/2026',
        matches: 24,
        minutesPlayed: 1980,
        goalsPer90: 0.68,
        assistsPer90: 0.23,
        xgPer90: 0.55,
        xaPer90: 0.19,
        passAccuracy: 0.812,
        progPassPer90: 4.2,
        duelWinRate: 0.541,
        scoutScore: 87.4,
      },
    });

    expect(document).toContain('# Scouting report: Sem de Vries');
    expect(document).toContain('**Player:** Sem de Vries');
    expect(document).toContain('| Goals /90 | 0.68 |');
    expect(document).toContain('81.2%');
    expect(document).toContain('**87.4/100**');
    expect(document).toContain('https://scoutiq.example/reports/report-1');
  });

  it('renders without analytics', () => {
    const document = renderReport({ ...baseInput, metrics: null });
    expect(document).toContain('_No analytics available for this player yet._');
  });
});
