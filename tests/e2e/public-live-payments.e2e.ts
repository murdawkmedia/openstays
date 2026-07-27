import { expect, test } from '@playwright/test';

test('public checkout keeps fictional disclosure and independent fallback rails', async ({ page }) => {
  const bookingId = process.env.OPENSTAYS_E2E_PUBLIC_HOLD_ID;
  const confirmation = process.env.OPENSTAYS_E2E_PUBLIC_HOLD_CONFIRMATION;
  test.skip(!bookingId || !confirmation, 'Set a fresh public hold for live checkout acceptance.');

  await page.goto(`/checkout/${bookingId}?confirmation=${encodeURIComponent(confirmation!)}`);
  await expect(page.getByText('Consensus Commons is fictional')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the simulated tour' })).toBeVisible();

  const wavelength = page.getByRole('button', { name: 'Pay 1,000 signet sats with Wavelength' });
  const unavailable = page.getByText('Live Wavelength is temporarily unavailable');
  await expect(wavelength.or(unavailable)).toBeVisible();
  await expect(page.getByText('No charge and no signet reward')).toBeVisible();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('paid public booking exposes authenticated manual refund state', async ({ page }) => {
  const confirmation = process.env.OPENSTAYS_E2E_PUBLIC_PAID_CONFIRMATION;
  const email = process.env.OPENSTAYS_E2E_PUBLIC_PAID_EMAIL;
  test.skip(!confirmation || !email, 'Set a paid Zaprite or Wavelength booking for refund acceptance.');

  await page.goto(`/manage/${encodeURIComponent(confirmation!)}`);
  await page.getByLabel('Booking email').first().fill(email!);
  await expect(page.getByText('Project contribution refund')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Request contribution refund' })
      .or(page.getByText('Refund requested. Staff resolution is pending.'))
      .or(page.getByText('Refund completed by staff.')),
  ).toBeVisible();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
