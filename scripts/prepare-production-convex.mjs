import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('.');
const sourceRoot = resolve(root, 'convex');
const outputRoot = resolve(root, 'convex-production');
const templateRoot = resolve(root, 'scripts', 'production-convex-templates');
const profile = JSON.parse(readFileSync(resolve(root, 'config', 'production-profile.json'), 'utf8'));
const excluded = new Set(profile.convexExcludedModules);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function transformSchema(source) {
  const start = source.indexOf('  wavelengthRequests: defineTable({');
  const end = source.indexOf('  // Webhook idempotency ledger.');
  invariant(start >= 0 && end > start, 'PRODUCTION_SCHEMA_EXPERIMENTAL_BLOCK_NOT_FOUND');
  let result = source.slice(0, start) + source.slice(end);
  result = result.replace("import { consensusRewardSats } from './rewardPolicy';\n", '');
  result = result.replace(
    "rail: v.union(v.literal('zaprite'), v.literal('wavelength'))",
    "rail: v.literal('zaprite')",
  );
  result = result.replace(/^\s*v\.literal\('wavelength'\),\r?\n/gm, '');
  return result;
}

function transformBookings(source) {
  let result = source.replace(
    "payment.provider !== 'zaprite' && payment.provider !== 'wavelength'",
    "payment.provider !== 'zaprite'",
  );
  result = result.replace(/^\s*await ctx\.scheduler\.runAfter\(0, \(internal as any\)\.consensusReceipts\.ensureForBooking, \{ bookingId: booking\._id \}\);\r?\n/gm, '');
  result = result.replace(
    /payment\.provider === 'zaprite' \|\|\r?\n\s*payment\.provider === 'wavelength'/g,
    "payment.provider === 'zaprite'",
  );
  result = result.replace(/, v\.literal\('wavelength'\)/g, '');
  invariant(!/wavelength|consensusReceipts/i.test(result), 'PRODUCTION_BOOKINGS_TRANSFORM_INCOMPLETE');
  return result;
}

function transformRefunds(source) {
  let result = source.replace(/\s*\|\| payment\.provider === 'wavelength'/g, '');
  result = result.replace('Zaprite or Wavelength contribution', 'Zaprite payment');
  invariant(!/wavelength/i.test(result), 'PRODUCTION_REFUNDS_TRANSFORM_INCOMPLETE');
  return result;
}

function transformEmail(source) {
  let result = source.replace(', renderConsensusReceiptReady', '');
  result = result.replace(/^\s*v\.literal\('consensus_receipt'\),\r?\n/gm, '');
  result = result.replace(
    /\s*} else if \(args\.kind === 'consensus_receipt'\) \{[\s\S]*?\s*} else if \(args\.kind === 'cancellation'\) \{/,
    "\n    } else if (args.kind === 'cancellation') {",
  );
  result = result.replace(/ \| 'consensus_receipt'/g, '');
  result = result.replace(/^\s*receiptId: v\.optional\(v\.string\(\)\),\r?\n/gm, '');
  result = result.replace(/^\s*receiptSha256: v\.optional\(v\.string\(\)\),\r?\n/gm, '');
  result = result.replace(/^\s*receiptId\?: string;\r?\n/gm, '');
  result = result.replace(/^\s*receiptSha256\?: string;\r?\n/gm, '');
  result = result.replace(/^\s*receiptId: args\.receiptId,\r?\n/gm, '');
  result = result.replace(/^\s*receiptSha256: args\.receiptSha256,\r?\n/gm, '');
  invariant(!/consensus|opentimestamps|signet|reward/i.test(result), 'PRODUCTION_EMAIL_TRANSFORM_INCOMPLETE');
  return result;
}

function transformEmailTemplates(source) {
  const start = source.indexOf('export function renderConsensusReceiptReady(');
  const end = source.indexOf('type ManualRefundData', start);
  invariant(start >= 0 && end > start, 'PRODUCTION_EMAIL_TEMPLATE_BLOCK_NOT_FOUND');
  return source.slice(0, start) + source.slice(end);
}

function transformZaprite(source) {
  return source.replace("tags: ['openstays', 'consensus-commons']", "tags: ['openstays', 'production']");
}

function writeTransformed(relativePath, source) {
  let result = source;
  if (relativePath === 'schema.ts') result = transformSchema(result);
  if (relativePath === 'bookings.ts') result = transformBookings(result);
  if (relativePath === 'refunds.ts') result = transformRefunds(result);
  if (relativePath === 'email.ts') result = transformEmail(result);
  if (relativePath === 'emailTemplates.ts') result = transformEmailTemplates(result);
  if (relativePath.replaceAll('\\', '/') === 'payments/zaprite.ts') result = transformZaprite(result);
  const destination = resolve(outputRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, result, 'utf8');
}

function copyDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_generated') continue;
      copyDirectory(path);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    const relativePath = relative(sourceRoot, path);
    if (!relativePath.includes('\\') && excluded.has(entry.name)) continue;
    if (['http.ts', 'crons.ts', 'publicPolicy.ts'].includes(relativePath)) continue;
    writeTransformed(relativePath, readFileSync(path, 'utf8'));
  }
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
copyDirectory(sourceRoot);

for (const file of ['http.ts', 'crons.ts', 'publicPolicy.ts']) {
  copyFileSync(resolve(templateRoot, file), resolve(outputRoot, file));
}

// Bootstrap generated helpers for local typechecking. A deployment runs
// `convex codegen` against this function directory before pushing, replacing
// these files with the deployment-specific API and data model.
if (existsSync(resolve(sourceRoot, '_generated'))) {
  cpSync(resolve(sourceRoot, '_generated'), resolve(outputRoot, '_generated'), {
    recursive: true,
  });
}

writeFileSync(resolve(outputRoot, 'README.md'), [
  '# Generated production Convex tree',
  '',
  'Generated by `npm run production:convex:prepare`. Do not edit or commit this directory.',
  'Run Convex code generation against this function directory before deployment.',
  '',
].join('\n'));

process.stdout.write(`Prepared ${relative(root, outputRoot)}\n`);
