import { expect, test } from '@playwright/test';

test('Consensus Commons public funnel is judge-ready', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
      browserErrors.push(message.text());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Consensus Commons' })).toBeVisible();
  await page.locator('a[href="/p/consensus-commons"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Consensus Commons' })).toBeVisible();
  await page.locator('a[href="/p/consensus-commons/stay/node-room"]').click();
  await expect(page.getByRole('heading', { name: 'Node Room' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();

  expect(await page.evaluate(() => document.querySelectorAll('main').length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test('fictional operations tour is interactive, read-only, and responsive', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) {
      browserErrors.push(message.text());
    }
  });

  await page.goto('/tour/operations');
  await expect(page.getByRole('heading', { level: 1, name: 'See how a stay reaches consensus' })).toBeVisible();
  await expect(page.getByText('Read-only fictional demo').first()).toBeVisible();
  const disabledAction = page.getByRole('button', { name: 'Retry operation' });
  await expect(disabledAction).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Front desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Housekeeping' }).click();
  await expect(page.getByText('Turnaround board')).toBeVisible();

  expect(await page.evaluate(() => document.querySelectorAll('main').length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test('live Wavelength checkout loads one isolated wallet engine', async ({ page }) => {
  const bookingId = process.env.OPENSTAYS_E2E_BOOKING_ID;
  const confirmation = process.env.OPENSTAYS_E2E_CONFIRMATION;
  const email = process.env.OPENSTAYS_E2E_EMAIL;
  test.skip(!bookingId || !confirmation || !email, 'Set the three OPENSTAYS_E2E_* values for the live rail check.');

  let daemonStarts = 0;
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Starting waved')) daemonStarts += 1;
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(`/wallet/pay/${bookingId}?confirmation=${encodeURIComponent(confirmation!)}`);
  await page.getByLabel('Booking email').fill(email!);
  await page.getByRole('button', { name: 'Request signet invoice' }).click();
  await expect(page.getByRole('button', { name: 'Create local wallet' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Fixed demo quote: 1,000 signet sats')).toBeVisible();

  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('main').length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(daemonStarts).toBe(1);
  expect(browserErrors).toEqual([]);
});
