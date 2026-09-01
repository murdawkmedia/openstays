import { describe, expect, it } from 'vitest';

import {
  BOOKING_OPERATIONAL_FLAG_KINDS,
  HOUSEKEEPING_CLEANING_TYPES,
  normalizeDailyOperationsText,
  parseFrontDeskQuery,
} from './dailyOperations';

describe('daily operations vocabulary', () => {
  it('keeps operational conditions separate from booking status', () => {
    expect(BOOKING_OPERATIONAL_FLAG_KINDS).toEqual([
      'late_checkout',
      'due_out',
      'departure_overdue',
      'lockout',
      'sleep_out',
      'payment_concern',
    ]);
    expect(HOUSEKEEPING_CLEANING_TYPES).toEqual([
      'turnover',
      'stayover',
      'inspection',
      'deep_clean',
      'custom',
    ]);
  });

  it('normalizes bounded notes without retaining whitespace noise', () => {
    expect(normalizeDailyOperationsText('  inspect   porch  ', 80)).toBe('inspect porch');
    expect(() => normalizeDailyOperationsText('x'.repeat(81), 80)).toThrow('TEXT_TOO_LONG');
  });

  it('normalizes invalid deep-link values to safe defaults', () => {
    expect(parseFrontDeskQuery(new URLSearchParams('queue=bogus&mode=bogus'))).toMatchObject({
      queue: 'arriving',
      mode: 'compact',
      selectedId: undefined,
    });
  });
});
