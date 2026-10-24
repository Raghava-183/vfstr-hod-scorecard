/**
 * The academic years the score card holds.
 *
 * To open a new year: add its id to the end of YEARS here, and add a matching
 * entry to meta.years in public/metrics.json (seeded:false so its responses
 * start empty). Both lists must agree — this one guards the API, the other
 * builds the tabs in the browser.
 */
export const YEARS = ['2025-26', '2026-27'];

/** The year the page opens on, and the year existing rows are stamped with. */
export const DEFAULT_YEAR = '2025-26';

/** Returns the year if it is one we hold, otherwise null. */
export function validYear(y) {
  const s = String(y ?? '').trim();
  return YEARS.includes(s) ? s : null;
}
