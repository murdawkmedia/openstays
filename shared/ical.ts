// ---------------------------------------------------------------------------
// Tolerant iCal (RFC 5545) parsing for calendar IMPORT (M1, builder E).
// Pure + dependency-free, mirrored after shared/pricing.ts: usable from Convex
// actions and unit tests alike. Only the subset real-world feeds (Airbnb,
// VRBO, other PMSes) actually emit — VEVENT blocks with UID/DTSTART/DTEND.
// ---------------------------------------------------------------------------

export type IcalEvent = {
  uid: string;
  /** Property-local ISO 'YYYY-MM-DD'. All-day DTSTART;VALUE=DATE preferred. */
  startDate: string;
  /** EXCLUSIVE end date (iCal DTEND all-day is already exclusive — keep it). */
  endDate: string;
  summary?: string;
};

/**
 * Parse .ics text → events. Requirements (builder E):
 * - Unfold folded lines (CRLF + leading space/tab per RFC 5545 §3.1).
 * - DTSTART/DTEND: VALUE=DATE ('20260715') AND date-time forms
 *   ('20260715T160000Z') — date-times truncate to their date part.
 * - Missing DTEND → single-night event (endDate = startDate + 1 day).
 * - Skip malformed VEVENTs (missing UID or unparseable dates) — collect a
 *   warning instead of throwing; one bad event must not kill a sync.
 * - STATUS:CANCELLED events are skipped.
 * - No timezone database: date-times taken at face (date part). Airbnb/VRBO
 *   availability feeds are all-day events; document the limitation.
 */
export function parseIcs(icsText: string): { events: IcalEvent[]; warnings: string[] } {
  // builder E — placeholder keeps contract compiling; returns nothing parsed.
  void icsText;
  return { events: [], warnings: ['NOT_IMPLEMENTED: parseIcs (builder E)'] };
}
