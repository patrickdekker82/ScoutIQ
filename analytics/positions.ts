/**
 * Position vocabulary.
 *
 * Providers describe positions differently ("Left Center Back", "LCB", "DF").
 * Everything funnels into four groups, which are the populations percentiles
 * and role scores are computed within (§26).
 */

export const POSITION_GROUPS = ['GK', 'DF', 'MF', 'FW'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

const PATTERNS: [RegExp, PositionGroup][] = [
  [/\b(gk|goal\s*keeper|keeper|portero|doelman)\b/i, 'GK'],
  [/\b(cb|lcb|rcb|lb|rb|lwb|rwb|wb|df|def|defender|back)\b/i, 'DF'],
  [/\b(cdm|dm|cm|lcm|rcm|cam|am|lm|rm|mf|mid|midfield)\b/i, 'MF'],
  [/\b(lw|rw|lf|rf|cf|st|ss|fw|forward|striker|winger|attacker)\b/i, 'FW'],
];

/** Map any provider position string onto a canonical group. */
export function positionGroup(position: string | null | undefined): PositionGroup {
  if (!position) return 'MF';
  const value = position.trim();

  for (const [pattern, group] of PATTERNS) {
    if (pattern.test(value)) return group;
  }

  // Fall back on a prefix check for compact codes without word boundaries.
  const upper = value.toUpperCase();
  if (upper.startsWith('GK')) return 'GK';
  if (/^(CB|LB|RB|LWB|RWB|DF)/.test(upper)) return 'DF';
  if (/^(CDM|CM|CAM|DM|AM|LM|RM|MF)/.test(upper)) return 'MF';
  if (/^(LW|RW|CF|ST|FW)/.test(upper)) return 'FW';

  return 'MF';
}

export const isPositionGroup = (value: string): value is PositionGroup =>
  (POSITION_GROUPS as readonly string[]).includes(value);
