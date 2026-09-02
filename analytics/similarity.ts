/**
 * Player similarity (§30).
 *
 * Weighted cosine similarity over percentile vectors, computed within a
 * position group. Percentiles make the comparison league- and provider-neutral;
 * the weights let a scout ask "similar how?" rather than "similar overall".
 *
 * The result explains itself: which dimensions agree, which differ most (§85).
 */

export type StyleVector = Record<string, number>;

export interface SimilarityWeights {
  [metricKey: string]: number;
}

export interface DimensionComparison {
  metricKey: string;
  subject: number;
  comparison: number;
  difference: number;
  weight: number;
}

export interface SimilarityResult {
  similarity: number;
  /** Dimensions where the two players are closest. */
  agreements: DimensionComparison[];
  /** Dimensions where they differ most. */
  differences: DimensionComparison[];
  dimensions: number;
}

const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Weighted cosine similarity, rescaled to 0..1.
 *
 * Vectors are centred on 50 first: percentile vectors are all-positive, and
 * raw cosine on positive vectors compresses everything into 0.8-1.0, which
 * makes "similar" meaningless. Centring restores discrimination.
 */
export function weightedCosineSimilarity(
  a: StyleVector,
  b: StyleVector,
  weights: SimilarityWeights = {},
): SimilarityResult {
  const keys = Object.keys(a).filter((key) => key in b);

  if (keys.length === 0) {
    return { similarity: 0, agreements: [], differences: [], dimensions: 0 };
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  const comparisons: DimensionComparison[] = [];

  for (const key of keys) {
    const weight = weights[key] ?? 1;
    const subject = (a[key] as number) - 50;
    const comparison = (b[key] as number) - 50;

    dot += weight * subject * comparison;
    normA += weight * subject * subject;
    normB += weight * comparison * comparison;

    comparisons.push({
      metricKey: key,
      subject: a[key] as number,
      comparison: b[key] as number,
      difference: round(Math.abs((a[key] as number) - (b[key] as number)), 1),
      weight,
    });
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  // Both players exactly average on every dimension: identical, not undefined.
  const cosine = denominator === 0 ? 1 : dot / denominator;
  const similarity = round(Math.max(0, Math.min(1, (cosine + 1) / 2)));

  const sorted = [...comparisons].sort((x, y) => x.difference - y.difference);

  return {
    similarity,
    agreements: sorted.slice(0, 5),
    differences: sorted.slice(-5).reverse(),
    dimensions: keys.length,
  };
}

export interface SimilarityCandidate {
  playerId: string;
  positionGroup: string;
  vector: StyleVector;
}

export interface RankedSimilarity extends SimilarityResult {
  playerId: string;
}

/**
 * Rank candidates against a subject.
 *
 * Position-aware by default: comparing a centre-back's percentile profile to a
 * striker's is arithmetic without meaning, because they were ranked in
 * different populations.
 */
export function findSimilarPlayers(
  subject: SimilarityCandidate,
  candidates: readonly SimilarityCandidate[],
  options: { weights?: SimilarityWeights; limit?: number; samePositionOnly?: boolean } = {},
): RankedSimilarity[] {
  const { weights = {}, limit = 10, samePositionOnly = true } = options;

  return candidates
    .filter((candidate) => candidate.playerId !== subject.playerId)
    .filter((candidate) => !samePositionOnly || candidate.positionGroup === subject.positionGroup)
    .map((candidate) => ({
      playerId: candidate.playerId,
      ...weightedCosineSimilarity(subject.vector, candidate.vector, weights),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
