import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validationScopes } from './validation-scopes.mjs';
import { runValidationScope } from './run-validation-scope.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-scope-runner-v2-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Scope Runner Test');
  git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'source.txt'), 'tree-a\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'tree a');
  return root;
}

const candidate = { commit: 'commit-a', tree: 'tree-a' };
const environment = {
  fingerprint: 'a'.repeat(64),
  metadata: {
    node: 'v24.21.0',
    pnpm: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
  },
  childEnvironment: { NODE_ENV: 'test', DATABASE_URL: 'secret-url' },
};

function successfulDependencies(overrides = {}) {
  const calls = { begun: 0, succeeded: 0, failed: [], released: 0 };
  const attempt = {
    tree: candidate.tree,
    release: () => {
      calls.released += 1;
    },
  };
  return {
    calls,
    dependencies: {
      pnpmVersion: '11.27.0',
      captureCandidate: () => candidate,
      assertCandidate: () => candidate,
      captureEnvironment: () => environment,
      begin: () => {
        calls.begun += 1;
        return attempt;
      },
      succeed: () => {
        calls.succeeded += 1;
        return { tree: candidate.tree, status: 'success' };
      },
      fail: (_root, _attempt, status) => calls.failed.push(status),
      ...overrides,
    },
  };
}

test('scope owns ordered commands and passes the fixed environment only to E2E', async () => {
  const executed = [];
  const { calls, dependencies } = successfulDependencies({
    execute: async (command, childEnvironment) =>
      executed.push({ id: command.id, childEnvironment }),
  });

  const result = await runValidationScope(
    'C:/repo',
    'right-holder',
    dependencies,
  );
  assert.equal(result.status, 'success');
  assert.deepEqual(
    executed.map(({ id }) => id),
    [
      'prepare:prisma',
      'test:unit:right-holder',
      'check:fast:prepared',
      'format:check:slice:right-holder',
      'build:backend:prepared',
      'test:e2e:right-holder',
    ],
  );
  assert.equal(executed.filter(({ id }) => id === 'prepare:prisma').length, 1);
  for (const item of executed.slice(0, -1))
    assert.equal(item.childEnvironment, undefined);
  assert.equal(executed.at(-1).childEnvironment, environment.childEnvironment);
  assert.deepEqual(calls, {
    begun: 1,
    succeeded: 1,
    failed: [],
    released: 1,
  });
});

test('a running-state persistence failure starts no command', async () => {
  let executeCalls = 0;
  const { dependencies } = successfulDependencies({
    begin: () => {
      throw new Error('cannot persist running');
    },
    execute: async () => {
      executeCalls += 1;
    },
  });
  await assert.rejects(
    runValidationScope('C:/repo', 'customer', dependencies),
    /cannot persist running/,
  );
  assert.equal(executeCalls, 0);
});

test('a failed command stops the scope and invalidates the current attempt', async () => {
  const executed = [];
  const { calls, dependencies } = successfulDependencies({
    execute: async (command) => {
      executed.push(command.id);
      if (command.id === 'test:unit:customer') throw new Error('failed');
    },
  });

  await assert.rejects(
    runValidationScope('C:/repo', 'customer', dependencies),
    /failed/,
  );
  assert.deepEqual(executed, ['prepare:prisma', 'test:unit:customer']);
  assert.equal(calls.succeeded, 0);
  assert.deepEqual(calls.failed, ['failed']);
  assert.equal(calls.released, 1);
});

test('checks the candidate and environment before and after every command', async () => {
  let candidateChecks = 0;
  let environmentCaptures = 0;
  const { calls, dependencies } = successfulDependencies({
    assertCandidate: () => {
      candidateChecks += 1;
      if (candidateChecks === 2) throw new Error('candidate changed');
      return candidate;
    },
    captureEnvironment: () => {
      environmentCaptures += 1;
      return environment;
    },
    execute: async () => {},
  });

  await assert.rejects(
    runValidationScope('C:/repo', 'customer', dependencies),
    /candidate changed/,
  );
  assert.equal(candidateChecks, 2);
  assert.ok(environmentCaptures >= 2);
  assert.deepEqual(calls.failed, ['aborted']);
});

test('stops when the effective environment changes between boundaries', async () => {
  let captures = 0;
  const { calls, dependencies } = successfulDependencies({
    captureEnvironment: () => {
      captures += 1;
      return captures < 3
        ? environment
        : { ...environment, fingerprint: 'b'.repeat(64) };
    },
    execute: async () => {},
  });
  await assert.rejects(
    runValidationScope('C:/repo', 'customer', dependencies),
    /environment changed/i,
  );
  assert.deepEqual(calls.failed, ['aborted']);
});

test('fixes both HEAD and tree for the duration of an attempt', async (t) => {
  const root = repository(t);
  let failedStatus;
  const handle = { release: () => {} };
  await assert.rejects(
    runValidationScope(root, 'customer', {
      pnpmVersion: '11.27.0',
      captureEnvironment: () => environment,
      begin: () => handle,
      succeed: () => assert.fail('must not succeed'),
      fail: (_root, _attempt, status) => {
        failedStatus = status;
      },
      execute: async () => {
        git(root, 'commit', '--allow-empty', '-qm', 'changed head');
      },
    }),
    /candidate changed/i,
  );
  assert.equal(failedStatus, 'aborted');
});

test('stops after a command leaves the candidate dirty', async (t) => {
  const root = repository(t);
  let failedStatus;
  await assert.rejects(
    runValidationScope(root, 'customer', {
      pnpmVersion: '11.27.0',
      captureEnvironment: () => environment,
      begin: () => ({ release: () => {} }),
      succeed: () => assert.fail('must not succeed'),
      fail: (_root, _attempt, status) => {
        failedStatus = status;
      },
      execute: async () => {
        writeFileSync(join(root, 'source.txt'), 'dirty\n');
      },
    }),
    /clean fixed candidate/i,
  );
  assert.equal(failedStatus, 'aborted');
});

test('unknown validation scope is rejected before an attempt starts', async () => {
  const { dependencies } = successfulDependencies({ execute: async () => {} });
  await assert.rejects(
    runValidationScope('C:/repo', 'made-up', dependencies),
    /Unknown validation scope/,
  );
});

test('all configured scopes prepare once and preserve full prepared checks', () => {
  for (const configured of Object.values(validationScopes)) {
    const ids = configured.commands.map(({ id }) => id);
    assert.equal(ids[0], 'prepare:prisma');
    assert.equal(ids.filter((id) => id === 'prepare:prisma').length, 1);
    assert.ok(ids.includes('check:fast:prepared'));
    assert.ok(ids.includes('build:backend:prepared'));
    assert.equal(configured.commands.at(-1).testEnvironment, true);
  }
});
