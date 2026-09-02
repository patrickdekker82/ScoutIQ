import { Confidence } from '@prisma/client';

/**
 * Data quality and confidence (§54).
 *
 * Every metric surface exposes how much data is behind it. A number computed
 * from 214 minutes is not the same claim as one computed from 2847 minutes,
 * and ScoutIQ never presents them as if it were.
 */

export interface QualityInput {
  minutes: number;
  matches: number;
  /** 0-1: fraction of the required inputs that were actually present. */
  coverage?: number;
  missingFields?: string[];
  providerKeys?: string[];
}

export interface QualityAssessment {
  confidence: Confidence;
  minutes: number;
  matches: number;
  sampleSize: number;
  coverage: number;
  missingFields: string[];
  providerKeys: string[];
  /** Short sentence suitable for display next to a score. */
  summary: string;
}

/**
 * Confidence bands.
 *
 * The LOW floor is deliberately two matches' worth of football: §54 uses
 * "Confidence: Low, Minutes: 214" as its own example of a reportable but weak
 * sample, and anything below that is not worth ranking a player on.
 */
const THRESHOLDS = {
  high: { minutes: 1800, matches: 20 },
  medium: { minutes: 900, matches: 10 },
  low: { minutes: 180, matches: 2 },
} as const;

export function assessQuality(input: QualityInput): QualityAssessment {
  const coverage = input.coverage ?? 1;
  const { minutes, matches } = input;

  let confidence: Confidence;
  if (minutes >= THRESHOLDS.high.minutes && matches >= THRESHOLDS.high.matches && coverage >= 0.8) {
    confidence = Confidence.HIGH;
  } else if (
    minutes >= THRESHOLDS.medium.minutes &&
    matches >= THRESHOLDS.medium.matches &&
    coverage >= 0.5
  ) {
    confidence = Confidence.MEDIUM;
  } else if (minutes >= THRESHOLDS.low.minutes && matches >= THRESHOLDS.low.matches) {
    confidence = Confidence.LOW;
  } else {
    confidence = Confidence.INSUFFICIENT;
  }

  const label =
    confidence === Confidence.INSUFFICIENT ? 'Insufficient data' : `Confidence: ${titleCase(confidence)}`;

  return {
    confidence,
    minutes,
    matches,
    sampleSize: matches,
    coverage: Math.round(coverage * 100) / 100,
    missingFields: input.missingFields ?? [],
    providerKeys: input.providerKeys ?? [],
    summary: `${label} - ${minutes} minutes across ${matches} ${matches === 1 ? 'match' : 'matches'}`,
  };
}

const titleCase = (value: string): string =>
  value.charAt(0) + value.slice(1).toLowerCase();

/** Should a score be shown at all, or only shown with a warning? */
export const isReportable = (assessment: QualityAssessment): boolean =>
  assessment.confidence !== Confidence.INSUFFICIENT;
