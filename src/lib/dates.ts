// Date helpers for the client. Stay dates are property-local ISO 'YYYY-MM-DD'
// strings (see CLAUDE.md convention #2) — never build them with `new Date()`
// math directly. This file re-exports the shared pure helpers plus a couple
// of small client-only conveniences (ISO <-> Date conversions for
// react-day-picker, which wants real `Date` objects).

import { addDays, daysBetween, isIsoDate } from '../../shared/pricing';

export { addDays, daysBetween, isIsoDate };

/**
 * Today's ISO date. Client-side "today" is a display/UX convenience only —
 * the server re-derives and enforces its own property-local "today" for any
 * rule that matters (lead time, advance window). Falls back to the browser's
 * local timezone since the client doesn't always know the property's tz yet
 * (e.g. the home page before a property is chosen).
 */
export function todayIso(timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Parse an ISO 'YYYY-MM-DD' string into a local-midnight Date (for react-day-picker). */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a react-day-picker Date selection back into an ISO 'YYYY-MM-DD' string. */
export function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Format an ISO date for display, e.g. '2026-07-10' -> 'Fri, Jul 10, 2026'. */
export function formatDisplayDate(iso: string): string {
  return isoToDate(iso).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Format mm:ss from a millisecond duration (for the hold countdown). Clamps at 0. */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
