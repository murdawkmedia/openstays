#!/usr/bin/env node
// OpenStays CLI — thin command-line surface over cli/src/client.ts.
//
// Hand-rolled arg parsing on purpose: the command set is flat (one verb, a
// handful of `--flag value` options, no nested subcommand trees), so a
// dependency like yargs/commander would add weight and an API surface we
// don't need. Keeping it dependency-free also keeps `npm install` inside
// cli/ fast and keeps the whole package's dependency footprint to exactly
// one runtime dep (the MCP SDK, needed for `openstays mcp`).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError, OpenStaysClient } from './client.js';
import type {
  BookingStatus,
  CreateHoldArgs,
  OpenStaysClientOptions,
} from './client.js';
import { runMcpServer } from './mcp.js';
import { runWaveBridge } from './waveBridge.js';
import { loadTreasuryRuntimeConfig } from './waveTreasury.js';
import { runMailBridge } from './mailBridge.js';
import { runOtsBridge } from './otsBridge.js';

export const VERSION = '0.1.0';

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
  json: boolean;
  help: boolean;
  version: boolean;
  url?: string;
  key?: string;
}

const KNOWN_COMMANDS = new Set([
  'health',
  'properties',
  'unit-types',
  'availability',
  'tape',
  'bookings',
  'booking',
  'hold',
  'cancel',
  'promo-preview',
  'mcp',
  'wave-bridge',
  'mail-bridge',
  'ots-bridge',
]);

/** Parse argv (post `node index.js`) into a command + flags. Pure, no I/O. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let json = false;
  let help = false;
  let version = false;
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else if (command === undefined && KNOWN_COMMANDS.has(arg)) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return {
    command,
    positional,
    flags,
    json,
    help,
    version,
    url: flags.url,
    key: flags.key,
  };
}

export class CliUsageError extends Error {}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined) {
    throw new CliUsageError(`Missing required flag --${name}`);
  }
  return value;
}

function intFlag(flags: Record<string, string>, name: string): number | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new CliUsageError(`--${name} must be a number, got '${value}'`);
  return n;
}

/**
 * Strict non-negative integer parse for a flag. A non-numeric or fractional
 * value throws a local CliUsageError BEFORE any network round-trip, instead of
 * `Number('abc')` → NaN → JSON.stringify → `null` reaching the server as a
 * confusing 400. `min` gates below-range values (adults require >= 1).
 */
function requireIntFlag(
  flags: Record<string, string>,
  name: string,
  min: number,
): number {
  const value = flags[name];
  if (value === undefined) {
    throw new CliUsageError(`--${name} must be a positive integer`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new CliUsageError(
      min >= 1
        ? `--${name} must be a positive integer, got '${value}'`
        : `--${name} must be a non-negative integer, got '${value}'`,
    );
  }
  return n;
}

export const HELP_TEXT = `openstays — CLI for the OpenStays booking API

Usage:
  openstays <command> [flags]

Commands:
  health                                    Check API reachability
  properties                                List active properties
  unit-types --property <slug>              List unit types for a property
  availability --property <slug> --unit-type <slug> --from <d> --to <d>
                                             Show blocked/open nights
  tape --property <slug> --from <d> --to <d>
                                             Admin booking tape (staff key)
  bookings [--status <s>] [--from <d>] [--to <d>] [--limit <n>]
                                             List bookings
  booking <code>                            Get one booking by confirmation code
  hold --unit-id <id> --rate-plan-id <id> --check-in <d> --check-out <d>
       --adults <n> [--children <n>] --name <n> --email <e> [--phone <p>]
       [--marketing-opt-in] [--promo-code <c>]
                                             Create a hold (write scope)
  cancel <code> --email <e>                 Cancel a booking (write scope)
  promo-preview --code <c> --property <slug> --unit-type <slug>
                                             Preview a promo code
  mcp                                       Run as an MCP stdio server
  wave-bridge [--once]                      Run the local Wavelength signet merchant bridge
  mail-bridge [--once]                      Deliver queued OpenStays mail through SMTP
  ots-bridge [--once]                       Stamp and upgrade Consensus Receipts

Global flags:
  --json          Print raw JSON instead of a human summary
  --url <url>     Override OPENSTAYS_URL
  --key <key>     Override OPENSTAYS_API_KEY
  -h, --help      Show this help
  -v, --version   Show version

Env vars:
  OPENSTAYS_URL       Deployment's .convex.site origin
  OPENSTAYS_API_KEY   'osk_' + 48 hex chars (see docs/automation.md)
  WAVELENGTH_BRIDGE_TOKEN  Shared secret for authenticated bridge endpoints
  WAVELENGTH_DAEMON_URL    waved REST gateway (default http://127.0.0.1:10031)
  MAIL_BRIDGE_TOKEN        Shared secret for authenticated mail bridge endpoints
  OTS_BRIDGE_TOKEN         Separate shared secret for OpenTimestamps bridge endpoints
  WAVELENGTH_HEARTBEAT_TOKEN  Service-scoped operations heartbeat secret
  WAVELENGTH_TREASURY_ENABLED Enable guarded Signet treasury processing (default false)
  WAVELENGTH_TREASURY_DRY_RUN Preview only until explicitly set false
  WAVELENGTH_TREASURY_ADDRESS Signet taproot boarding destination
  OTS_HEARTBEAT_TOKEN         Service-scoped operations heartbeat secret
  MAIL_HEARTBEAT_TOKEN        Service-scoped operations heartbeat secret
  OPENSTAYS_RELEASE           Public release identifier included in heartbeats
  OTS_COMMAND              Native OpenTimestamps executable (default ots)
  OTS_WSL                  Set true on Windows to invoke the official client through WSL
  OTS_WSL_PYTHONPATH       WSL package directory (default /root/.local/share/openstays/ots-bridge-python)
  SMTP_HOST / SMTP_PORT    SMTP server (defaults 127.0.0.1:1025 for Mailpit)
`;

function printTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '(none)';
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  const header = line(columns);
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((r) => line(columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i]))));
  return [header, sep, ...body].join('\n');
}

