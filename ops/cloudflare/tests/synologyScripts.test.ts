import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
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
const bash = process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\bin\\bash.exe'
  : 'bash';
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

function prepareDeploySandbox(root: string, dockerSource: string) {
  const bin = join(root, 'bin');
  const calls = join(root, 'calls');
  mkdirSync(bin);
  const { destination, appRoot, backupRoot } = sandboxedScript(
    deployPath,
    root,
  );
  mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
  mkdirSync(`${appRoot}/config`, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });
  copyFileSync(
    join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
    `${appRoot}/source/ops/synology/docker-compose.yml`,
  );
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
  executable(join(bin, 'docker'), dockerSource);
  executable(
    join(bin, 'stat'),
    '#!/usr/bin/env bash\n[[ "$*" == *"%a"* ]] && echo 600 || echo murdawk\n',
  );
  executable(
    join(bin, 'install'),
    '#!/usr/bin/env bash\nfor argument in "$@"; do case "$argument" in -d|-m|700) ;; *) mkdir -p -- "$argument" ;; esac; done\n',
  );
  writeFileSync(
    destination,
    readFileSync(destination, 'utf8')
      .replaceAll('id -un', 'printf murdawk')
      .replaceAll('id -u murdawk', 'printf 1234')
      .replaceAll('id -g murdawk', 'printf 2345')
      .replaceAll('install ', `${gitBashPath(join(bin, 'install'))} `)
      .replaceAll('stat ', `${gitBashPath(join(bin, 'stat'))} `)
      .replaceAll('docker ', `${gitBashPath(join(bin, 'docker'))} `),
    { mode: 0o755 },
  );
  return {
    destination,
    appRoot,
    backupRoot,
    calls,
    bin,
  };
}

