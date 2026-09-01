import { describe, expect, it } from 'vitest';

import { filterFrontDeskRows, parseFrontDeskViewState, serializeFrontDeskViewState } from './frontDeskViewState';

describe('front desk view state', () => {
  it('round-trips the selected date, queue, mode, filters, and record', () => {
    const state = parseFrontDeskViewState(new URLSearchParams(
      'date=2030-05-03&queue=needsAttention&mode=detailed&q=cabin&flag=lockout&readiness=dirty&balance=open&assignee=s1&record=b1',
    ));
    expect(serializeFrontDeskViewState(state).toString()).toBe(
      'date=2030-05-03&queue=needsAttention&mode=detailed&q=cabin&flag=lockout&readiness=dirty&balance=open&assignee=s1&record=b1',
    );
  });

  it('falls back safely when URL values are malformed', () => {
    const state = parseFrontDeskViewState(new URLSearchParams('date=not-a-date&queue=made-up&mode=wide'), 'UTC');
    expect(state.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state).toMatchObject({ queue: 'arriving', mode: 'compact', query: '' });
  });

  it('filters without changing the server-owned queue membership', () => {
    const rows = [
      { bookingId: 'b1', guestName: 'Sample Guest', confirmationCode: 'A1', unitName: 'Cabin 1', readiness: 'dirty', balanceCents: 100, openFlags: [{ kind: 'lockout', severity: 'urgent', assignedStaffProfileId: 's1' }] },
      { bookingId: 'b2', guestName: 'Other Guest', confirmationCode: 'A2', unitName: 'Cabin 2', readiness: 'ready', balanceCents: 0, openFlags: [] },
    ];
    expect(filterFrontDeskRows(rows, { query: 'cabin 1', flag: 'lockout', readiness: 'dirty', balance: 'open', assignee: 's1' })).toEqual([rows[0]]);
    expect(filterFrontDeskRows(rows, { query: '', balance: 'settled' })).toEqual([rows[1]]);
    expect(rows).toHaveLength(2);
  });
});
