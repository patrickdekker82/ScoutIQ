/**
 * Analytics version (§53).
 *
 * Every derived row and every report records the version that produced it, so
 * formulas can evolve without invalidating historical output. Bump the MINOR
 * part when a formula changes, the MAJOR part when the meaning of a score
 * changes.
 */
export const ANALYTICS_VERSION = 'scoutiq-analytics-v1.0';

/** Version of the report layout/renderer, recorded alongside (§52). */
export const REPORT_VERSION = 'scoutiq-report-v1.0';
