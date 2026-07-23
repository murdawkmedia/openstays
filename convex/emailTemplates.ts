// ---------------------------------------------------------------------------
// Email templates (M1, builder E) — PURE functions: data in, {subject, html,
// text} out. No ctx, no fetch, no Date.now() — fully unit-testable.
// Money is formatted with shared/currency.ts formatMoney using the property's
// currency; dates are shown as-is (property-local ISO strings).
// ---------------------------------------------------------------------------

import { formatMoney, taxLabelOrDefault } from '../shared/currency';

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

/** 'YYYY-MM-DD' -> 'Jul 15, 2026'. No Date math beyond a lookup table; pure. */
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
function formatDisplayDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  const monthName = MONTH_NAMES[Number(m) - 1];
  if (!monthName) return isoDate;
  return `${monthName} ${Number(d)}, ${y}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared email-client-safe wrapper: table-based layout, inline styles, no external assets. */
function wrapHtml(data: BookingEmailData, bodyHtml: string): string {
  const propertyName = escapeHtml(data.propertyName);
  return [
    '<!doctype html>',
    '<html>',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">',
    '<tr><td style="background-color:#1f2937;padding:20px 32px;">',
    `<span style="color:#ffffff;font-size:18px;font-weight:bold;">${propertyName}</span>`,
    '</td></tr>',
    '<tr><td style="padding:32px;color:#111827;font-size:15px;line-height:1.5;">',
    bodyHtml,
    '</td></tr>',
    '<tr><td style="padding:20px 32px;background-color:#f9fafb;color:#6b7280;font-size:12px;">',
    `${propertyName} &middot; ${escapeHtml(data.propertyEmail)} &middot; ${escapeHtml(data.propertyPhone)}`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

function detailsTableHtml(data: BookingEmailData): string {
  const taxLabel = taxLabelOrDefault(data.taxLabel);
  const rows: Array<[string, string]> = [
    ['Confirmation code', data.confirmationCode],
    ['Unit type', escapeHtml(data.unitTypeName)],
    ['Check-in', formatDisplayDate(data.checkIn)],
    ['Check-out', formatDisplayDate(data.checkOut)],
    ['Nights', String(data.nights)],
    [`Total (incl. ${escapeHtml(taxLabel)})`, formatMoney(data.totalCents, data.currency)],
    ['Paid', formatMoney(data.paidCents, data.currency)],
    ['Balance due', formatMoney(data.balanceDueCents, data.currency)],
  ];
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;">${label}</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${value}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">${rowsHtml}</table>`;
}

function detailsTextLines(data: BookingEmailData): string[] {
  const taxLabel = taxLabelOrDefault(data.taxLabel);
  return [
    `Confirmation code: ${data.confirmationCode}`,
    `Unit type: ${data.unitTypeName}`,
    `Check-in: ${formatDisplayDate(data.checkIn)}`,
    `Check-out: ${formatDisplayDate(data.checkOut)}`,
    `Nights: ${data.nights}`,
    `Total (incl. ${taxLabel}): ${formatMoney(data.totalCents, data.currency)}`,
    `Paid: ${formatMoney(data.paidCents, data.currency)}`,
    `Balance due: ${formatMoney(data.balanceDueCents, data.currency)}`,
  ];
}

function manageLinkHtml(data: BookingEmailData): string {
  const url = escapeHtml(data.manageUrl);
  return `<p style="margin:24px 0;"><a href="${url}" style="background-color:#1f2937;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold;">Manage your booking</a></p>`;
}

export function renderConfirmation(data: BookingEmailData): RenderedEmail {
  const guestName = escapeHtml(data.guestName);
  const subject = `Booking confirmed — ${data.confirmationCode}`;
  const html = wrapHtml(
    data,
    [
      `<p style="margin:0 0 12px;">Hi ${guestName},</p>`,
      `<p style="margin:0 0 12px;">Your booking at ${escapeHtml(data.propertyName)} is confirmed. Here are the details:</p>`,
      detailsTableHtml(data),
      manageLinkHtml(data),
      `<p style="margin:16px 0 0;">We look forward to hosting you!</p>`,
    ].join(''),
  );
  const text = [
    `Hi ${data.guestName},`,
    '',
    `Your booking at ${data.propertyName} is confirmed. Here are the details:`,
    '',
    ...detailsTextLines(data),
    '',
    `Manage your booking: ${data.manageUrl}`,
    '',
    'We look forward to hosting you!',
  ].join('\n');
  return { subject, html, text };
}

