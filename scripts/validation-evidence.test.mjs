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
import {
  beginValidationScopeAttempt,
  captureValidationCandidate,
  completeValidationScopeAttempt,
  failValidationScopeAttempt,
  findReusableValidationScopeEvidence,
} from './validation-evidence.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-evidence-v2-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Evidence Test');
  git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, '.gitignore'), '.local/\n');
  writeFileSync(join(root, 'source.txt'), 'ready\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return root;
}

const environment = {
  fingerprint: 'a'.repeat(64),
  metadata: {
    node: 'v24.21.0',
    pnpm: '11.27.0',
    platform: 'win32',
    architecture: 'x64',
  },
  childEnvironment: { SECRET: 'never-persist-this' },
};

function begin(root, scope = 'customer', selectedEnvironment = environment) {
  return beginValidationScopeAttempt(
    root,
    scope,
    selectedEnvironment,
    captureValidationCandidate(root),
  );
}

function succeed(root, scope = 'customer', selectedEnvironment = environment) {
  const attempt = begin(root, scope, selectedEnvironment);
  completeValidationScopeAttempt(root, attempt);
  attempt.release();
  return attempt;
}

test('only the latest attempt for an exact validation key is reusable', (t) => {
  const root = repository(t);
  const first = succeed(root);
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment)?.tree,
    first.tree,
  );

  const second = begin(root);
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
  failValidationScopeAttempt(root, second, 'failed');
  second.release();
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
});

test('running and aborted attempts are never reusable', (t) => {
  const root = repository(t);
  const running = begin(root);
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
  failValidationScopeAttempt(root, running, 'aborted');
  running.release();
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
});

test('keeps independent scopes and environments without exposing secrets', (t) => {
  const root = repository(t);
  const customer = succeed(root, 'customer');
  const rightHolder = succeed(root, 'right-holder');
  const changedEnvironment = {
    ...environment,
    fingerprint: 'b'.repeat(64),
  };
  succeed(root, 'customer', changedEnvironment);

  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment)?.key,
    customer.key,
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'right-holder', environment)?.key,
    rightHolder.key,
  );
  assert.ok(
    findReusableValidationScopeEvidence(root, 'customer', changedEnvironment),
  );
  const saved = readFileSync(customer.path, 'utf8');
  assert.doesNotMatch(saved, /never-persist-this/);
  assert.doesNotMatch(saved, /SECRET/);
});

test('reuses success across worktrees only for the same tree and environment', (t) => {
  const root = repository(t);
  const linked = mkdtempSync(join(tmpdir(), 'dev-cor-evidence-v2-linked-'));
  rmSync(linked, { recursive: true, force: true });
  git(root, 'worktree', 'add', '--detach', linked, 'HEAD');

  try {
    const recorded = succeed(root);
    assert.equal(
      findReusableValidationScopeEvidence(linked, 'customer', environment)?.key,
      recorded.key,
    );
    assert.equal(
      findReusableValidationScopeEvidence(linked, 'customer', {
        ...environment,
        fingerprint: 'c'.repeat(64),
      }),
      undefined,
    );
  } finally {
    git(root, 'worktree', 'remove', '--force', linked);
  }
}, 15_000);

test('rejects v1, corrupt, incomplete, dirty, and wrong-check evidence', (t) => {
  const root = repository(t);
  const successful = succeed(root);
  const original = readFileSync(successful.path, 'utf8');

  writeFileSync(
    successful.path,
    JSON.stringify({ version: 1, tree: successful.tree, records: [] }),
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );

  writeFileSync(successful.path, '{broken');
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );

  const incomplete = JSON.parse(original);
  delete incomplete.records[0].status;
  writeFileSync(successful.path, JSON.stringify(incomplete));
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );

  const wrongChecks = JSON.parse(original);
  wrongChecks.records[0].checks = ['check:fast'];
  writeFileSync(successful.path, JSON.stringify(wrongChecks));
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );

  const invalidCommit = JSON.parse(original);
  invalidCommit.records[0].commit = 42;
  writeFileSync(successful.path, JSON.stringify(invalidCommit));
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );

  writeFileSync(successful.path, original);
  writeFileSync(join(root, 'source.txt'), 'dirty\n');
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
});

test('a focused auth result cannot satisfy another Level 3 or scope request', (t) => {
  const root = repository(t);
  succeed(root, 'auth-focused');
  assert.ok(
    findReusableValidationScopeEvidence(root, 'auth-focused', environment),
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
  assert.throws(
    () =>
      findReusableValidationScopeEvidence(root, 'level-3-full', environment),
    /Unknown validation scope/,
  );
});

test('a failed atomic publication never turns running into success', (t) => {
  const root = repository(t);
  const attempt = begin(root);
  rmSync(attempt.path);
  mkdirSync(attempt.path);

  assert.throws(
    () => completeValidationScopeAttempt(root, attempt),
    /current attempt|rename|directory|exist|permission|access/i,
  );
  attempt.release();
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment),
    undefined,
  );
});
