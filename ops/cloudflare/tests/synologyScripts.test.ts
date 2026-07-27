import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
const deployPath = join(repositoryRoot, 'ops', 'synology', 'deploy.sh');
const recoveryPath = join(
  repositoryRoot,
  'ops',
  'synology',
  'recovery-drill.sh',
);
const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function script(path: string) {
  return readFileSync(path, 'utf8');
}

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'openstays-synology-script-'));
  temporaryRoots.push(root);
  return root;
}

function executable(path: string, source: string) {
  writeFileSync(path, source, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function gitBashPath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.replace(/^([A-Za-z]):/u, (_, drive: string) =>
    `/${drive.toLowerCase()}`);
}

function sandboxedScript(sourcePath: string, root: string) {
  const appRoot = join(root, 'volume1', 'docker', 'openstays-merchant');
  const backupRoot = join(root, 'volume2', 'openstays-wallet-backups');
  const scriptAppRoot = gitBashPath(appRoot);
  const scriptBackupRoot = gitBashPath(backupRoot);
  const destination = join(root, 'script.sh');
  const rewritten = script(sourcePath)
    .replaceAll('/volume1/docker/openstays-merchant', scriptAppRoot)
    .replaceAll('/volume2/openstays-wallet-backups', scriptBackupRoot);
  writeFileSync(destination, rewritten, { mode: 0o755 });
  chmodSync(destination, 0o755);
  return { destination, appRoot, backupRoot };
}

function run(
  file: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
) {
  return spawnSync(bash, [file, ...args], {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
  });
}

describe('Synology script contracts', () => {
  it('pins the only approved roots, user, project, and container', () => {
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).toContain(
        'APP_ROOT=/volume1/docker/openstays-merchant',
      );
      expect(body).toContain(
        'BACKUP_ROOT=/volume2/openstays-wallet-backups',
      );
      expect(body).toContain('test "$(id -un)" = "murdawk"');
      expect(body).toContain('openstays-merchant');
    }
    expect(script(deployPath)).toContain(
      '--project-name openstays-merchant',
    );
  });

  it('never prunes Docker, deletes protected state, or targets other containers', () => {
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).not.toMatch(/docker\s+system\s+prune/u);
      expect(body).not.toMatch(/docker\s+(?:rm|stop|kill)\s+(?!["']?openstays-merchant\b)/u);
      expect(body).not.toMatch(/rm\s+-[^\n]*r/u);
      expect(body).not.toMatch(/rm\s+[^\n]*(?:APP_ROOT|BACKUP_ROOT|QUARANTINE)/u);
    }
  });

  it('is noninteractive and rejects symlink or escaped paths', () => {
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).toContain('test ! -L');
      expect(body).toContain('readlink -f --');
      expect(body).not.toMatch(/\bsudo\b/u);
      expect(body).not.toMatch(/\bread\s+(?:-[^\n]*\s+)?-p\b/u);
      expect(body).not.toContain('docker exec -it');
    }
  });

  it('fails closed unless all public rails begin disabled', () => {
    const body = script(deployPath);
    expect(body).toContain('ZAPRITE_ENABLED');
    expect(body).toContain('WAVELENGTH_ENABLED');
    expect(body).toContain('WAVELENGTH_REWARDS_ENABLED');
    expect(body.match(/^require_disabled_flag /gmu)).toHaveLength(3);
  });

  it('quarantines atomically, syncs metadata, verifies restore, and removes nothing', () => {
    const body = script(recoveryPath);
    expect(body).toMatch(/QUARANTINE_PATH=.*timestamp/u);
    expect(body).toContain('mv -- "$LIVE_WALLET" "$QUARANTINE_PATH"');
    expect(body).toContain('sync');
    expect(body).toContain('wallet_snapshot');
    expect(body).toContain('RESTORE_IDENTITY_ACTIVITY_MISMATCH');
    expect(body).not.toMatch(/\brm\b/u);
  });

  it('both scripts have valid Bash syntax', () => {
    execFileSync(bash, ['-n', deployPath]);
    execFileSync(bash, ['-n', recoveryPath]);
  });
});

