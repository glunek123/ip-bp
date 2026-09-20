import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTestEnvironment } from './test-environment.mjs';

const secret = 'a'.repeat(64);
const databaseUrl =
  'postgresql://dev_cor_test:local-test-password@127.0.0.1:55433/dev_cor_test';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-test-environment-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test Environment');
  git(root, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'backend'));
  writeFileSync(join(root, '.gitignore'), 'backend/.env.test\n');
  writeFileSync(join(root, 'tracked.txt'), 'candidate\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  writeTestEnvironment(root);
  return root;
}

function writeTestEnvironment(root, suffix = '') {
  writeFileSync(
    join(root, 'backend', '.env.test'),
    [
      'NODE_ENV=test',
      'PORT=3101',
      `DATABASE_URL=${databaseUrl}`,
      `AUTH_THROTTLE_SECRET=${secret}`,
      suffix,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

function capture(root, inheritedEnvironment = {}) {
  return captureTestEnvironment(root, {
    inheritedEnvironment,
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
    externalConditions: {
      databaseImage: 'sha256:database-image',
      browserManifest: 'sha256:browser-manifest',
    },
  });
}

test('builds one validated effective environment without exposing secrets', (t) => {
  const root = repository(t);
  const result = capture(root, { TZ: 'Asia/Shanghai' });

  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.metadata, {
    node: 'v24.21.0',
    pnpm: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
  });
  assert.equal(result.childEnvironment.NODE_ENV, 'test');
  assert.equal(result.childEnvironment.PORT, '3101');
  assert.equal(result.childEnvironment.DATABASE_URL, databaseUrl);
  assert.equal(result.childEnvironment.AUTH_THROTTLE_SECRET, secret);
  assert.equal(result.childEnvironment.TRUST_PROXY_HOPS, '0');
  assert.equal(
    result.childEnvironment.API_PROXY_TARGET,
    'http://127.0.0.1:3101',
  );
  assert.equal(result.childEnvironment.TZ, 'Asia/Shanghai');

  const serializable = JSON.stringify({
    fingerprint: result.fingerprint,
    metadata: result.metadata,
  });
  assert.doesNotMatch(serializable, /local-test-password/);
  assert.doesNotMatch(serializable, new RegExp(secret));
});

test('rejects inherited application overrides before execution', (t) => {
  const root = repository(t);
  const conflictingUrl =
    'postgresql://other:other@127.0.0.1:55433/dev_cor_test';

  assert.throws(
    () => capture(root, { DATABASE_URL: conflictingUrl }),
    /DATABASE_URL.*conflict/i,
  );
  try {
    capture(root, { DATABASE_URL: conflictingUrl });
    assert.fail('expected an environment conflict');
  } catch (error) {
    assert.doesNotMatch(String(error), /local-test-password|other:other/);
  }
});

test('fails for missing or invalid files and changes the fingerprint when inputs change', (t) => {
  const root = repository(t);
  const first = capture(root);
  writeTestEnvironment(root, '# changed input');
  const second = capture(root);
  assert.notEqual(second.fingerprint, first.fingerprint);

  rmSync(join(root, 'backend', '.env.test'));
  assert.throws(() => capture(root), /backend\/\.env\.test.*required/i);

  mkdirSync(join(root, 'backend', '.env.test'));
  assert.throws(() => capture(root), /backend\/\.env\.test.*read/i);
});

test('shares the HMAC key across worktrees without binding absolute paths', (t) => {
  const root = repository(t);
  const linked = mkdtempSync(
    join(tmpdir(), 'dev-cor-test-environment-linked-'),
  );
  rmSync(linked, { recursive: true, force: true });
  git(root, 'worktree', 'add', '--detach', linked, 'HEAD');

  try {
    mkdirSync(join(linked, 'backend'), { recursive: true });
    writeTestEnvironment(linked);
    const source = capture(root, { PLAYWRIGHT_BROWSERS_PATH: 'shared' });
    const reused = capture(linked, { PLAYWRIGHT_BROWSERS_PATH: 'shared' });
    assert.equal(reused.fingerprint, source.fingerprint);

    const changedControl = capture(linked, {
      PLAYWRIGHT_BROWSERS_PATH: 'different',
    });
    assert.notEqual(changedControl.fingerprint, source.fingerprint);

    const commonDirectory = git(root, 'rev-parse', '--git-common-dir');
    const key = readFileSync(
      join(
        root,
        commonDirectory,
        'dev-cor-validation-evidence',
        'fingerprint.key',
      ),
    );
    assert.equal(key.length, 32);
  } finally {
    git(root, 'worktree', 'remove', '--force', linked);
  }
});

test('binds actual external test conditions without serializing them', (t) => {
  const root = repository(t);
  const first = capture(root);
  const changed = captureTestEnvironment(root, {
    inheritedEnvironment: {},
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
    externalConditions: {
      databaseImage: 'sha256:different-database-image',
      browserManifest: 'sha256:browser-manifest',
    },
  });

  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.doesNotMatch(
    JSON.stringify({
      fingerprint: first.fingerprint,
      metadata: first.metadata,
    }),
    /database-image|browser-manifest/,
  );
});
