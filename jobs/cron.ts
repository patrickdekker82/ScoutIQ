/**
 * Minimal five-field cron validation (§58).
 *
 * BullMQ parses the expression itself; this exists so an invalid schedule is
 * refused at the API boundary with a clear message instead of failing silently
 * inside a worker hours later.
 */

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (7 = Sunday, as crontab allows)
];

const fieldValid = (field: string, [min, max]: [number, number]): boolean =>
  field.split(',').every((part) => {
    const [range, stepText] = part.split('/');
    if (stepText !== undefined) {
      const step = Number(stepText);
      if (!Number.isInteger(step) || step < 1) return false;
    }
    if (range === undefined || range === '') return false;
    if (range === '*') return true;

    const bounds = range.split('-');
    if (bounds.length > 2) return false;

    return bounds.every((value) => {
      const number = Number(value);
      return Number.isInteger(number) && number >= min && number <= max;
    });
  });

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => fieldValid(field, RANGES[index] as [number, number]));
}
