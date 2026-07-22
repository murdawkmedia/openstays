import { describe, expect, it } from 'vitest';
import { renderConsensusReceiptReady, renderManualRefundCompleted, renderManualRefundRequired } from './emailTemplates';

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

describe('consensus receipt notice', () => {
  it('links the receipt and 210-sat signet reward without claiming a Bitcoin anchor', () => {
    const email = renderConsensusReceiptReady({ ...data, receiptId: 'cr_demo', receiptSha256: 'a'.repeat(64) });
    expect(email.subject).toContain('Consensus receipt ready');
    expect(email.text).toContain('210 signet sats');
    expect(email.text).toContain(data.manageUrl);
    expect(email.text).toContain('anchoring is pending');
    expect(email.text).not.toContain('anchored to Bitcoin');
  });
});
