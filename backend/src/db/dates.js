/**
 * Date/time helpers for shaping SQL results for the API.
 * node-pg returns DATE columns as a Date at *local* midnight, so the
 * local getters reconstruct the calendar day that was stored (never
 * toISOString(), which would shift it in negative-offset zones).
 */
function toIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when a string looks like YYYY-MM-DD. */
function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** True when a string looks like HH:MM or HH:MM:SS. */
function isClockTime(value) {
  return typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value);
}

/** Normalise 'H:MM' / 'HH:MM:SS' → 'HH:MM' for the frontend. */
function shortClock(value) {
  return typeof value === 'string' ? value.slice(0, 5) : null;
}

module.exports = { toIsoDate, isIsoDate, isClockTime, shortClock };