export function renderCancellation(
  data: BookingEmailData & { refundCents: number; refundInFlight?: boolean },
): RenderedEmail {
  const guestName = escapeHtml(data.guestName);
  const subject = `Booking cancelled — ${data.confirmationCode}`;
  const refundLine = `<tr><td style="padding:6px 0;color:#6b7280;">Refund</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatMoney(data.refundCents, data.currency)}</td></tr>`;
  // For provider payments the refund is scheduled but not yet settled when this
  // email sends, so say it's being processed rather than implying it's done.
  const processingNote =
    data.refundInFlight && data.refundCents > 0
      ? `<p style="margin:0 0 12px;">Your refund of ${escapeHtml(
          formatMoney(data.refundCents, data.currency),
        )} is being processed and will appear on your original payment method.</p>`
      : '';
  const html = wrapHtml(
    data,
    [
      `<p style="margin:0 0 12px;">Hi ${guestName},</p>`,
      `<p style="margin:0 0 12px;">Your booking at ${escapeHtml(data.propertyName)} has been cancelled.</p>`,
      processingNote,
      detailsTableHtml(data).replace('</table>', `${refundLine}</table>`),
      manageLinkHtml(data),
    ].join(''),
  );
  const text = [
    `Hi ${data.guestName},`,
    '',
    `Your booking at ${data.propertyName} has been cancelled.`,
    ...(data.refundInFlight && data.refundCents > 0
      ? ['', `Your refund of ${formatMoney(data.refundCents, data.currency)} is being processed and will appear on your original payment method.`]
      : []),
    '',
    ...detailsTextLines(data),
    `Refund: ${formatMoney(data.refundCents, data.currency)}`,
    '',
    `Manage your booking: ${data.manageUrl}`,
  ].join('\n');
  return { subject, html, text };
}

export function renderPaymentConflict(data: BookingEmailData): RenderedEmail {
  const guestName = escapeHtml(data.guestName);
  const subject = `About your payment — ${data.propertyName}`;
  const html = wrapHtml(
    data,
    [
      `<p style="margin:0 0 12px;">Hi ${guestName},</p>`,
      `<p style="margin:0 0 12px;">Your payment for booking ${data.confirmationCode} at ${escapeHtml(
        data.propertyName,
      )} arrived after your hold on those dates had expired, so we're unable to confirm that reservation. A full refund is on its way.</p>`,
      detailsTableHtml(data),
      manageLinkHtml(data),
      `<p style="margin:16px 0 0;">If you have any questions, please reply to this email or call us — we're happy to help you find new dates.</p>`,
    ].join(''),
  );
  const text = [
    `Hi ${data.guestName},`,
    '',
    `Your payment for booking ${data.confirmationCode} at ${data.propertyName} arrived after your hold on those dates had expired, so we're unable to confirm that reservation. A full refund is on its way.`,
    '',
    ...detailsTextLines(data),
    '',
    `Manage your booking: ${data.manageUrl}`,
    '',
    `If you have any questions, please reply to this email or call us — we're happy to help you find new dates.`,
  ].join('\n');
  return { subject, html, text };
}

