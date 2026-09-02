import { describe, expect, it } from 'vitest';
import { isValidCron } from '@/jobs/cron';

/** Cron validation guards the sync-schedule API (§58, §88 phase 8). */
describe('isValidCron', () => {
  it('accepts the expressions the app itself ships with', () => {
    for (const expression of ['0 4 * * *', '*/15 * * * *', '0 3 * * 0', '30 2 1 * *']) {
      expect(isValidCron(expression), expression).toBe(true);
    }
  });

  it('accepts lists, ranges and steps within a range', () => {
    expect(isValidCron('0,30 8-18 * * 1-5')).toBe(true);
    expect(isValidCron('0 8-18/2 * * *')).toBe(true);
  });

  it('rejects the wrong number of fields', () => {
    expect(isValidCron('0 4 * *')).toBe(false);
    expect(isValidCron('0 4 * * * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });

  it('rejects values outside their field range', () => {
    expect(isValidCron('60 4 * * *')).toBe(false);
    expect(isValidCron('0 24 * * *')).toBe(false);
    expect(isValidCron('0 4 32 * *')).toBe(false);
    expect(isValidCron('0 4 * 13 *')).toBe(false);
    expect(isValidCron('0 4 * * 8')).toBe(false);
  });

  it('accepts 7 as Sunday, as crontab does', () => {
    expect(isValidCron('0 4 * * 7')).toBe(true);
  });

  it('rejects nonsense that is not a number', () => {
    expect(isValidCron('every minute please')).toBe(false);
    expect(isValidCron('0 4 * * mon')).toBe(false);
    expect(isValidCron('0 4 * * */0')).toBe(false);
  });
});
