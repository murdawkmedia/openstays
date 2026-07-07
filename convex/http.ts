import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';

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
