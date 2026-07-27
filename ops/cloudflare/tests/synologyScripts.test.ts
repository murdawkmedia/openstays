import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
const rootLauncherPath = join(
  repositoryRoot,
  'ops',
  'synology',
  'root-launcher.sh',
);
const synologyReadmePath = join(
  repositoryRoot,
  'ops',
  'synology',
  'README.md',
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
    .replaceAll('/volume2/openstays-wallet-backups', scriptBackupRoot)
    .replaceAll(
      'ROOT_TASK_PATH=/usr/local/bin:/usr/bin:/bin',
      `ROOT_TASK_PATH=${gitBashPath(join(root, 'bin'))}:/usr/bin:/bin`,
    );
  writeFileSync(destination, rewritten, { mode: 0o755 });
  chmodSync(destination, 0o755);
  return { destination, appRoot, backupRoot };
}

function sandboxedRootLauncher(root: string) {
  const bin = join(root, 'bin');
  const appRoot = join(root, 'volume1', 'docker', 'openstays-merchant');
  const backupRoot = join(root, 'volume2', 'openstays-wallet-backups');
  const volume1Docker = join(root, 'volume1', 'docker');
  const volume2 = join(root, 'volume2');
  const destination = join(root, 'openstays-merchant-root');
  mkdirSync(bin, { recursive: true });
  mkdirSync(volume1Docker, { recursive: true });
  mkdirSync(volume2, { recursive: true });
  const replacements = new Map([
    [
      'INSTALL_PATH=/usr/local/sbin/openstays-merchant-root',
      `INSTALL_PATH=${gitBashPath(destination)}`,
    ],
    [
      'APP_ROOT=/volume1/docker/openstays-merchant',
      `APP_ROOT=${gitBashPath(appRoot)}`,
    ],
    [
      'BACKUP_ROOT=/volume2/openstays-wallet-backups',
      `BACKUP_ROOT=${gitBashPath(backupRoot)}`,
    ],
    ['assert_root_parent /volume1/docker', `assert_root_parent ${gitBashPath(volume1Docker)}`],
    ['assert_root_parent /volume2', `assert_root_parent ${gitBashPath(volume2)}`],
    ['ENV=/usr/bin/env', `ENV=${gitBashPath(join(bin, 'env'))}`],
    ['READLINK=/usr/bin/readlink', 'READLINK=/usr/bin/readlink'],
    ['STAT=/usr/bin/stat', `STAT=${gitBashPath(join(bin, 'stat'))}`],
    ['GIT=/usr/local/bin/git', `GIT=${gitBashPath(join(bin, 'git'))}`],
    ['MKDIR=/bin/mkdir', `MKDIR=${gitBashPath(join(bin, 'mkdir'))}`],
    ['CHOWN=/bin/chown', `CHOWN=${gitBashPath(join(bin, 'chown'))}`],
    ['CHMOD=/bin/chmod', `CHMOD=${gitBashPath(join(bin, 'chmod'))}`],
    ['MV=/bin/mv', 'MV=/usr/bin/mv'],
    ['SYNC=/bin/sync', `SYNC=${gitBashPath(join(bin, 'sync'))}`],
    ['DATE=/bin/date', 'DATE=/usr/bin/date'],
    ['OD=/usr/bin/od', `OD=${gitBashPath(join(bin, 'od'))}`],
    ['TR=/bin/tr', 'TR=/usr/bin/tr'],
    ['RM=/bin/rm', 'RM=/usr/bin/rm'],
    ['test "$EUID" = "0"', 'test "0" = "0"'],
    [
      'test "$("$READLINK" -f -- "$0")" = "$INSTALL_PATH"',
      'test "installed" = "installed"',
    ],
  ]);
  let body = script(rootLauncherPath);
  for (const [from, to] of replacements) body = body.replaceAll(from, to);
  writeFileSync(destination, body, { mode: 0o700 });
  chmodSync(destination, 0o700);
  return { destination, appRoot, backupRoot, bin };
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
      'OPENSTAYS_UID=1026',
      'OPENSTAYS_GID=100',
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
      .replaceAll('id -u murdawk', 'printf 1026')
      .replaceAll('id -g murdawk', 'printf 100')
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
  return `printf '%s\\n' 'openstays-merchant' 'merchant' '1026:100' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'`;
}

