import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findReusableValidationScopeEvidence } from './validation-evidence.mjs';
import { validationScopes } from './validation-scopes.mjs';
import { runValidationScope } from './run-validation-scope.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-scope-runner-'));
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

test('scope owns the exact commands and canonical evidence identifiers', async () => {
  const executed = [];
  let recorded;

  await runValidationScope('C:/repo', 'right-holder', {
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
    capture: () => ({ tree: 'start-tree' }),
    execute: async (command) => executed.push(command),
    record: (_root, scopeName, environment, expectedTree) => {
      recorded = { scopeName, environment, expectedTree };
      return { tree: 'tree' };
    },
  });

  assert.deepEqual(executed, validationScopes['right-holder'].commands);
  assert.deepEqual(recorded, {
    scopeName: 'right-holder',
    environment: {
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
    },
    expectedTree: 'start-tree',
  });
  const ids = validationScopes['right-holder'].commands.map(({ id }) => id);
  assert.ok(ids.includes('build:backend:prepared'));
  assert.ok(!ids.includes('build:prepared'));
});

test('failed command stops the scope and never records evidence', async () => {
  const executed = [];
  let recordCalls = 0;

  await assert.rejects(
    runValidationScope('C:/repo', 'customer', {
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
      capture: () => ({ tree: 'start-tree' }),
      execute: async (command) => {
        executed.push(command.id);
        if (command.id === 'check:fast') throw new Error('failed');
      },
      record: () => {
        recordCalls += 1;
      },
    }),
    /failed/,
  );

  assert.deepEqual(executed, ['test:unit:customer', 'check:fast']);
  assert.equal(recordCalls, 0);
});

test('unknown validation scope is rejected', async () => {
  await assert.rejects(
    runValidationScope('C:/repo', 'made-up', {
      execute: async () => {},
      record: () => {},
      capture: () => ({ tree: 'start-tree' }),
      nodeVersion: 'v24.21.0',
      pnpmVersion: '11.27.0',
    }),
    /Unknown validation scope/,
  );
});

test('changing HEAD to a different tree during checks records no evidence', async (t) => {
  const root = repository(t);
  const environment = {
    nodeVersion: 'v24.21.0',
    pnpmVersion: '11.27.0',
  };
  let changed = false;

  await assert.rejects(
    runValidationScope(root, 'customer', {
      ...environment,
      execute: async () => {
        if (changed) return;
        changed = true;
        writeFileSync(join(root, 'source.txt'), 'tree-b\n');
        git(root, 'add', 'source.txt');
        git(root, 'commit', '-qm', 'tree b');
      },
    }),
    /candidate|tree|changed/i,
  );

  assert.equal(readFileSync(join(root, 'source.txt'), 'utf8'), 'tree-b\n');
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
});
