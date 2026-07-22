import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';
import { bridgeBearerAuthorized, configuredBridgeToken } from './wavelength';
import { mailBridgeAuthorized } from './emailDelivery';

const http = httpRouter();

// Convex Auth endpoints (staff sign-in token plumbing — /.well-known/*, /api/auth/*).
auth.addHttpRoutes(http);

/**
 * Payment provider webhooks (M1). The raw body is passed through UNparsed —
 * both providers sign the exact bytes. All verification, idempotency, and
 * state changes live behind internal.payments.webhooks.handleWebhook; these
 * routes only shuttle bytes and echo the status.
 */
function webhookRoute(provider: 'stripe' | 'square', path: string) {
  http.route({
    path,
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const result = await ctx.runAction(internal.payments.webhooks.handleWebhook, {
        provider,
        body,
        headers,
        requestUrl: request.url,
      });
      return new Response(null, { status: result.status });
    }),
  });
}

webhookRoute('stripe', '/webhooks/stripe');
webhookRoute('square', '/webhooks/square');

http.route({
  path: '/webhooks/zaprite',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const result = await ctx.runAction(internal.payments.webhooks.handleZapriteNudge, {
      requestUrl: request.url,
    });
    return new Response(null, { status: result.status });
  }),
});

const wavelengthInternal = (internal as unknown as {
  wavelength: Record<string, Parameters<typeof httpAction>[0]>;
}).wavelength as Record<string, any>;
const receiptInternal = (internal as any).consensusReceipts as Record<string, any>;
const rewardInternal = (internal as any).wavelengthRewards as Record<string, any>;

function wavelengthAuthorized(request: Request): boolean {
  return bridgeBearerAuthorized(
    request.headers.get('authorization') ?? undefined,
    configuredBridgeToken(),
  );
}

function otsAuthorized(request: Request): boolean {
  return bridgeBearerAuthorized(
    request.headers.get('authorization') ?? undefined,
    process.env.OTS_BRIDGE_TOKEN?.trim() ?? '',
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const emailDeliveryInternal = (internal as unknown as {
  emailDelivery: Record<string, Parameters<typeof httpAction>[0]>;
}).emailDelivery as Record<string, any>;

function mailAuthorized(request: Request): boolean {
  const expectedToken = process.env.MAIL_BRIDGE_TOKEN?.trim();
  return Boolean(
    expectedToken &&
      mailBridgeAuthorized(request.headers.get('authorization') ?? undefined, expectedToken),
  );
}

function mailBridgeError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: message.includes('MAIL_LEASE_MISMATCH') ? 'lease_conflict' : 'invalid_request' },
    message.includes('MAIL_LEASE_MISMATCH') ? 409 : 400,
  );
}

http.route({
  path: '/mail-bridge/pending',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!mailAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const emails = await ctx.runMutation(emailDeliveryInternal.claimPending, {
      limit: 25,
      leaseToken: crypto.randomUUID(),
    });
    return json({ emails });
  }),
});

http.route({
  path: '/mail-bridge/delivered',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!mailAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try {
      const body = await request.json();
      return json(await ctx.runMutation(emailDeliveryInternal.markDelivered, body));
    } catch (error) {
      return mailBridgeError(error);
    }
  }),
});

http.route({
  path: '/mail-bridge/failed',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!mailAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try {
      const body = await request.json();
      return json(await ctx.runMutation(emailDeliveryInternal.markFailed, body));
    } catch (error) {
      return mailBridgeError(error);
    }
  }),
});

http.route({
  path: '/wavelength-bridge/pending',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!wavelengthAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const requests = await ctx.runMutation(wavelengthInternal.claimPending, { limit: 10 });
    return json({ requests });
  }),
});

http.route({
  path: '/ots-bridge/pending', method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!otsAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    return json({ receipts: await ctx.runMutation(receiptInternal.claimPending, { limit: 10 }) });
  }),
});

for (const route of [
  { path: '/ots-bridge/proof', fn: 'publishProof' },
  { path: '/ots-bridge/anchored', fn: 'markAnchored' },
  { path: '/ots-bridge/failed', fn: 'markFailed' },
] as const) http.route({
  path: route.path, method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!otsAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try { return json(await ctx.runMutation(receiptInternal[route.fn], await request.json())); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }),
});

http.route({
  path: '/wavelength-bridge/rewards/pending', method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!wavelengthAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    return json({ rewards: await ctx.runMutation(rewardInternal.claimPending, { limit: 10 }) });
  }),
});

for (const route of [
  { path: '/wavelength-bridge/rewards/dispatched', fn: 'markDispatched' },
  { path: '/wavelength-bridge/rewards/paid', fn: 'markPaid' },
  { path: '/wavelength-bridge/rewards/failed', fn: 'markFailed' },
] as const) http.route({
  path: route.path, method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!wavelengthAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try { return json(await ctx.runMutation(rewardInternal[route.fn], await request.json())); }
    catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  }),
});

http.route({
  path: '/wavelength-bridge/invoice',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!wavelengthAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try {
      const body = await request.json();
      const result = await ctx.runMutation(wavelengthInternal.publishInvoice, body);
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }),
});

http.route({
  path: '/wavelength-bridge/settled',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!wavelengthAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    try {
      const body = await request.json();
      const prepared = await ctx.runMutation(wavelengthInternal.prepareSettlement, body);
      if (prepared.duplicate) return json({ settled: false, duplicate: true });
      const waveRequest = prepared.request;
      await ctx.runMutation(internal.bookings.confirmFromPayment, {
        provider: 'wavelength',
        eventId: `wavelength:${waveRequest._id}:${body.paymentHash}`,
        eventType: 'bridge_settled',
        checkoutId: waveRequest._id,
        providerPaymentId: body.paymentHash,
        amountCents: waveRequest.quotedAmountCents,
        currency: waveRequest.currency,
      });
      const result = await ctx.runMutation(wavelengthInternal.markSettled, {
        requestId: waveRequest._id,
        paymentHash: body.paymentHash,
      });
      return json({ ...result, duplicate: false });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }),
});

/**
 * Channel manager (Channex) webhook — a low-latency NUDGE to poll the booking
 * revisions feed, NOT a data source (Channex webhooks are out-of-order and
 * unsigned). We validate the optional shared secret, then schedule a feed pull
 * and return 200 immediately. All real ingest happens behind the pull feed.
 */
http.route({
  path: '/webhooks/channex',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const result = await ctx.runAction(internal.channel.ingest.handleWebhookNudge, { headers });
    return new Response(null, { status: result.status });
  }),
});

// HTTP API v1 (M1.5) — key-authenticated automation surface. One dispatcher
// handles all /api/v1/* paths and methods; see convex/apiV1.ts.
import { handle as apiV1Handle } from './apiV1';
http.route({ pathPrefix: '/api/v1/', method: 'GET', handler: apiV1Handle });
http.route({ pathPrefix: '/api/v1/', method: 'POST', handler: apiV1Handle });

/**
 * Per-unit iCal export: GET /ical/u/<token>.ics
 * Day-1 differentiator — lets external calendars (direct Airbnb listings,
 * legacy-PMS bridges) subscribe to a unit's blocked dates. No guest PII in
 * the feed; external events are never re-exported (loop prevention).
 */
http.route({
  pathPrefix: '/ical/u/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/ical\/u\/([^/]+)\.ics$/);
    if (!match) return new Response('not found', { status: 404 });

    const feed = await ctx.runQuery(internal.ical.exportFeed, { token: match[1] });
    if (feed === null) return new Response('not found', { status: 404 });

    return new Response(feed, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }),
});

export default http;
