import { describe, expect, it } from 'vitest';
import { FUZZY_THRESHOLD, nameSimilarity, normaliseName } from '@/server/services/entity-resolution';

/** Entity matching (§55, §87). */
describe('normaliseName', () => {
  it('strips accents, punctuation and case', () => {
    expect(normaliseName('Lionel Andrés Messi')).toBe('lionel andres messi');
    expect(normaliseName("N'Golo Kanté")).toBe('ngolo kante');
    expect(normaliseName('  Jan   de  Vries ')).toBe('jan de vries');
  });
});

describe('nameSimilarity', () => {
  it('scores identical names as 1', () => {
    expect(nameSimilarity('Jan de Vries', 'jan de vries')).toBe(1);
  });

  it('matches an abbreviated first name above the threshold', () => {
    expect(nameSimilarity('Jan de Vries', 'J. de Vries')).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it('keeps different players apart', () => {
    expect(nameSimilarity('Jan de Vries', 'Jan de Boer')).toBeLessThan(FUZZY_THRESHOLD);
    expect(nameSimilarity('Sem Bakker', 'Luuk Jansen')).toBeLessThan(0.4);
  });

  it('handles accents on one side only', () => {
    expect(nameSimilarity('Kante', 'Kanté')).toBe(1);
  });

  it('returns 0 for an empty name', () => {
    expect(nameSimilarity('', 'Someone')).toBe(0);
  });
});
