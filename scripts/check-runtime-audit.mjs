import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RSC_ONLY_ADVISORY = 'GHSA-qwww-vcr4-c8h2';
const RSC_IDENTIFIERS = [
  'RSCHydratedRouter',
  'RSCStaticRouter',
  'createCallServer',
  'getRSCStream',
  'matchRSCServerRequest',
  'routeRSCServerRequest',
];

function advisoryId(url) {
  return typeof url === 'string'
    ? url.match(/GHSA-[a-z0-9-]+/i)?.[0]
    : undefined;
}

export function evaluateRuntimeAudit(report) {
  const acceptedAdvisories = new Set();
  const blockingAdvisories = new Set();

  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(vulnerability?.severity)) continue;
    const entries = Array.isArray(vulnerability.via)
      ? vulnerability.via.filter((entry) => typeof entry === 'object')
      : [];

    for (const entry of entries) {
      const id = advisoryId(entry.url) ?? `${vulnerability.name}:unknown`;
      if (id === RSC_ONLY_ADVISORY) acceptedAdvisories.add(id);
      else blockingAdvisories.add(id);
    }
  }

  return {
    acceptedAdvisories: [...acceptedAdvisories].sort(),
    blockingAdvisories: [...blockingAdvisories].sort(),
  };
}

function sourceFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(path))) files.push(path);
  }
  return files;
}

function assertClientOnlyRouterUsage(repoRoot) {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (dependencies['@react-router/dev'] || dependencies['@react-router/serve']) {
    throw new Error('RSC-only audit exception is invalid with React Router server tooling installed.');
  }

  for (const file of sourceFiles(join(repoRoot, 'src'))) {
    const source = readFileSync(file, 'utf8');
    const identifier = RSC_IDENTIFIERS.find((candidate) => source.includes(candidate));
    if (identifier) {
      throw new Error(`RSC-only audit exception is invalid: ${identifier} is used in ${file}.`);
    }
  }
}

function main() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const audit = process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
        ['/d', '/s', '/c', 'npm audit --omit=dev --audit-level=high --json'],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      )
    : spawnSync(
        'npm',
        ['audit', '--omit=dev', '--audit-level=high', '--json'],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      );
  if (!audit.stdout) {
    throw new Error(audit.stderr || 'npm audit produced no JSON output.');
  }

  const result = evaluateRuntimeAudit(JSON.parse(audit.stdout));
  if (result.acceptedAdvisories.includes(RSC_ONLY_ADVISORY)) {
    assertClientOnlyRouterUsage(repoRoot);
  }
  if (result.blockingAdvisories.length > 0) {
    throw new Error(`Blocking runtime advisories: ${result.blockingAdvisories.join(', ')}`);
  }

  process.stdout.write(
    result.acceptedAdvisories.length === 0
      ? 'Runtime dependency audit passed with no high or critical advisories.\n'
      : `Runtime dependency audit passed with reviewed non-applicable advisory: ${result.acceptedAdvisories.join(', ')}.\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