describe('Synology script behavior with fake host commands', () => {
  it('deploy rejects the wrong account before calling Docker', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(deployPath, root);
    executable(
      join(bin, 'id'),
      '#!/usr/bin/env bash\n[[ "$1" == "-un" ]] && echo somebody\n',
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash\necho called > "${join(root, 'docker-called').replaceAll('\\', '/')}"\n`,
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DEPLOY_USER_MUST_BE_MURDAWK');
    expect(() => readFileSync(join(root, 'docker-called'))).toThrow();
  });

  it('deploy renders then starts only the named project with disabled flags', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    const calls = join(root, 'calls');
    mkdirSync(bin);
    const { destination, appRoot, backupRoot } = sandboxedScript(
      deployPath,
      root,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf murdawk')
        .replaceAll('id -u murdawk', 'printf 1234')
        .replaceAll('id -g murdawk', 'printf 2345'),
      { mode: 0o755 },
    );
    mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });
    copyFileSync(
      join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
      `${appRoot}/source/ops/synology/docker-compose.yml`,
    );
    mkdirSync(`${appRoot}/config`, { recursive: true });
    const requiredSecrets = [
      'OPENSTAYS_API_KEY',
      'CONTAINER_CONTROL_TOKEN',
      'WALLET_BACKUP_KEY_BASE64',
      'WAVELENGTH_WALLET_PASSWORD',
      'WAVELENGTH_BRIDGE_TOKEN',
      'WAVELENGTH_HEARTBEAT_TOKEN',
      'OTS_BRIDGE_TOKEN',
      'OTS_HEARTBEAT_TOKEN',
      'MAIL_BRIDGE_TOKEN',
      'MAIL_HEARTBEAT_TOKEN',
      'SMTP_PASSWORD',
    ];
    writeFileSync(
      `${appRoot}/config/merchant.env`,
      [
        'OPENSTAYS_UID=1234',
        'OPENSTAYS_GID=2345',
        'ZAPRITE_ENABLED=false',
        'WAVELENGTH_ENABLED=false',
        'WAVELENGTH_REWARDS_ENABLED=false',
        ...requiredSecrets.map((name) => `${name}=not-empty`),
      ].join('\n'),
      { mode: 0o600 },
    );
    executable(
      join(bin, 'id'),
      `#!/usr/bin/env bash
case "$1" in
  -un) echo murdawk ;;
  -u) echo 1234 ;;
  -g) echo 2345 ;;
esac
`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
if [[ "$*" == *"exec openstays-merchant"* ]]; then
  printf '{"status":"awaiting_bootstrap"}\\n'
fi
`,
    );
    executable(
      join(bin, 'stat'),
      `#!/usr/bin/env bash
case "$*" in
  *"%a"*) echo 600 ;;
  *"%U"*) echo murdawk ;;
  *) exit 1 ;;
esac
`,
    );
    executable(
      join(bin, 'install'),
      `#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    -d|-m|700) ;;
    *) mkdir -p -- "$argument" ;;
  esac
done
`,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('install ', `${gitBashPath(join(bin, 'install'))} `)
        .replaceAll('stat ', `${gitBashPath(join(bin, 'stat'))} `)
        .replaceAll('docker ', `${gitBashPath(join(bin, 'docker'))} `),
      { mode: 0o755 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
    });
    expect(result.status, result.stderr).toBe(0);
    const recorded = readFileSync(calls, 'utf8').trim().split('\n');

    expect(recorded[0]).toContain(
      'compose --project-name openstays-merchant',
    );
    expect(recorded[0]).toContain('config --quiet');
    expect(recorded[1]).toContain(
      'compose --project-name openstays-merchant',
    );
    expect(recorded[1]).toMatch(/up -d --build merchant$/u);
    expect(recorded).toHaveLength(3);
  });

  it('recovery stops only the merchant, preserves quarantine, and verifies snapshots', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    const calls = join(root, 'calls');
    const syncCalls = join(root, 'sync-calls');
    mkdirSync(bin);
    const { destination, appRoot, backupRoot } = sandboxedScript(
      recoveryPath,
      root,
    );
    mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
    mkdirSync(`${appRoot}/config`, { recursive: true });
    mkdirSync(`${appRoot}/state/wavelength`, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });
    writeFileSync(`${appRoot}/config/merchant.env`, 'disabled=true\n');
    copyFileSync(
      join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
      `${appRoot}/source/ops/synology/docker-compose.yml`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  *"node --input-type=module --eval"*)
    printf '%064d' 0
    ;;
  *"operator.mjs health"*)
    printf '{"status":"ready"}\\n'
    ;;
esac
`,
    );
    executable(
      join(bin, 'install'),
      `#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    -d|-m|700) ;;
    *) mkdir -p -- "$argument" ;;
  esac
done
`,
    );
    executable(
      join(bin, 'sync'),
      `#!/usr/bin/env bash
printf 'sync\\n' >> "${syncCalls.replaceAll('\\', '/')}"
`,
    );
    executable(
      join(bin, 'mv'),
      `#!/usr/bin/env bash
printf 'mv %s %s\\n' "\${2:-}" "\${3:-}" >> "${calls.replaceAll('\\', '/')}"
/usr/bin/mv "$@"
`,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf murdawk')
        .replaceAll('docker ', `${gitBashPath(join(bin, 'docker'))} `)
        .replaceAll('install ', `${gitBashPath(join(bin, 'install'))} `)
        .replaceAll('\nsync\n', `\n${gitBashPath(join(bin, 'sync'))}\n`)
        .replaceAll('mv --', `${gitBashPath(join(bin, 'mv'))} --`),
      { mode: 0o755 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
    });
    expect(result.status, result.stderr).toBe(0);
    const recorded = readFileSync(calls, 'utf8').trim().split('\n');

    expect(recorded).toContain('stop openstays-merchant');
    expect(recorded.some((line) =>
      line.includes(
        'compose --project-name openstays-merchant',
      ) && line.endsWith('up -d merchant'))).toBe(true);
    expect(recorded.some((line) =>
      line.includes('operator.mjs backup'))).toBe(true);
    expect(recorded.join('\n')).not.toMatch(/\b(?:rm|prune)\b/u);
    expect(readFileSync(syncCalls, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(() =>
      readFileSync(`${appRoot}/state/wavelength`)).toThrow();
    expect(readdirSync(`${appRoot}/state/quarantine`)).toHaveLength(1);
    expect(result.stdout).toContain('quarantine preserved');
  });
});
