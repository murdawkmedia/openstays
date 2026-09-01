import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';
import { mailBridgeAuthorized } from './emailDelivery';
import { handle as apiV1Handle } from './apiV1';

const http = httpRouter();
auth.addHttpRoutes(http);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function webhookRoute(provider: 'stripe' | 'square', path: string) {
  http.route({
    path,
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
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

const emailDeliveryInternal = (internal as unknown as {
  emailDelivery: Record<string, Parameters<typeof httpAction>[0]>;
}).emailDelivery as Record<string, any>;

function mailAuthorized(request: Request): boolean {
  const expectedToken = process.env.MAIL_BRIDGE_TOKEN?.trim();
  return Boolean(expectedToken && mailBridgeAuthorized(
    request.headers.get('authorization') ?? undefined,
    expectedToken,
  ));
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
    return json({ emails: await ctx.runMutation(emailDeliveryInternal.claimPending, {
      limit: 25,
      leaseToken: crypto.randomUUID(),
    }) });
  }),
});

for (const route of [
  { path: '/mail-bridge/delivered', fn: 'markDelivered' },
  { path: '/mail-bridge/failed', fn: 'markFailed' },
] as const) {
  http.route({
    path: route.path,
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      if (!mailAuthorized(request)) return json({ error: 'unauthorized' }, 401);
      try { return json(await ctx.runMutation(emailDeliveryInternal[route.fn], await request.json())); }
      catch (error) { return mailBridgeError(error); }
    }),
  });
}

http.route({
  path: '/webhooks/channex',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const result = await ctx.runAction(internal.channel.ingest.handleWebhookNudge, { headers });
    return new Response(null, { status: result.status });
  }),
});

http.route({ pathPrefix: '/api/v1/', method: 'GET', handler: apiV1Handle });
http.route({ pathPrefix: '/api/v1/', method: 'POST', handler: apiV1Handle });

http.route({
  pathPrefix: '/ical/u/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const match = new URL(request.url).pathname.match(/\/ical\/u\/([^/]+)\.ics$/);
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