export function renderBookingMessage(
  data: BookingEmailData & { recipientName: string; authorName: string; messageText: string },
): RenderedEmail {
  const subject = `New booking message — ${data.confirmationCode}`;
  const safeMessage = escapeHtml(data.messageText).replace(/\n/g, '<br>');
  const html = wrapHtml(data, [
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(data.recipientName)},</p>`,
    `<p style="margin:0 0 12px;">${escapeHtml(data.authorName)} sent a message about booking ${escapeHtml(data.confirmationCode)}:</p>`,
    `<blockquote style="margin:16px 0;padding:12px 16px;background:#f9fafb;border-left:4px solid #10b981;">${safeMessage}</blockquote>`,
    manageLinkHtml(data),
    '<p style="margin:12px 0 0;color:#6b7280;">Reply inside OpenStays so the conversation stays with the booking.</p>',
  ].join(''));
  const text = [
    `Hi ${data.recipientName},`, '',
    `${data.authorName} sent a message about booking ${data.confirmationCode}:`, '',
    data.messageText, '',
    `Reply in OpenStays: ${data.manageUrl}`,
  ].join('\n');
  return { subject, html, text };
}

export function renderConsensusReceiptReady(
  data: BookingEmailData & { receiptId: string; receiptSha256: string },
): RenderedEmail {
  const subject = `Consensus receipt ready — ${data.confirmationCode}`;
  const html = wrapHtml(data, [
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(data.guestName)},</p>`,
    `<p style="margin:0 0 12px;">OpenStays reached one authoritative state for your booking and submitted its privacy-safe receipt to OpenTimestamps.</p>`,
    `<p style="margin:12px 0;font-family:monospace;word-break:break-all;">${escapeHtml(data.receiptId)}<br>${escapeHtml(data.receiptSha256)}</p>`,
    `<p style="margin:0 0 12px;">Bitcoin anchoring is pending. You can already download the proof and claim the one-time 1,000 signet sats demo reward.</p>`,
    manageLinkHtml(data),
  ].join(''));
  const text = [
    `Hi ${data.guestName},`, '',
    'OpenStays reached one authoritative state for your booking and submitted its privacy-safe receipt to OpenTimestamps.',
    `Receipt: ${data.receiptId}`, `SHA-256: ${data.receiptSha256}`, '',
    'Bitcoin anchoring is pending. You can already download the proof and claim the one-time 1,000 signet sats demo reward.', '',
    `Manage your booking: ${data.manageUrl}`,
  ].join('\n');
  return { subject, html, text };
}

type ManualRefundData = BookingEmailData & { refundCents: number; reason: string };

export function renderManualRefundRequired(data: ManualRefundData): RenderedEmail {
  const amount = formatMoney(data.refundCents, data.currency);
  const subject = `Manual refund required — ${data.confirmationCode}`;
  const text = [
    `A manual refund of ${amount} is required for booking ${data.confirmationCode}.`,
    `Reason: ${data.reason.replace(/_/g, ' ')}`,
    '',
    `Resolve it in OpenStays: ${data.manageUrl}`,
    '',
    'The payment remains paid until an external reference or Bitcoin transaction ID is recorded.',
  ].join('\n');
  const html = wrapHtml(data, [
    `<p><strong>A manual refund of ${escapeHtml(amount)} is required</strong> for booking ${escapeHtml(data.confirmationCode)}.</p>`,
    `<p>Reason: ${escapeHtml(data.reason.replace(/_/g, ' '))}</p>`,
    manageLinkHtml(data),
    '<p style="color:#6b7280;">The payment remains paid until an external reference or Bitcoin transaction ID is recorded.</p>',
  ].join(''));
  return { subject, html, text };
}

export function renderManualRefundCompleted(
  data: ManualRefundData & { externalReference: string },
): RenderedEmail {
  const amount = formatMoney(data.refundCents, data.currency);
  const subject = `Refund completed — ${data.confirmationCode}`;
  const text = [
    `Hi ${data.guestName},`, '',
    `Your refund of ${amount} for booking ${data.confirmationCode} has been completed.`,
    `Reference: ${data.externalReference}`, '',
    `Manage your booking: ${data.manageUrl}`,
  ].join('\n');
  const html = wrapHtml(data, [
    `<p>Hi ${escapeHtml(data.guestName)},</p>`,
    `<p>Your refund of <strong>${escapeHtml(amount)}</strong> for booking ${escapeHtml(data.confirmationCode)} has been completed.</p>`,
    `<p>Reference: <code>${escapeHtml(data.externalReference)}</code></p>`,
    manageLinkHtml(data),
  ].join(''));
  return { subject, html, text };
}
