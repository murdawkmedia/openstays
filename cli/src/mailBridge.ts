import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  runOperationsHeartbeat,
  waitForAbortableDelay,
  type OperationsHeartbeatSnapshot,
} from './operationsHeartbeat.js';

export interface MailBridgeOptions {
  openStaysUrl: string;
  bridgeToken: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  pollMs?: number;
  once?: boolean;
  signal?: AbortSignal;
  heartbeatToken?: string;
  release?: string;
}

interface QueuedEmail {
  _id: string;
  leaseToken: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface MailSender {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

export interface MailBridgeResult {
  claimed: number;
  delivered: number;
  failed: number;
}

function bridgeHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function responseJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  return await response.json() as T;
}

function retryableSmtpError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return !['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(code);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'SMTP delivery failed';
}

export async function runMailBridgeOnce(
  options: MailBridgeOptions,
  sender: MailSender,
  fetchFn: typeof fetch = fetch,
): Promise<MailBridgeResult> {
  const baseUrl = options.openStaysUrl.replace(/\/$/, '');
  const headers = bridgeHeaders(options.bridgeToken);
  const pendingResponse = await fetchFn(`${baseUrl}/mail-bridge/pending`, {
    method: 'GET', headers,
  });
  const { emails } = await responseJson<{ emails: QueuedEmail[] }>(pendingResponse, 'mail claim');
  let delivered = 0;
  let failed = 0;

  for (const email of emails) {
    let result: { messageId?: string };
    try {
      result = await sender.sendMail({
        from: email.from, to: email.to, subject: email.subject, html: email.html, text: email.text,
      });
    } catch (error) {
      const reported = await fetchFn(`${baseUrl}/mail-bridge/failed`, {
        method: 'POST', headers,
        body: JSON.stringify({
          emailLogId: email._id,
          leaseToken: email.leaseToken,
          error: safeErrorMessage(error),
          retryable: retryableSmtpError(error),
        }),
      });
      await responseJson(reported, 'failure acknowledgement');
      failed += 1;
      continue;
    }
    // Once SMTP accepts a message, never mark it failed just because the
    // acknowledgement request failed. That would guarantee a duplicate retry.
    const acknowledged = await fetchFn(`${baseUrl}/mail-bridge/delivered`, {
      method: 'POST', headers,
      body: JSON.stringify({
        emailLogId: email._id,
        leaseToken: email.leaseToken,
        providerMessageId: result.messageId,
      }),
    });
    await responseJson(acknowledged, 'delivery acknowledgement');
    delivered += 1;
  }

  return { claimed: emails.length, delivered, failed };
}

export function createSmtpSender(options: MailBridgeOptions): Transporter {
  return nodemailer.createTransport({
    host: options.smtpHost ?? '127.0.0.1',
    port: options.smtpPort ?? 1025,
    secure: options.smtpSecure ?? false,
    auth: options.smtpUsername
      ? { user: options.smtpUsername, pass: options.smtpPassword ?? '' }
      : undefined,
  });
}

export async function runMailBridge(options: MailBridgeOptions): Promise<void> {
  const sender = createSmtpSender(options);
  const pollMs = options.pollMs ?? 2_000;
  const ownController = new AbortController();
  if (options.signal?.aborted) ownController.abort();
  else options.signal?.addEventListener('abort', () => ownController.abort(), { once: true });
  const signal = ownController.signal;
  let heartbeatStatus: OperationsHeartbeatSnapshot = { status: 'starting' };
  const heartbeat = options.heartbeatToken
    ? runOperationsHeartbeat({
        openStaysUrl: options.openStaysUrl,
        heartbeatToken: options.heartbeatToken,
        service: 'mail',
        release: options.release ?? 'openstays-cli-0.1.0',
        signal,
        snapshot: async () => heartbeatStatus,
      })
    : Promise.resolve();
  while (!signal.aborted) {
    try {
      const result = await runMailBridgeOnce(options, sender);
      heartbeatStatus = { status: 'ready' };
      if (result.claimed > 0) {
        process.stderr.write(
          `mail bridge: claimed=${result.claimed} delivered=${result.delivered} failed=${result.failed}\n`,
        );
      }
    } catch (error) {
      heartbeatStatus = { status: 'degraded', failureCategory: 'processing' };
      process.stderr.write('mail bridge: processing_failed\n');
      if (options.once) {
        ownController.abort();
        await heartbeat;
        throw error;
      }
    }
    if (options.once) break;
    await waitForAbortableDelay(pollMs, signal);
  }
  ownController.abort();
  await heartbeat;
}
