// ---------------------------------------------------------------------------
// Email templates (M1, builder E) — PURE functions: data in, {subject, html,
// text} out. No ctx, no fetch, no Date.now() — fully unit-testable.
// Money is formatted with shared/currency.ts formatMoney using the property's
// currency; dates are shown as-is (property-local ISO strings).
// ---------------------------------------------------------------------------

export type BookingEmailData = {
  guestName: string;
  propertyName: string;
  propertyEmail: string;
  propertyPhone: string;
  unitTypeName: string;
  checkIn: string; // 'YYYY-MM-DD'
  checkOut: string;
  nights: number;
  confirmationCode: string;
  currency: string;
  taxLabel: string;
  totalCents: number;
  paidCents: number;
  balanceDueCents: number;
  manageUrl: string; // `${SITE_URL}/manage/${confirmationCode}`
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderConfirmation(data: BookingEmailData): RenderedEmail {
  // builder E — real template. Placeholder keeps the contract compiling.
  return {
    subject: `Booking confirmed — ${data.confirmationCode}`,
    html: `<p>Booking ${data.confirmationCode} confirmed.</p>`,
    text: `Booking ${data.confirmationCode} confirmed.`,
  };
}

export function renderCancellation(data: BookingEmailData & { refundCents: number }): RenderedEmail {
  return {
    subject: `Booking cancelled — ${data.confirmationCode}`,
    html: `<p>Booking ${data.confirmationCode} cancelled.</p>`,
    text: `Booking ${data.confirmationCode} cancelled.`,
  };
}

export function renderPaymentConflict(data: BookingEmailData): RenderedEmail {
  return {
    subject: `About your payment — ${data.propertyName}`,
    html: `<p>Your payment arrived after your hold expired; a full refund is on its way.</p>`,
    text: `Your payment arrived after your hold expired; a full refund is on its way.`,
  };
}