function prepareRootLauncherTools(
  prepared: ReturnType<typeof sandboxedRootLauncher>,
  commit: string,
  safeMarker: string,
) {
  const { appRoot, bin } = prepared;
  executable(
    join(bin, 'stat'),
    `#!/usr/bin/env bash
case "$*" in
  *"%u:%g:%a"*"openstays-merchant-root"*) echo 0:0:700 ;;
  *"%u:%g:%a"*"openstays-merchant/source"*) echo 0:0:700 ;;
  *"%u:%g:%a"*"source-quarantine"*) echo 0:0:700 ;;
  *"%u:%g:%a"*"openstays-merchant/quarantine"*) echo 0:0:700 ;;
  *"%u:%g:%a"*"openstays-merchant") echo 0:0:700 ;;
  *"%u:%g:%a"*) echo 1026:100:700 ;;
  *"%u:%g"*) echo 0:0 ;;
  *"%a"*) echo 700 ;;
esac
`,
  );
  executable(join(bin, 'chown'), '#!/usr/bin/env bash\nexit 0\n');
  executable(
    join(bin, 'mkdir'),
    `#!/usr/bin/env bash
arguments=()
skip=false
for argument in "$@"; do
  if [[ "$skip" == "true" ]]; then skip=false; continue; fi
  case "$argument" in
    -m) skip=true ;;
    *) arguments+=("$argument") ;;
  esac
done
/usr/bin/mkdir "\${arguments[@]}"
`,
  );
  executable(join(bin, 'chmod'), '#!/usr/bin/env bash\nexit 0\n');
  executable(join(bin, 'sync'), '#!/usr/bin/env bash\nexit 0\n');
  executable(
    join(bin, 'od'),
    `#!/usr/bin/env bash\nprintf '%s\\n' '${'0'.repeat(32)}'\n`,
  );
  executable(
    join(bin, 'env'),
    '#!/usr/bin/env bash\nexec /usr/bin/env "$@"\n',
  );
  executable(
    join(bin, 'git'),
    `#!/usr/bin/env bash
directory=
previous=
for argument in "$@"; do
  if [[ "$previous" == "-C" ]]; then directory="$argument"; fi
  previous="$argument"
done
case "$*" in
  *" init --quiet")
    mkdir -p -- "$directory/.git"
    ;;
  *" checkout --quiet --detach "*)
    mkdir -p -- "$directory/ops/synology"
    cat > "$directory/ops/synology/deploy.sh" <<'SAFE'
#!/bin/bash
set -euo pipefail
test "$OPENSTAYS_ROOT_HANDOFF_NONCE" = "${'0'.repeat(32)}"
test -f "$OPENSTAYS_ROOT_HANDOFF_FILE"
printf safe > "${safeMarker.replaceAll('\\', '/')}"
SAFE
    chmod 700 "$directory/ops/synology/deploy.sh"
    ;;
  *" rev-parse HEAD")
    printf '%s\\n' '${commit}'
    ;;
  *" status --porcelain")
    exit 0
    ;;
esac
`,
  );
  return {
    maliciousMarker: join(appRoot, 'malicious-executed'),
    sourceRoot: join(appRoot, 'source'),
  };
}

