import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve('.');
const profile = JSON.parse(readFileSync(resolve(root, 'config', 'production-profile.json'), 'utf8'));
const convexOnly = process.argv.includes('--convex-only');
const production = process.env.VITE_OPENSTAYS_PROFILE === 'production';

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

function verify(directory, forbidden, options = {}) {
  const violations = [];
  for (const path of filesUnder(directory)) {
    const relativePath = relative(directory, path).replaceAll('\\', '/');
    if (options.ignoreGeneratedTypes && relativePath.startsWith('_generated/')) continue;
    const lowerPath = relativePath.toLowerCase();
    for (const token of forbidden) {
      if (lowerPath.includes(token.toLowerCase())) violations.push(`${relativePath}: filename contains ${token}`);
    }
    if (!['.js', '.css', '.html', '.json', '.txt', '.ts', '.md', ''].includes(extname(path))) continue;
    if (statSync(path).size > 8_000_000) continue;
    const text = readFileSync(path, 'utf8').toLowerCase();
    for (const token of forbidden) {
      if (text.includes(token.toLowerCase())) violations.push(`${relativePath}: content contains ${token}`);
    }
  }
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exitCode = 1;
  }
}

try {
  verify(resolve(root, 'convex-production'), profile.convexForbidden, { ignoreGeneratedTypes: true });
} catch (error) {
  if (convexOnly) throw error;
}

if (!convexOnly && production) {
  verify(resolve(root, 'dist'), profile.frontendForbidden);
}

if (!process.exitCode) process.stdout.write('Production artifact boundary verified.\n');
