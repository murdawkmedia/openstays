import { describe, expect, it } from 'vitest';

import crons from './crons';

describe('scheduled reconciliation backstops', () => {
  it('polls pending Zaprite orders every minute when a webhook is delayed or omitted', () => {
    expect(crons.crons['zaprite payment reconciliation']).toMatchObject({
      name: 'payments/webhooks:reconcileZapritePending',
      args: [{ limit: 25 }],
      schedule: {
        type: 'interval',
        minutes: 1,
      },
    });
  });
});
