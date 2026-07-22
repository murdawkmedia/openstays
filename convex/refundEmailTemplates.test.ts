import { describe, expect, it } from 'vitest';
import { renderManualRefundCompleted, renderManualRefundRequired } from './emailTemplates';

const data = {
  guestName: 'Ada', propertyName: 'Consensus Commons', propertyEmail: 'staff@example.com', propertyPhone: '555',
  unitTypeName: 'Node Room', checkIn: '2026-07-23', checkOut: '2026-07-24', nights: 1,
  confirmationCode: 'OS-ADA123', currency: 'CAD', taxLabel: 'HST', totalCents: 10_000,
  paidCents: 10_000, balanceDueCents: 0, manageUrl: 'https://example.com/manage/OS-ADA123',
  refundCents: 2_500, reason: 'overpayment',
};

describe('manual refund notices', () => {
  it('tells staff action is required without claiming success', () => {
    const email = renderManualRefundRequired(data);
    expect(email.subject).toContain('Manual refund required');
    expect(email.text).toContain('$25.00');
    expect(email.text).not.toContain('has been completed');
  });
  it('tells the guest only after completion and includes the external reference', () => {
    const email = renderManualRefundCompleted({ ...data, externalReference: 'signet-tx-123' });
    expect(email.text).toContain('has been completed');
    expect(email.text).toContain('signet-tx-123');
  });
});
