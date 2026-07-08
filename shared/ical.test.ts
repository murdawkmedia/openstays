import { describe, expect, it } from 'vitest';
import { parseIcs } from './ical';

describe('parseIcs', () => {
  it('parses a single VALUE=DATE all-day event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:event-1@airbnb.com',
      'DTSTART;VALUE=DATE:20260715',
      'DTEND;VALUE=DATE:20260718',
      'SUMMARY:Reserved',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toEqual([
      { uid: 'event-1@airbnb.com', startDate: '2026-07-15', endDate: '2026-07-18', summary: 'Reserved' },
    ]);
  });

  it('unfolds CRLF-folded lines with a leading space continuation', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:folded-1@example.com',
      'DTSTART;VALUE=DATE:20260801',
      'DTEND;VALUE=DATE:20260805',
      'SUMMARY:This is a very long summary line that has been',
      ' folded across two physical lines per RFC 5545',
      'END:VEVENT',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe(
      'This is a very long summary line that has beenfolded across two physical lines per RFC 5545',
    );
  });

  it('unfolds LF-folded lines with a leading tab continuation', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:folded-2@example.com',
      'DTSTART;VALUE=DATE:20260801',
      'DTEND;VALUE=DATE:20260805',
      'SUMMARY:Tab\tfolded summary',
    ]
      .join('\n')
      // Simulate a genuine RFC 5545 fold: "SUMMARY:Tab" + "\n\tfolded summary"
      .replace('SUMMARY:Tab\tfolded summary', 'SUMMARY:Tab\n\tfolded summary') + '\nEND:VEVENT';

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events[0].summary).toBe('Tabfolded summary');
  });

  it('parses date-time DTSTART/DTEND with TZID, truncating to the date part', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:tz-event@example.com',
      'DTSTART;TZID=America/Edmonton:20260715T160000',
      'DTEND;TZID=America/Edmonton:20260718T110000',
      'END:VEVENT',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toEqual([{ uid: 'tz-event@example.com', startDate: '2026-07-15', endDate: '2026-07-18' }]);
  });

  it('parses UTC date-time (trailing Z) DTSTART/DTEND, truncating to the date part', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:utc-event@example.com',
      'DTSTART:20260901T000000Z',
      'DTEND:20260903T000000Z',
      'END:VEVENT',
    ].join('\r\n');

    const { events } = parseIcs(ics);
    expect(events).toEqual([{ uid: 'utc-event@example.com', startDate: '2026-09-01', endDate: '2026-09-03' }]);
  });

  it('defaults to a single-night event when DTEND is missing', () => {
    const ics = ['BEGIN:VEVENT', 'UID:no-end@example.com', 'DTSTART;VALUE=DATE:20260710', 'END:VEVENT'].join(
      '\r\n',
    );

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toEqual([{ uid: 'no-end@example.com', startDate: '2026-07-10', endDate: '2026-07-11' }]);
  });

  it('skips STATUS:CANCELLED events silently (no warning)', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:cancelled-1@example.com',
      'DTSTART;VALUE=DATE:20260710',
      'DTEND;VALUE=DATE:20260712',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:active-1@example.com',
      'DTSTART;VALUE=DATE:20260720',
      'DTEND;VALUE=DATE:20260722',
      'END:VEVENT',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('active-1@example.com');
  });

  it('collects a warning (never throws) for a VEVENT missing UID', () => {
    const ics = ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260710', 'DTEND;VALUE=DATE:20260712', 'END:VEVENT'].join(
      '\r\n',
    );

    expect(() => parseIcs(ics)).not.toThrow();
    const { events, warnings } = parseIcs(ics);
    expect(events).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/UID/);
  });

  it('collects a warning (never throws) for an unparseable DTSTART', () => {
    const ics = ['BEGIN:VEVENT', 'UID:bad-date@example.com', 'DTSTART:not-a-date', 'END:VEVENT'].join('\r\n');

    expect(() => parseIcs(ics)).not.toThrow();
    const { events, warnings } = parseIcs(ics);
    expect(events).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/DTSTART/);
  });

  it('one malformed VEVENT does not prevent parsing the rest of the feed', () => {
    const ics = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260710', // missing UID
      'DTEND;VALUE=DATE:20260712',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:good-1@example.com',
      'DTSTART;VALUE=DATE:20260801',
      'DTEND;VALUE=DATE:20260803',
      'END:VEVENT',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('good-1@example.com');
    expect(warnings).toHaveLength(1);
  });

  it('parses a multi-event realistic Airbnb-style feed', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260715',
      'DTEND;VALUE=DATE:20260718',
      'UID:11111111-2222-3333-4444-555555555555@airbnb.com',
      'SUMMARY:Reserved',
      'DESCRIPTION:Reservation URL: https://www.airbnb.com/reservation/details/ABC12345',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260801',
      'DTEND;VALUE=DATE:20260803',
      'UID:66666666-7777-8888-9999-000000000000@airbnb.com',
      'SUMMARY:Airbnb (Not available)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { events, warnings } = parseIcs(ics);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ startDate: '2026-07-15', endDate: '2026-07-18' });
    expect(events[1]).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-03' });
  });

  it('is pure: parsing the same input twice yields equal results', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:pure-check@example.com',
      'DTSTART;VALUE=DATE:20260715',
      'DTEND;VALUE=DATE:20260718',
      'END:VEVENT',
    ].join('\r\n');

    expect(parseIcs(ics)).toEqual(parseIcs(ics));
  });
});