describe('Synology script contracts', () => {
  it('uses a root-owned launcher rather than executing a writable checkout from DSM', () => {
    const body = script(rootLauncherPath);
    expect(body).toContain(
      'INSTALL_PATH=/usr/local/sbin/openstays-merchant-root',
    );
    expect(body).toContain('ROOT_LAUNCHER_INSTALL_IDENTITY_INVALID');
    expect(body).toContain(
      'REPOSITORY_URL=https://github.com/murdawkmedia/openstays.git',
    );
    expect(body).toContain('/usr/bin/env -i');
    expect(body).toContain('OPENSTAYS_LAUNCHER_SANITIZED=1');
    expect(body).toContain('BASH_FUNC_');
    expect(body).toContain('GIT_DIR');
    expect(body).toContain('OPENSTAYS_ROOT_HANDOFF_NONCE');
    expect(body).toContain('trap handoff_cleanup EXIT');
    expect(body).toContain("trap 'exit 130' INT TERM");
    expect(body).not.toContain('eval ');
    expect(body).not.toContain('source "$');
  });

  it('documents the literal digest of the exact launcher bytes', () => {
    const digest = createHash('sha256')
      .update(readFileSync(rootLauncherPath))
      .digest('hex');
    expect(script(synologyReadmePath)).toContain(digest);
  });

  it('requires the launcher handoff before either checkout script accepts root', () => {
    for (const body of [script(deployPath), script(recoveryPath)]) {
      expect(body).toContain('verify_root_launcher_handoff');
      expect(body).toContain('ROOT_LAUNCHER_HANDOFF_REQUIRED');
      expect(body).toContain('OPENSTAYS_ROOT_HANDOFF_NONCE');
    }
  });

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
      expect(body).toContain('{{ .Config.User }}');
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
  it('root launcher atomically replaces but never executes a writable checkout', () => {
    const root = temporaryRoot();
    const prepared = sandboxedRootLauncher(root);
    const commit = 'a'.repeat(40);
    const safeMarker = join(root, 'safe-executed');
    const { maliciousMarker, sourceRoot } = prepareRootLauncherTools(
      prepared,
      commit,
      safeMarker,
    );
    mkdirSync(`${sourceRoot}/ops/synology`, { recursive: true });
    executable(
      `${sourceRoot}/ops/synology/deploy.sh`,
      `#!/bin/bash\nprintf malicious > "${maliciousMarker.replaceAll('\\', '/')}"\n`,
    );

    const result = run(
      prepared.destination,
      {
        PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
        HOME: '/nonexistent',
        OPENSTAYS_LAUNCHER_SANITIZED: '1',
      },
      ['deploy', commit],
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(safeMarker, 'utf8')).toBe('safe');
    expect(() => readFileSync(maliciousMarker)).toThrow();
    expect(
      readdirSync(`${prepared.appRoot}/source-quarantine`),
    ).toHaveLength(1);
    expect(
      readFileSync(`${sourceRoot}/ops/synology/deploy.sh`, 'utf8'),
    ).toContain('printf safe');
  });

  it('root launcher eliminates Git and exported-function environment injection', () => {
    for (const [name, value] of [
      ['GIT_DIR', '/tmp/decoy'],
      ['BASH_FUNC_git%%', '() { printf compromised; }'],
    ]) {
      const root = temporaryRoot();
      const prepared = sandboxedRootLauncher(root);
      prepareRootLauncherTools(
        prepared,
        'a'.repeat(40),
        join(root, 'safe-executed'),
      );
      const result = run(
        prepared.destination,
        {
          PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
          HOME: '/nonexistent',
          OPENSTAYS_LAUNCHER_SANITIZED: '1',
          [name]: value,
        },
        ['deploy', 'a'.repeat(40)],
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ROOT_LAUNCHER_ENVIRONMENT_INVALID');
    }
  });

  it('root launcher rejects a nested symlink leaf without changing its target', () => {
    const root = temporaryRoot();
    const prepared = sandboxedRootLauncher(root);
    const external = join(root, 'external');
    mkdirSync(prepared.appRoot, { recursive: true });
    mkdirSync(external);
    chmodSync(external, 0o755);
    symlinkSync(
      external,
      `${prepared.appRoot}/config`,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    prepareRootLauncherTools(
      prepared,
      'a'.repeat(40),
      join(root, 'safe-executed'),
    );
    const beforeMode = statSync(external).mode & 0o777;

    const result = run(
      prepared.destination,
      {
        PATH: `${gitBashPath(prepared.bin)}:/usr/bin:/bin`,
        HOME: '/nonexistent',
        OPENSTAYS_LAUNCHER_SANITIZED: '1',
      },
      ['deploy', 'a'.repeat(40)],
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ROOT_LAUNCHER_DIRECTORY_INVALID');
    expect(statSync(external).mode & 0o777).toBe(beforeMode);
  });

  it('deploy rejects the wrong account before calling Docker', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(deployPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replaceAll(
        'id -un',
        'printf somebody',
      ),
      { mode: 0o755 },
    );
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

  it('deploy rejects root unless the explicit DSM task flag is present', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(deployPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replaceAll(
        'id -un',
        'printf root',
      ),
      { mode: 0o755 },
    );
    executable(
      join(bin, 'id'),
      '#!/usr/bin/env bash\n[[ "$1" == "-un" ]] && echo root\n',
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
    expect(result.stderr).toContain('DSM_ROOT_TASK_FLAG_REQUIRED');
    expect(() => readFileSync(join(root, 'docker-called'))).toThrow();
  });

  it('deploy rejects DSM root mode when murdawk is not exactly 1026:100', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(deployPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf root')
        .replaceAll('id -u murdawk', 'printf 9999')
        .replaceAll('id -g murdawk', 'printf 100'),
      { mode: 0o755 },
    );
    executable(
      join(bin, 'id'),
      `#!/usr/bin/env bash
case "$*" in
  "-un") echo root ;;
  "-u murdawk") echo 9999 ;;
  "-g murdawk") echo 100 ;;
esac
`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash\necho called > "${join(root, 'docker-called').replaceAll('\\', '/')}"\n`,
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
      OPENSTAYS_DSM_ROOT_TASK: '1',
      OPENSTAYS_DSM_SOURCE_COMMIT: 'a'.repeat(40),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MURDAWK_RUNTIME_IDENTITY_MISMATCH');
    expect(() => readFileSync(join(root, 'docker-called'))).toThrow();
  });

  it('deploy accepts only a matching root-owned launcher handoff and keeps the service non-root', () => {
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
        .replaceAll('id -un', 'printf root')
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100'),
      { mode: 0o755 },
    );
    mkdirSync(`${appRoot}/source/ops/synology`, { recursive: true });
    mkdirSync(`${appRoot}/config`, { recursive: true });
    mkdirSync(`${appRoot}/state`, { recursive: true });
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
        'OPENSTAYS_UID=1026',
        'OPENSTAYS_GID=100',
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
case "$*" in
  "-un") echo root ;;
  "-u murdawk") echo 1026 ;;
  "-g murdawk") echo 100 ;;
esac
`,
    );
    executable(
      join(bin, 'git'),
      `#!/usr/bin/env bash
case "$*" in
  *"rev-parse HEAD"*) printf '%040d\\n' 0 ;;
  *"status --porcelain"*) exit 0 ;;
  *) exit 91 ;;
esac
`,
    );
    executable(
      join(bin, 'install'),
      `#!/usr/bin/env bash
printf 'install %s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
for argument in "$@"; do
  case "$argument" in
    -d|-m|-o|-g|700|1026|100) ;;
    *) mkdir -p -- "$argument" ;;
  esac
done
`,
    );
    executable(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 1 ;;
  inspect*) ${identityOutput(gitBashPath(appRoot), gitBashPath(backupRoot))} ;;
  *"operator.mjs health"*) printf '{"status":"awaiting_bootstrap"}\\n' ;;
esac
`,
    );
    executable(
      join(bin, 'stat'),
      `#!/usr/bin/env bash
case "$*" in
  *"%u:%g:%a"*".root-handoff-"*) echo 0:0:600 ;;
  *"%u:%g:%a"*"openstays-merchant/source"*) echo 0:0:700 ;;
  *"%u:%g:%a"*"openstays-merchant") echo 0:0:700 ;;
  *"%u:%g:%a"*) echo 1026:100:700 ;;
  *"%a"*) echo 600 ;;
  *"%U"*) echo root ;;
