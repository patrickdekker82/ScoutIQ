import type { EntityType, PrismaClient } from '@prisma/client';
import { MappingMethod } from '@prisma/client';

/**
 * Entity resolution (§55).
 *
 * A provider's identifier is resolved to a ScoutIQ entity through
 * external_entity_mappings. Provider IDs are trusted first; only when a
 * provider offers no ID does the resolver fall back to name matching, and it
 * records which method it used and how confident it was, so a human can review
 * (and a merge can be audited).
 */

export interface ResolutionResult {
  internalId: string;
  method: MappingMethod;
  confidence: number;
  created: boolean;
}

/** Normalise a name for comparison: no accents, no punctuation, lower case. */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] as number;
}

/**
 * Similarity of two names, 0..1.
 *
 * Combines a Levenshtein ratio with shared-token overlap, so "Jan de Vries"
 * and "J. de Vries" match while "Jan de Vries" and "Jan de Boer" do not.
 * Never used without a threshold.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const distance = levenshtein(left, right);
  const ratio = 1 - distance / Math.max(left.length, right.length);

  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');

  // A single-letter token is an initial: "j" matches "jan" but not "sem".
  // Providers abbreviate first names constantly, and treating an initial as a
  // mismatch would split one player into two.
  const tokensMatch = (a: string, b: string): boolean =>
    a === b ||
    (a.length === 1 && b.startsWith(a)) ||
    (b.length === 1 && a.startsWith(b));

  const unmatched = [...rightTokens];
  let shared = 0;
  for (const token of leftTokens) {
    const index = unmatched.findIndex((candidate) => tokensMatch(token, candidate));
    if (index >= 0) {
      shared += 1;
      unmatched.splice(index, 1);
    }
  }
  const tokenScore = shared / Math.max(leftTokens.length, rightTokens.length);

  // Token agreement is weighted higher than raw edit distance: an abbreviated
  // first name changes many characters but no identity.
  return Math.round((ratio * 0.35 + tokenScore * 0.65) * 1000) / 1000;
}

export const FUZZY_THRESHOLD = 0.86;

const lastToken = (value: string): string => {
  const parts = normaliseName(value).split(' ');
  return parts[parts.length - 1] ?? value;
};

export class EntityResolver {
  constructor(private readonly prisma: PrismaClient) {}

  async lookup(
    providerId: string,
    entityType: EntityType,
    externalId: string,
  ): Promise<string | null> {
    const mapping = await this.prisma.externalEntityMapping.findUnique({
      where: { providerId_entityType_externalId: { providerId, entityType, externalId } },
      select: { internalId: true },
    });
    return mapping?.internalId ?? null;
  }

  async record(
    providerId: string,
    entityType: EntityType,
    externalId: string,
    internalId: string,
    method: MappingMethod = MappingMethod.PROVIDER_ID,
    confidence = 1,
  ): Promise<void> {
    await this.prisma.externalEntityMapping.upsert({
      where: { providerId_entityType_externalId: { providerId, entityType, externalId } },
      update: { internalId, method, confidence },
      create: { providerId, entityType, externalId, internalId, method, confidence },
    });
  }

  /**
   * Find an existing player by name and date of birth.
   *
   * Date of birth is decisive when both sides have it: the same name and the
   * same birth date is the same person; the same name and a different birth
   * date is not.
   */
  async matchPlayerByName(
    fullName: string,
    dateOfBirth: Date | null,
  ): Promise<{ id: string; confidence: number; method: MappingMethod } | null> {
    if (dateOfBirth) {
      const exact = await this.prisma.player.findFirst({
        where: { fullName: { equals: fullName, mode: 'insensitive' }, dateOfBirth },
        select: { id: true },
      });
      if (exact) return { id: exact.id, confidence: 1, method: MappingMethod.EXACT };
    }

    const candidates = await this.prisma.player.findMany({
      where: dateOfBirth
        ? { dateOfBirth }
        : { fullName: { contains: lastToken(fullName), mode: 'insensitive' } },
      select: { id: true, fullName: true },
      take: 50,
    });

    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = nameSimilarity(fullName, candidate.fullName);
      if (!best || score > best.score) best = { id: candidate.id, score };
    }

    if (best && best.score >= FUZZY_THRESHOLD) {
      return { id: best.id, confidence: best.score, method: MappingMethod.FUZZY };
    }
    return null;
  }

  async matchTeamByName(name: string, countryId: string | null): Promise<string | null> {
    const exact = await this.prisma.team.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(countryId ? { countryId } : {}) },
      select: { id: true },
    });
    if (exact) return exact.id;

    const alias = await this.prisma.teamAlias.findFirst({
      where: { alias: { equals: name, mode: 'insensitive' } },
      select: { teamId: true },
    });
    if (alias) return alias.teamId;

    const candidates = await this.prisma.team.findMany({
      where: countryId ? { countryId } : {},
      select: { id: true, name: true },
      take: 200,
    });

    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = nameSimilarity(name, candidate.name);
      if (!best || score > best.score) best = { id: candidate.id, score };
    }

    return best && best.score >= FUZZY_THRESHOLD ? best.id : null;
  }
}
