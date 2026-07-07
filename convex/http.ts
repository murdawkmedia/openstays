import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

const http = httpRouter();

/**
 * Per-unit iCal export: GET /ical/u/<token>.ics
 * Day-1 differentiator — lets external calendars (direct Airbnb listings,
 * legacy-PMS bridges) subscribe to a unit's blocked dates. No guest PII in
 * the feed; external events are never re-exported (loop prevention).
 * Payment webhooks (/webhooks/stripe, /webhooks/square) land in M1.
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
