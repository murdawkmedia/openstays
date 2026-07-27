import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_CONTROL_PORT = 8_080;
const routes = Object.freeze({
  health: ['GET', '/health'],
  bootstrap: ['POST', '/bootstrap'],
  backup: ['POST', '/backup'],
});

function controlPort(value) {
  if (value === undefined || value === '') return DEFAULT_CONTROL_PORT;
  if (!/^[0-9]+$/u.test(value)) throw new Error('CONTROL_PORT_INVALID');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CONTROL_PORT_INVALID');
  }
  return port;
}

function successfulStatus(response) {
  return response.status >= 200 && response.status < 300;
}

async function jsonResponse(response) {
  const result = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('OPERATOR_RESPONSE_INVALID');
  }
  return result;
}

function bootstrapResult(result) {
  if (
    !Array.isArray(result.mnemonic)
    || result.mnemonic.length !== 24
    || result.mnemonic.some((word) => (
      typeof word !== 'string' || word.length === 0
    ))
  ) {
    throw new Error('OPERATOR_RESPONSE_INVALID');
  }
  return { mnemonic: [...result.mnemonic] };
}

/**
 * Run one authenticated, loopback-only operator command.
 *
 * The response body is never written before its HTTP status and shape have
 * been validated. In particular, bootstrap recovery words are emitted only
 * for a successful bootstrap response.
 */
export async function runOperator(
  arguments_,
  {
    env = process.env,
    fetchImpl = fetch,
    write = (value) => process.stdout.write(value),
  } = {},
) {
  if (
    !Array.isArray(arguments_)
    || arguments_.length !== 1
    || !Object.hasOwn(routes, arguments_[0])
  ) {
    throw new Error('OPERATOR_COMMAND_INVALID');
  }
  const command = arguments_[0];
  const token = env.CONTAINER_CONTROL_TOKEN;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('CONTAINER_CONTROL_TOKEN_REQUIRED');
  }
  const [method, path] = routes[command];
  const response = await fetchImpl(
    `http://${LOOPBACK_HOST}:${controlPort(env.CONTROL_PORT)}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: command === 'backup'
          ? 'application/octet-stream'
          : 'application/json',
      },
    },
  );
  if (!successfulStatus(response)) {
    throw new Error('OPERATOR_REQUEST_FAILED');
  }

  if (command === 'backup') {
    const sha256 = response.headers.get('x-backup-sha256');
    const byteLength = Number(response.headers.get('content-length'));
    if (
      !/^[a-f0-9]{64}$/u.test(sha256 ?? '')
      || !Number.isSafeInteger(byteLength)
      || byteLength < 1
    ) {
      throw new Error('OPERATOR_RESPONSE_INVALID');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.byteLength !== byteLength
      || createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      throw new Error('OPERATOR_RESPONSE_INVALID');
    }
    const result = { status: 'backed_up', sha256, byteLength };
    write(`${JSON.stringify(result)}\n`);
    return result;
  }

  const result = await jsonResponse(response);
  const output = command === 'bootstrap'
    ? bootstrapResult(result)
    : result;
  if (
    command === 'health'
    && output.status !== 'ready'
    && output.status !== 'awaiting_bootstrap'
  ) {
    throw new Error('OPERATOR_HEALTH_FAILED');
  }
  write(`${JSON.stringify(output)}\n`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runOperator(process.argv.slice(2)).catch((error) => {
    const category = error instanceof Error
      && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'OPERATOR_FAILED';
    process.stderr.write(`${category}\n`);
    process.exitCode = 1;
  });
}
