import { describe, expect, it } from 'vitest';
import { assessQuality, isReportable } from '@/analytics/quality';

/** Data quality and confidence (§54). */
describe('assessQuality', () => {
  it('calls a full season of minutes high confidence', () => {
    const result = assessQuality({ minutes: 2847, matches: 31, coverage: 1 });
    expect(result.confidence).toBe('HIGH');
    expect(result.summary).toContain('2847 minutes');
    expect(result.summary).toContain('31 matches');
  });

  it('calls a handful of appearances low confidence', () => {
    expect(assessQuality({ minutes: 214, matches: 4 }).confidence).toBe('LOW');
  });

  it('refuses to report on almost no data', () => {
    const result = assessQuality({ minutes: 45, matches: 1 });
    expect(result.confidence).toBe('INSUFFICIENT');
    expect(isReportable(result)).toBe(false);
    expect(result.summary).toContain('Insufficient data');
  });

  it('downgrades when half the required metrics are missing', () => {
    const full = assessQuality({ minutes: 2000, matches: 25, coverage: 1 });
    const partial = assessQuality({ minutes: 2000, matches: 25, coverage: 0.4 });

    expect(full.confidence).toBe('HIGH');
    expect(partial.confidence).toBe('LOW');
  });

  it('carries the missing fields and providers through', () => {
    const result = assessQuality({
      minutes: 1000,
      matches: 12,
      missingFields: ['distanceP90'],
      providerKeys: ['statsbomb-open'],
    });

    expect(result.missingFields).toEqual(['distanceP90']);
    expect(result.providerKeys).toEqual(['statsbomb-open']);
  });
});
