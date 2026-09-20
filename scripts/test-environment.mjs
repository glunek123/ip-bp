import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const applicationKeys = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'AUTH_THROTTLE_SECRET',
  'TRUST_PROXY_HOPS',
  'API_PROXY_TARGET',
  'E2E_IDENTITY_FIXTURES',
];

const inheritedControlKeys = [
  'CI',
  'TZ',
  'NODE_OPTIONS',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PWDEBUG',
];

const identityFixtures = JSON.stringify({
  'e2e-department-a': {
    userId: '20000000-0000-4000-8000-000000000001',
    departmentId: '10000000-0000-4000-8000-000000000001',
    authorizationRevision: 1,
  },
  'e2e-department-b': {
    userId: '20000000-0000-4000-8000-000000000002',
    departmentId: '10000000-0000-4000-8000-000000000002',
    authorizationRevision: 1,
  },
  'e2e-department-a-self': {
    userId: '20000000-0000-4000-8000-000000000003',
    departmentId: '10000000-0000-4000-8000-000000000001',
    authorizationRevision: 1,
  },
});

function gitCommonDirectory(root) {
  const value = execFileSync(
    'git',
    ['-C', root, 'rev-parse', '--git-common-dir'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  return resolve(root, value);
}

function fingerprintKey(root) {
  const directory = join(
    gitCommonDirectory(root),
    'dev-cor-validation-evidence',
  );
  const path = join(directory, 'fingerprint.key');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(path)) {
    try {
      writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const key = readFileSync(path);
  if (key.length !== 32)
    throw new Error(
      'Validation fingerprint key is invalid; do not reuse existing evidence',
    );
  return key;
}

function readTestEnvironmentFile(root) {
  const path = resolve(root, 'backend/.env.test');
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error('backend/.env.test is required and must be readable');
  }
  let values;
  try {
    values = parseEnv(bytes.toString('utf8'));
  } catch {
    throw new Error('backend/.env.test could not be parsed');
  }
  return { bytes, values };
}

function validatedApplicationEnvironment(values) {
  if (values.NODE_ENV !== 'test')
    throw new Error('backend/.env.test must set NODE_ENV=test');
  if (values.PORT !== '3101')
    throw new Error('backend/.env.test must set the isolated E2E port');
  if (!/^[a-f0-9]{64,}$/i.test(values.AUTH_THROTTLE_SECRET ?? ''))
    throw new Error(
      'backend/.env.test must contain a valid AUTH_THROTTLE_SECRET',
    );
  let database;
  try {
    database = new URL(values.DATABASE_URL);
  } catch {
    throw new Error(
      'backend/.env.test must contain the isolated E2E database URL',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '55433' ||
    database.pathname !== '/dev_cor_test'
  ) {
    throw new Error(
      'backend/.env.test must target the isolated local test database',
    );
  }
  const trustProxyHops = values.TRUST_PROXY_HOPS ?? '0';
  if (!/^\d+$/.test(trustProxyHops) || Number(trustProxyHops) > 10)
    throw new Error('backend/.env.test contains an invalid TRUST_PROXY_HOPS');
  return {
    NODE_ENV: 'test',
    PORT: '3101',
    DATABASE_URL: values.DATABASE_URL,
    AUTH_THROTTLE_SECRET: values.AUTH_THROTTLE_SECRET,
    TRUST_PROXY_HOPS: trustProxyHops,
    API_PROXY_TARGET: 'http://127.0.0.1:3101',
    E2E_IDENTITY_FIXTURES: identityFixtures,
  };
}

function relevantControls(inheritedEnvironment) {
  return Object.fromEntries(
    inheritedControlKeys.map((key) => [
      key,
      inheritedEnvironment[key] === undefined
        ? null
        : String(inheritedEnvironment[key]),
    ]),
  );
}

function rejectConflicts(inheritedEnvironment, effectiveEnvironment) {
  for (const key of applicationKeys) {
    const inherited = inheritedEnvironment[key];
    if (
      inherited !== undefined &&
      String(inherited) !== effectiveEnvironment[key]
    ) {
      throw new Error(`${key} conflicts with the fixed E2E environment`);
    }
  }
}

export function captureTestEnvironment(root, options = {}) {
  const inheritedEnvironment = options.inheritedEnvironment ?? process.env;
  const { bytes, values } = readTestEnvironmentFile(root);
  const effectiveEnvironment = validatedApplicationEnvironment(values);
  rejectConflicts(inheritedEnvironment, effectiveEnvironment);
  const metadata = {
    node: options.nodeVersion ?? process.version,
    pnpm: options.pnpmVersion,
    platform: options.platform ?? process.platform,
    architecture: options.architecture ?? process.arch,
  };
  if (typeof metadata.pnpm !== 'string' || metadata.pnpm.length === 0)
    throw new Error('The pnpm version is required for validation evidence');
  const controls = relevantControls(inheritedEnvironment);
  const hmac = createHmac('sha256', fingerprintKey(root));
  hmac.update(bytes);
  hmac.update('\0');
  hmac.update(
    JSON.stringify({
      protocol: 1,
      effectiveEnvironment,
      controls,
      metadata,
    }),
  );
  return {
    fingerprint: hmac.digest('hex'),
    metadata,
    childEnvironment: {
      ...inheritedEnvironment,
      ...effectiveEnvironment,
    },
  };
}
