import { describe, expect, it } from 'vitest';

import { parseHousekeepingViewState, serializeHousekeepingViewState } from './housekeepingViewState';

describe('housekeeping view state', () => {
  it('round-trips board, assignment, and audit filters', () => {
    const state = parseHousekeepingViewState(new URLSearchParams(
      'date=2030-05-03&view=audit&state=inspection&group=g1&type=t1&assignee=s1&cleaning=turnover&priority=2&result=failed&record=a1',
    ));
    expect(serializeHousekeepingViewState(state).toString()).toBe(
      'date=2030-05-03&view=audit&state=inspection&group=g1&type=t1&assignee=s1&cleaning=turnover&priority=2&result=failed&record=a1',
    );
  });

  it('uses safe defaults for malformed values', () => {
    expect(parseHousekeepingViewState(new URLSearchParams('view=unknown&priority=-9'))).toMatchObject({ view: 'board', priority: undefined });
  });
});