esac
`,
    );
    const nonce = '0'.repeat(32);
    const handoff = `${appRoot}/.root-handoff-${nonce}`;
    writeFileSync(
      handoff,
      `${nonce}\ndeploy\n${'0'.repeat(40)}\n`,
      { mode: 0o600 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
      OPENSTAYS_DSM_ROOT_TASK: '1',
      OPENSTAYS_DSM_SOURCE_COMMIT: '0'.repeat(40),
      OPENSTAYS_ROOT_HANDOFF_FILE: gitBashPath(handoff),
      OPENSTAYS_ROOT_HANDOFF_NONCE: nonce,
    });

    expect(result.status, result.stderr).toBe(0);
    const recorded = readFileSync(calls, 'utf8');
    expect(recorded).not.toContain('install ');
    expect(recorded).toContain('up -d --build merchant');
    expect(
      readFileSync(
        `${appRoot}/source/ops/synology/docker-compose.yml`,
        'utf8',
      ),
    ).toContain('user: "${OPENSTAYS_UID}:${OPENSTAYS_GID}"');
  });

  it('deploy rejects shell and Docker environment injection in DSM root mode', () => {
    for (const [name, value] of [
      ['DOCKER_HOST', 'tcp://attacker.invalid:2375'],
      ['COMPOSE_PROJECT_NAME', 'other-project'],
      ['BASH_ENV', '/tmp/attacker'],
    ]) {
      const root = temporaryRoot();
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const { destination } = sandboxedScript(deployPath, root);
      writeFileSync(
        destination,
        readFileSync(destination, 'utf8').replaceAll(
          'id -un',
          'printf root',
        ),
        { mode: 0o755 },
      );
      executable(
        join(bin, 'id'),
        '#!/usr/bin/env bash\n[[ "$1" == "-un" ]] && echo root\n',
      );
      const result = run(destination, {
        ...process.env,
        PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
        OPENSTAYS_DSM_ROOT_TASK: '1',
        OPENSTAYS_DSM_SOURCE_COMMIT: 'a'.repeat(40),
        [name]: value,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('DSM_ROOT_TASK_ENVIRONMENT_INVALID');
    }
  });

  it('deploy rejects direct root invocation even when a commit-shaped value is supplied', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(deployPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf root')
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100'),
      { mode: 0o755 },
    );

    const result = run(destination, {
      ...process.env,
      PATH: `${gitBashPath(bin)}:/usr/bin:/bin`,
      OPENSTAYS_DSM_ROOT_TASK: '1',
      OPENSTAYS_DSM_SOURCE_COMMIT: 'main; touch /tmp/not-allowed',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ROOT_LAUNCHER_HANDOFF_REQUIRED');
  });

  it('recovery rejects root unless the explicit DSM task flag is present', () => {
    const root = temporaryRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const { destination } = sandboxedScript(recoveryPath, root);
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replaceAll(
        'id -un',
        'printf root',
      ),
      { mode: 0o755 },
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
    expect(result.stderr).toContain('DSM_ROOT_TASK_FLAG_REQUIRED');
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
      )
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100'),
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
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100'),
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
        'OPENSTAYS_UID=1026',
        'OPENSTAYS_GID=100',
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
  -u) echo 1026 ;;
  -g) echo 100 ;;
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
  printf '%s\\n' 'openstays-merchant' 'merchant' '1026:100' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
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
  inspect*) printf '%s\\n' 'openstays-merchant' 'merchant' '1026:100' '2' 'wrong-state>/var/lib/openstays>bind>true' 'wrong-backup>/var/backups/openstays>bind>true' '1' ;;
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

  it('rejects a merchant container that runs as root despite correct labels and mounts', () => {
    const root = temporaryRoot();
    const calls = join(root, 'calls');
    const placeholderApp = gitBashPath(
      join(root, 'volume1', 'docker', 'openstays-merchant'),
    );
    const placeholderBackup = gitBashPath(
      join(root, 'volume2', 'openstays-wallet-backups'),
    );
    const prepared = prepareDeploySandbox(
      root,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${calls.replaceAll('\\', '/')}"
case "$*" in
  "container inspect"*) exit 1 ;;
  inspect*) printf '%s\\n' 'openstays-merchant' 'merchant' '0:0' '2' '${placeholderApp}/state>/var/lib/openstays>bind>true' '${placeholderBackup}>/var/backups/openstays>bind>true' '0' ;;
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
    expect(recorded).toMatch(/\bstop merchant\b/u);
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
    printf '%s\\n' 'openstays-merchant' 'merchant' '1026:100' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
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
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100')
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
    expect(readdirSync(`${appRoot}/quarantine`)).toHaveLength(1);
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
    printf '%s\\n' 'wrong-project' 'merchant' '1026:100' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
`,
    );
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8')
        .replaceAll('id -un', 'printf murdawk')
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100')
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
    printf '%s\\n' 'openstays-merchant' 'merchant' '1026:100' '2' '${gitBashPath(appRoot)}/state>/var/lib/openstays>bind>true' '${gitBashPath(backupRoot)}>/var/backups/openstays>bind>true' '0'
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
        .replaceAll('id -u murdawk', 'printf 1026')
        .replaceAll('id -g murdawk', 'printf 100')
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
