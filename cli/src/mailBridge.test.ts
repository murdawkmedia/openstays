import { describe, expect, it, vi } from 'vitest';
import { runMailBridgeOnce } from './mailBridge.js';

describe('runMailBridgeOnce', () => {
  it('delivers a complete queued message and acknowledges its lease', async () => {
    const sender = { sendMail: vi.fn(async () => ({ messageId: 'smtp-210' })) };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/mail-bridge/pending')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer bridge-secret' });
        return new Response(JSON.stringify({ emails: [{
          _id: 'email_1', leaseToken: 'lease_1', from: 'OpenStays <from@example.test>',
          to: 'guest@example.test', subject: 'Consensus reached', html: '<p>Booked</p>', text: 'Booked',
        }] }), { status: 200 });
      }
      if (url.endsWith('/mail-bridge/delivered')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          emailLogId: 'email_1', leaseToken: 'lease_1', providerMessageId: 'smtp-210',
        });
        return new Response(JSON.stringify({ delivered: true }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runMailBridgeOnce({
      openStaysUrl: 'https://openstays.example/', bridgeToken: 'bridge-secret',
    }, sender, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(sender.sendMail).toHaveBeenCalledWith({
      from: 'OpenStays <from@example.test>', to: 'guest@example.test', subject: 'Consensus reached',
      html: '<p>Booked</p>', text: 'Booked',
    });
  });

  it('reports SMTP failure without exposing the bridge token', async () => {
    const smtpError = Object.assign(new Error('SMTP unavailable'), { code: 'ECONNECTION' });
    const sender = { sendMail: vi.fn(async () => { throw smtpError; }) };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/mail-bridge/pending')) {
        return new Response(JSON.stringify({ emails: [{
          _id: 'email_2', leaseToken: 'lease_2', from: 'from@example.test', to: 'guest@example.test',
          subject: 'Hello', html: '<p>Hello</p>', text: 'Hello',
        }] }), { status: 200 });
      }
      if (url.endsWith('/mail-bridge/failed')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          emailLogId: 'email_2', leaseToken: 'lease_2', error: 'SMTP unavailable', retryable: true,
        });
        expect(String(init?.body)).not.toContain('bridge-secret');
        return new Response(JSON.stringify({ failed: true, terminal: false }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(runMailBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'bridge-secret',
    }, sender, fetchFn as typeof fetch)).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });
  });

  it('treats authentication errors as terminal delivery failures', async () => {
    const smtpError = Object.assign(new Error('Authentication failed'), { code: 'EAUTH' });
    const sender = { sendMail: vi.fn(async () => { throw smtpError; }) };
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/mail-bridge/pending')) {
        return new Response(JSON.stringify({ emails: [{
          _id: 'email_3', leaseToken: 'lease_3', from: 'from@example.test', to: 'guest@example.test',
          subject: 'Hello', html: '<p>Hello</p>', text: 'Hello',
        }] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.retryable).toBe(false);
      return new Response(JSON.stringify({ failed: true, terminal: true }), { status: 200 });
    });
    await runMailBridgeOnce({ openStaysUrl: 'https://openstays.example', bridgeToken: 'secret' }, sender, fetchFn as typeof fetch);
  });

  it('does not report SMTP failure after the server accepted the message', async () => {
    const sender = { sendMail: vi.fn(async () => ({ messageId: 'accepted' })) };
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/mail-bridge/pending')) {
        return new Response(JSON.stringify({ emails: [{
          _id: 'email_4', leaseToken: 'lease_4', from: 'from@example.test', to: 'guest@example.test',
          subject: 'Hello', html: '<p>Hello</p>', text: 'Hello',
        }] }), { status: 200 });
      }
      if (url.endsWith('/mail-bridge/delivered')) return new Response(null, { status: 503 });
      throw new Error('must not mark an SMTP-accepted message failed');
    });
    await expect(runMailBridgeOnce({
      openStaysUrl: 'https://openstays.example', bridgeToken: 'secret',
    }, sender, fetchFn as typeof fetch)).rejects.toThrow('delivery acknowledgement failed');
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/mail-bridge/failed'))).toBe(false);
  });
});
