import { describe, expect, it } from 'vitest';
import { SqlValidationError, validateSelect } from '@/server/services/sql.service';

/** SQL console safety (§23). */
describe('validateSelect', () => {
  it('accepts a SELECT and a CTE', () => {
    expect(validateSelect('SELECT 1')).toBe('SELECT 1');
    expect(validateSelect('WITH x AS (SELECT 1) SELECT * FROM x;')).toBe(
      'WITH x AS (SELECT 1) SELECT * FROM x',
    );
  });

  it('rejects every write statement', () => {
    for (const sql of [
      'DELETE FROM players',
      'UPDATE players SET "fullName" = 1',
      'INSERT INTO players DEFAULT VALUES',
      'DROP TABLE players',
      'TRUNCATE players',
      'ALTER TABLE players ADD COLUMN x int',
      'GRANT ALL ON players TO public',
      'REFRESH MATERIALIZED VIEW mv_player_percentiles',
    ]) {
      expect(() => validateSelect(sql)).toThrow(SqlValidationError);
    }
  });

  it('rejects stacked statements', () => {
    expect(() => validateSelect('SELECT 1; DROP TABLE players')).toThrow(/single statement/i);
  });

  it('rejects SELECT ... INTO, which would create a table', () => {
    expect(() => validateSelect('SELECT * INTO evil FROM players')).toThrow(/INTO/i);
  });

  it('does not trip over a keyword inside a string literal or comment', () => {
    expect(() =>
      validateSelect(`SELECT * FROM players WHERE "fullName" = 'delete this player'`),
    ).not.toThrow();
    expect(() => validateSelect('SELECT 1 -- drop table players')).not.toThrow();
    expect(() => validateSelect('SELECT 1 /* update everything */')).not.toThrow();
  });

  it('rejects an empty query', () => {
    expect(() => validateSelect('   ')).toThrow(/empty/i);
  });
});