/**
 * Core dispatcher: given parsed args and an injected client, run the command
 * and return the text to print to stdout. Throws ApiError/CliUsageError on
 * failure (callers map those to exit codes). No process/env access here —
 * that's what makes this testable without a live server.
 */
export async function dispatch(
  parsed: ParsedArgs,
  client: OpenStaysClient,
): Promise<string> {
  const { command, flags, json, positional } = parsed;

  switch (command) {
    case 'health': {
      const result = await client.health();
      return json ? JSON.stringify(result, null, 2) : `ok=${result.ok} version=${result.version}`;
    }

    case 'properties': {
      const result = await client.listProperties();
      return json
        ? JSON.stringify(result, null, 2)
        : printTable(result.map((p) => ({ slug: p.slug, name: p.name, address: p.address ?? '' })));
    }

    case 'unit-types': {
      const property = requireFlag(flags, 'property');
      const result = await client.listUnitTypes({ property });
      return json
        ? JSON.stringify(result, null, 2)
        : printTable(result.map((u) => ({ slug: u.slug, name: u.name, kind: u.kind, comingSoon: u.comingSoon ?? false })));
    }

    case 'availability': {
      const property = requireFlag(flags, 'property');
      const unitType = requireFlag(flags, 'unit-type');
      const from = requireFlag(flags, 'from');
      const to = requireFlag(flags, 'to');
      const result = await client.availability({ property, unitType, from, to });
      return json
        ? JSON.stringify(result, null, 2)
        : printTable(
            result.units.map((u) => ({
              unit: u.unitName,
              blockedNights: u.blockedDates.length,
            })),
          );
    }

    case 'tape': {
      const property = requireFlag(flags, 'property');
      const from = requireFlag(flags, 'from');
      const to = requireFlag(flags, 'to');
      const result = await client.tape({ property, from, to });
      return json
        ? JSON.stringify(result, null, 2)
        : printTable(
            result.bookings.map((b) => ({
              code: b.confirmationCode,
              status: b.status,
              checkIn: b.checkIn,
              checkOut: b.checkOut,
            })),
          );
    }

    case 'bookings': {
      const result = await client.listBookings({
        status: flags.status as BookingStatus | undefined,
        from: flags.from,
        to: flags.to,
        limit: intFlag(flags, 'limit'),
      });
      return json
        ? JSON.stringify(result, null, 2)
        : printTable(
            result.map((b) => ({
              code: b.confirmationCode,
              status: b.status,
              checkIn: b.checkIn,
              checkOut: b.checkOut,
              source: b.source,
            })),
          );
    }

    case 'booking': {
      const code = positional[0];
      if (!code) throw new CliUsageError('Usage: openstays booking <code>');
      const result = await client.getBooking(code);
      return json
        ? JSON.stringify(result, null, 2)
        : [
            `${result.confirmationCode}  ${result.status}`,
            `${result.unitTypeName} / ${result.unitName}`,
            `${result.checkIn} -> ${result.checkOut} (${result.nights} nights, ${result.adults}A/${result.children}C)`,
            result.priceBreakdown
              ? `Total: ${(result.priceBreakdown.totalCents / 100).toFixed(2)} ${result.currency}`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
    }

    case 'hold': {
      // Parse adults/children with a strict integer parse so a typo fails
      // locally with a precise message instead of sending adults:null (NaN →
      // JSON null) for the server to reject after a round-trip.
      const adults = requireIntFlag(flags, 'adults', 1);
      const children = flags.children === undefined ? 0 : requireIntFlag(flags, 'children', 0);
      const args: CreateHoldArgs = {
        unitId: requireFlag(flags, 'unit-id'),
        ratePlanId: requireFlag(flags, 'rate-plan-id'),
        checkIn: requireFlag(flags, 'check-in'),
        checkOut: requireFlag(flags, 'check-out'),
        adults,
        children,
        guest: {
          name: requireFlag(flags, 'name'),
          email: requireFlag(flags, 'email'),
          phone: flags.phone ?? '',
          marketingOptIn: flags['marketing-opt-in'] === 'true',
        },
        addOns: [],
        promoCode: flags['promo-code'],
      };
      const result = await client.createHold(args);
      return json
        ? JSON.stringify(result, null, 2)
        : `${result.confirmationCode}  hold  total ${(result.price.totalCents / 100).toFixed(2)}` +
            `  expires ${new Date(result.holdExpiresAt).toISOString()}`;
    }

    case 'cancel': {
      const code = positional[0];
      if (!code) throw new CliUsageError('Usage: openstays cancel <code> --email <e>');
      const email = requireFlag(flags, 'email');
      const result = await client.cancelBooking(code, { email });
      return json
        ? JSON.stringify(result, null, 2)
        : `refunded ${(result.refundCents / 100).toFixed(2)} of ${(result.paidCents / 100).toFixed(2)} paid`;
    }

    case 'promo-preview': {
      const code = requireFlag(flags, 'code');
      const property = requireFlag(flags, 'property');
      const unitType = requireFlag(flags, 'unit-type');
      const result = await client.promoPreview({ code, property, unitType });
      return json
        ? JSON.stringify(result, null, 2)
        : result.valid
          ? `valid: ${result.code} (${result.kind})`
          : `invalid: ${result.reason}`;
    }

    default:
      throw new CliUsageError(`Unknown command: ${command ?? '(none)'}\n\n${HELP_TEXT}`);
  }
}

/**
 * Warn (to stderr, never stdout) when the API key was passed via --key. A key
 * on the command line lands in the OS process table (`ps`, Task Manager) and in
 * shell history — OPENSTAYS_API_KEY in the environment does not. We never echo
 * the key itself. (Adversarial review 2026-07-08.)
 */
function warnIfKeyOnArgv(parsed: ParsedArgs): void {
  if (parsed.key !== undefined) {
    process.stderr.write(
      'Warning: passing --key exposes your API key in process listings and shell ' +
        'history. Prefer the OPENSTAYS_API_KEY environment variable.\n',
    );
  }
}

function processSignalController(): AbortController {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return controller;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (parsed.help || parsed.command === undefined) {
    process.stdout.write(HELP_TEXT);
    process.exit(parsed.help ? 0 : 1);
    return;
  }

  if (parsed.command === 'mcp') {
    warnIfKeyOnArgv(parsed);
    const baseUrl = parsed.url ?? process.env.OPENSTAYS_URL;
    const apiKey = parsed.key ?? process.env.OPENSTAYS_API_KEY;
    if (!baseUrl || !apiKey) {
      process.stderr.write('OPENSTAYS_URL and OPENSTAYS_API_KEY (or --url/--key) are required.\n');
      process.exit(1);
      return;
    }
    await runMcpServer({ baseUrl, apiKey });
    return;
  }

  if (parsed.command === 'wave-bridge') {
    const openStaysUrl = parsed.url ?? process.env.OPENSTAYS_URL;
    const bridgeToken = process.env.WAVELENGTH_BRIDGE_TOKEN;
    if (!openStaysUrl || !bridgeToken) {
      process.stderr.write('OPENSTAYS_URL and WAVELENGTH_BRIDGE_TOKEN are required.\n');
      process.exit(1);
      return;
    }
    const expectedNetworkValue = process.env.WAVELENGTH_EXPECTED_NETWORK;
    if (expectedNetworkValue && expectedNetworkValue !== 'signet') {
      process.stderr.write('WAVELENGTH_EXPECTED_NETWORK must be signet.\n');
      process.exit(1);
      return;
    }
    const expectedNetwork = expectedNetworkValue === 'signet' ? expectedNetworkValue : undefined;
    const macaroonPath = process.env.WAVELENGTH_DAEMON_MACAROON_PATH;
    const daemonMacaroonHex = macaroonPath
      ? readFileSync(macaroonPath).toString('hex')
      : undefined;
    const controller = processSignalController();
    const treasuryRuntime = loadTreasuryRuntimeConfig(process.env);
    await runWaveBridge({
      openStaysUrl,
      bridgeToken,
      daemonUrl: process.env.WAVELENGTH_DAEMON_URL ?? 'http://127.0.0.1:10031',
      expectedNetwork,
      daemonMacaroonHex,
      maxRewardFeeSats: process.env.WAVELENGTH_REWARD_MAX_FEE_SATS ? Number(process.env.WAVELENGTH_REWARD_MAX_FEE_SATS) : 210,
      pollMs: process.env.WAVELENGTH_BRIDGE_POLL_MS ? Number(process.env.WAVELENGTH_BRIDGE_POLL_MS) : undefined,
      once: parsed.flags.once === 'true',
      signal: controller.signal,
      heartbeatToken: process.env.WAVELENGTH_HEARTBEAT_TOKEN,
      release: process.env.OPENSTAYS_RELEASE,
      treasuryRuntime: treasuryRuntime.enabled ? treasuryRuntime : undefined,
      treasuryJournalDir: treasuryRuntime.enabled
        ? process.env.WAVELENGTH_TREASURY_JOURNAL_DIR
          ?? join(process.env.OPENSTAYS_STATE_DIR ?? '.openstays', 'treasury-journal')
        : undefined,
    });
    return;
  }

  if (parsed.command === 'ots-bridge') {
    const openStaysUrl = parsed.url ?? process.env.OPENSTAYS_URL;
    const bridgeToken = process.env.OTS_BRIDGE_TOKEN;
    if (!openStaysUrl || !bridgeToken) {
      process.stderr.write('OPENSTAYS_URL and OTS_BRIDGE_TOKEN are required.\n');
      process.exit(1);
      return;
    }
    const controller = processSignalController();
    await runOtsBridge({ openStaysUrl, bridgeToken,
      pollMs: process.env.OTS_BRIDGE_POLL_MS ? Number(process.env.OTS_BRIDGE_POLL_MS) : undefined,
      once: parsed.flags.once === 'true',
      signal: controller.signal,
      heartbeatToken: process.env.OTS_HEARTBEAT_TOKEN,
      release: process.env.OPENSTAYS_RELEASE });
    return;
  }

  if (parsed.command === 'mail-bridge') {
    const openStaysUrl = parsed.url ?? process.env.OPENSTAYS_URL;
    const bridgeToken = process.env.MAIL_BRIDGE_TOKEN;
    if (!openStaysUrl || !bridgeToken) {
      process.stderr.write('OPENSTAYS_URL and MAIL_BRIDGE_TOKEN are required.\n');
      process.exit(1);
      return;
    }
    const controller = processSignalController();
    await runMailBridge({
      openStaysUrl,
      bridgeToken,
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
      smtpSecure: process.env.SMTP_SECURE === 'true',
      smtpUsername: process.env.SMTP_USERNAME,
      smtpPassword: process.env.SMTP_PASSWORD,
      pollMs: process.env.MAIL_BRIDGE_POLL_MS ? Number(process.env.MAIL_BRIDGE_POLL_MS) : undefined,
      once: parsed.flags.once === 'true',
      signal: controller.signal,
      heartbeatToken: process.env.MAIL_HEARTBEAT_TOKEN,
      release: process.env.OPENSTAYS_RELEASE,
    });
    return;
  }

  warnIfKeyOnArgv(parsed);
  const baseUrl = parsed.url ?? process.env.OPENSTAYS_URL;
  const apiKey = parsed.key ?? process.env.OPENSTAYS_API_KEY;
  if (!baseUrl || !apiKey) {
    process.stderr.write('OPENSTAYS_URL and OPENSTAYS_API_KEY (or --url/--key) are required.\n');
    process.exit(1);
    return;
  }

  const clientOptions: OpenStaysClientOptions = { baseUrl, apiKey };
  const client = new OpenStaysClient(clientOptions);

  try {
    const output = await dispatch(parsed, client);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    if (error instanceof ApiError) {
      process.stderr.write(`Error [${error.code}] (HTTP ${error.status}): ${error.message}\n`);
      process.exit(1);
    } else if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    } else {
      throw error;
    }
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule || process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void main().catch(() => {
    process.stderr.write('openstays: command_failed\n');
    process.exitCode = 1;
  });
}