function identityOutput(appRoot: string, backupRoot: string) {
  return `printf '%s\\n' 'openstays-merchant' 'merchant' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'`;
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

  it('attests the exact Compose identity, mounts, and absence of published ports', () => {
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).toContain('com.docker.compose.project');
      expect(body).toContain('com.docker.compose.service');
      expect(body).toContain(
        '/volume1/docker/openstays-merchant/state>/var/lib/openstays',
      );
      expect(body).toContain(
        '/volume2/openstays-wallet-backups>/var/backups/openstays',
      );
      expect(body).toContain('.HostConfig.PortBindings');
      expect(body).toContain('{{ .Type }}>{{ .RW }}');
      expect(body).toContain('CONTAINER_IDENTITY_INVALID');
    }
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
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).toContain('ZAPRITE_ENABLED');
      expect(body).toContain('WAVELENGTH_ENABLED');
      expect(body).toContain('WAVELENGTH_REWARDS_ENABLED');
      expect(body.match(/^require_disabled_flag /gmu)).toHaveLength(3);
    }
  });

  it('quarantines atomically, syncs metadata, verifies restore, and removes nothing', () => {
    const body = script(recoveryPath);
    expect(body).toMatch(/QUARANTINE_PATH=.*timestamp/u);
    expect(body).toContain('mv -- "$LIVE_WALLET" "$QUARANTINE_PATH"');
    expect(body).toContain('sync');
    expect(body).toContain('wallet_snapshot');
    expect(body).toContain('RESTORE_IDENTITY_ACTIVITY_MISMATCH');
    expect(body).toContain('trap stop_failed_recovery EXIT');
    expect(body).toContain('trap - EXIT');
    expect(body).not.toMatch(/\brm\b/u);
  });

  it('arms and disarms project-scoped deployment cleanup', () => {
    const body = script(deployPath);
    expect(body).toContain('trap stop_failed_deploy EXIT');
    expect(body).toContain("trap 'exit 130' INT TERM");
    expect(body).toContain('trap - EXIT INT TERM');
    expect(body).toMatch(
      /docker compose --project-name openstays-merchant[\s\S]+--env-file "\$ENV_FILE"[\s\S]+-f "\$COMPOSE_FILE"[\s\S]+stop merchant/u,
    );
    expect(body).not.toContain('docker stop openstays-merchant');
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

  it('deploy rejects an ancestor symlink before any managed-directory write', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    const outside = join(root, 'outside');
    const volume1 = join(root, 'volume1');
    const volume2 = join(root, 'volume2');
    const installCalled = join(root, 'install-called');
    mkdirSync(bin);
    mkdirSync(outside);
    mkdirSync(volume1);
    mkdirSync(volume2);
    symlinkSync(
      outside,
      join(volume1, 'docker'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const { destination } = sandboxedScript(deployPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replaceAll(
        'id -un',
        'printf murdawk',
      ),
      { mode: 0o755 },
    );
    executable(
      join(bin, 'install'),
      `#!/usr/bin/env bash
printf called > "${installCalled.replaceAll('\\', '/')}"
exit 90
`,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replaceAll(
        'install ',
        `${gitBashPath(join(bin, 'install'))} `,
      ),
      { mode: 0o755 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SYMLINK_PATH_REJECTED');
    expect(() => readFileSync(installCalled)).toThrow();
    expect(readdirSync(outside)).toEqual([]);
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
if [[ "$1 $2" == "container inspect" ]]; then
  exit 1
elif [[ "$1" == "inspect" ]]; then
  printf '%s\\n' 'openstays-merchant' 'merchant' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
elif [[ "$*" == *"exec openstays-merchant"* ]]; then
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
    const recordedText = recorded.join('\n');

    expect(recordedText).toContain(
      'compose --project-name openstays-merchant',
    );
    expect(recordedText).toContain('config --quiet');
    expect(recordedText).toContain('container inspect openstays-merchant');
    expect(recordedText).toMatch(/up -d --build merchant/u);
    expect(recordedText).toContain('inspect --format');
    expect(recordedText).toContain('exec openstays-merchant');
  });

  it('leaves a pre-existing attested project container running after a successful update', () => {
    const root = temporaryRoot();
    const placeholderApp = gitBashPath(
      join(root, 'volume1', 'docker', 'openstays-merchant'),
    );
    const placeholderBackup = gitBashPath(
      join(root, 'volume2', 'openstays-wallet-backups'),
    );
    const calls = join(root, 'calls');
    const prepared = prepareDeploySandbox(
      root,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 0 ;;
  inspect*) ${identityOutput(placeholderApp, placeholderBackup)} ;;
  *"operator.mjs health"*) printf '{"status":"ready"}\\n' ;;
esac
`,
    );

    const result = run(prepared.destination, {
      ...process.env,
      PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
    });
    const recorded = readFileSync(prepared.calls, 'utf8');

    expect(result.status, result.stderr).toBe(0);
    expect(recorded).toContain('container inspect openstays-merchant');
    expect(recorded).toMatch(/up -d --build merchant/u);
    expect(recorded).not.toMatch(/\bstop merchant\b/u);
  });

  it('scoped-stops the project when post-up identity or ports are wrong', () => {
    const root = temporaryRoot();
    const calls = join(root, 'calls');
    const prepared = prepareDeploySandbox(
      root,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 1 ;;
  inspect*) printf '%s\\n' 'openstays-merchant' 'merchant' '2' 'wrong-state>/var/lib/openstays>bind>true' 'wrong-backup>/var/backups/openstays>bind>true' '1' ;;
esac
`,
    );

    const result = run(prepared.destination, {
      ...process.env,
      PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
    });
    const recorded = readFileSync(prepared.calls, 'utf8');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CONTAINER_IDENTITY_INVALID');
    expect(recorded).toMatch(
      /compose --project-name openstays-merchant .*--env-file .*merchant\.env .*docker-compose\.yml stop merchant/u,
    );
    expect(recorded).not.toContain('stop openstays-merchant');
  });

  it('preserves an up failure when the scoped cleanup also fails', () => {
    const root = temporaryRoot();
    const calls = join(root, 'calls');
    const prepared = prepareDeploySandbox(
      root,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 1 ;;
  *"up -d --build merchant"*) exit 23 ;;
  *"stop merchant"*) exit 88 ;;
esac
`,
    );

    const result = run(prepared.destination, {
      ...process.env,
      PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
    });
    const recorded = readFileSync(prepared.calls, 'utf8');

    expect(result.status).toBe(23);
    expect(recorded).toMatch(/up -d --build merchant/u);
    expect(recorded).toMatch(/\bstop merchant\b/u);
    expect(recorded).not.toContain('stop openstays-merchant');
  });

  it('scoped-stops the project when post-up health fails', () => {
    const root = temporaryRoot();
    const placeholderApp = gitBashPath(
      join(root, 'volume1', 'docker', 'openstays-merchant'),
    );
    const placeholderBackup = gitBashPath(
      join(root, 'volume2', 'openstays-wallet-backups'),
    );
    const calls = join(root, 'calls');
    const prepared = prepareDeploySandbox(
      root,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 1 ;;
  inspect*) ${identityOutput(placeholderApp, placeholderBackup)} ;;
  *"operator.mjs health"*) exit 42 ;;
esac
`,
    );

    const result = run(prepared.destination, {
      ...process.env,
      PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
    });
    const recorded = readFileSync(prepared.calls, 'utf8');

    expect(result.status).toBe(42);
    expect(recorded).toContain('operator.mjs health');
    expect(recorded).toMatch(/\bstop merchant\b/u);
    expect(recorded).not.toContain('stop openstays-merchant');
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
    writeFileSync(
      `${appRoot}/config/merchant.env`,
      [
        'ZAPRITE_ENABLED=false',
        'WAVELENGTH_ENABLED=false',
        'WAVELENGTH_REWARDS_ENABLED=false',
      ].join('\n'),
    );
    copyFileSync(
      join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
      `${appRoot}/source/ops/synology/docker-compose.yml`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  inspect*)
    printf '%s\\n' 'openstays-merchant' 'merchant' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
    ;;
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

  it('recovery refuses a same-name container with the wrong Compose identity', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    const calls = join(root, 'calls');
    mkdirSync(bin);
    const { destination, appRoot, backupRoot } = sandboxedScript(
      recoveryPath,
      root,
    );
    mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
    mkdirSync(`${appRoot}/config`, { recursive: true });
    mkdirSync(`${appRoot}/state/wavelength`, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });
    writeFileSync(
      `${appRoot}/config/merchant.env`,
      [
        'ZAPRITE_ENABLED=false',
        'WAVELENGTH_ENABLED=false',
        'WAVELENGTH_REWARDS_ENABLED=false',
      ].join('\n'),
    );
    copyFileSync(
      join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
      `${appRoot}/source/ops/synology/docker-compose.yml`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
printf '%s\\n' 'wrong-project' 'merchant' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
`,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf murdawk')
        .replaceAll('docker ', `${gitBashPath(join(bin, 'docker'))} `),
      { mode: 0o755 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
    });
    const recorded = readFileSync(calls, 'utf8');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CONTAINER_IDENTITY_INVALID');
    expect(recorded).toContain('inspect --format');
    expect(recorded).not.toMatch(/\b(?:stop|exec|up)\b/u);
  });

  it('stops the attested merchant when a post-start snapshot mismatches', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    const calls = join(root, 'calls');
    const snapshotCount = join(root, 'snapshot-count');
    mkdirSync(bin);
    const { destination, appRoot, backupRoot } = sandboxedScript(
      recoveryPath,
      root,
    );
    mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
    mkdirSync(`${appRoot}/config`, { recursive: true });
    mkdirSync(`${appRoot}/state/wavelength`, { recursive: true });
    mkdirSync(backupRoot, { recursive: true });
    writeFileSync(
      `${appRoot}/config/merchant.env`,
      [
        'ZAPRITE_ENABLED=false',
        'WAVELENGTH_ENABLED=false',
        'WAVELENGTH_REWARDS_ENABLED=false',
      ].join('\n'),
    );
    copyFileSync(
      join(repositoryRoot, 'ops', 'synology', 'docker-compose.yml'),
      `${appRoot}/source/ops/synology/docker-compose.yml`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  inspect*)
    printf '%s\\n' 'openstays-merchant' 'merchant' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
    ;;
  *"node --input-type=module --eval"*)
    count=0
    [[ -f "${snapshotCount.replaceAll('\\', '/')}" ]] && count="$(cat "${snapshotCount.replaceAll('\\', '/')}")"
    count=$((count + 1))
    printf '%s' "$count" > "${snapshotCount.replaceAll('\\', '/')}"
    if [[ "$count" -eq 1 ]]; then printf '%064d' 0; else printf '%064d' 1; fi
    ;;
  *"operator.mjs health"*)
    printf '{"status":"ready"}\\n'
    ;;
esac
`,
    );
    executable(
      join(bin, 'install'),
      '#!/usr/bin/env bash\nmkdir -p -- "${@: -1}"\n',
    );
    executable(join(bin, 'sync'), '#!/usr/bin/env bash\nexit 0\n');
    executable(join(bin, 'mv'), '#!/usr/bin/env bash\n/usr/bin/mv "$@"\n');
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
    const recorded = readFileSync(calls, 'utf8').trim().split('\n');
    const stops = recorded.filter((line) =>
      line === 'stop openstays-merchant');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RESTORE_IDENTITY_ACTIVITY_MISMATCH');
    expect(stops).toHaveLength(2);
    expect(recorded.some((line) =>
      line.includes('operator.mjs backup'))).toBe(false);
  });
});
