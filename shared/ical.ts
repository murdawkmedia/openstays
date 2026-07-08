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
  const events: IcalEvent[] = [];
  const warnings: string[] = [];

  const lines = unfoldLines(icsText);

  // Split into VEVENT blocks (tolerant: ignores everything outside VEVENT).
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) {
    // Unterminated VEVENT — malformed, skip with a warning.
    warnings.push('Malformed VEVENT: missing END:VEVENT');
  }

  for (const block of blocks) {
    try {
      const event = parseVEvent(block);
      if (event === null) continue; // cancelled — silently skipped, not a warning
      events.push(event);
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : 'Malformed VEVENT: unknown error');
    }
  }

  return { events, warnings };
}

/** Unfold CRLF/LF-folded lines: a following line starting with space/tab is a continuation. */
function unfoldLines(icsText: string): string[] {
  const rawLines = icsText.split(/\r\n|\r|\n/);
  const unfolded: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** Split one content line into { name, params, value }, e.g. 'DTSTART;VALUE=DATE:20260715'. */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    params[part.slice(0, eqIdx).toUpperCase()] = part.slice(eqIdx + 1);
  }
  return { name, params, value };
}

/** Parse a DTSTART/DTEND-style value into an ISO 'YYYY-MM-DD' date, ignoring time/zone. */
function parseIcsDate(value: string): string | null {
  // VALUE=DATE form: '20260715'. Date-time form: '20260715T160000' or
  // '20260715T160000Z'. Either way, the first 8 digits are the date.
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

/** Add one day to an ISO 'YYYY-MM-DD' string (UTC arithmetic — date-only, safe). */
function addOneDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function parseVEvent(lines: string[]): IcalEvent | null {
  let uid: string | undefined;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let summary: string | undefined;
  let status: string | undefined;

  for (const rawLine of lines) {
    if (rawLine.trim() === '') continue;
    const parsed = splitLine(rawLine);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    switch (name) {
      case 'UID':
        uid = value.trim();
        break;
      case 'DTSTART': {
        const date = parseIcsDate(value);
        if (date === null) {
          throw new Error(`Malformed VEVENT: unparseable DTSTART "${value}"`);
        }
        startDate = date;
        void params; // params (VALUE=DATE, TZID=...) don't change the truncation logic
        break;
      }
      case 'DTEND': {
        const date = parseIcsDate(value);
        if (date === null) {
          throw new Error(`Malformed VEVENT: unparseable DTEND "${value}"`);
        }
        endDate = date;
        break;
      }
      case 'SUMMARY':
        summary = value.trim();
        break;
      case 'STATUS':
        status = value.trim().toUpperCase();
        break;
      default:
        break;
    }
  }

  if (status === 'CANCELLED') return null;

  if (!uid) {
    throw new Error('Malformed VEVENT: missing UID');
  }
  if (!startDate) {
    throw new Error(`Malformed VEVENT: missing/unparseable DTSTART (uid=${uid})`);
  }
  if (!endDate) {
    endDate = addOneDay(startDate);
  }

  return { uid, startDate, endDate, summary };
}
