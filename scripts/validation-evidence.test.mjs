import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  captureValidationCandidate,
  findReusableValidationScopeEvidence,
  recordValidationScopeEvidence,
} from './validation-evidence.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-evidence-'));
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
  nodeVersion: 'v24.21.0',
  pnpmVersion: '11.27.0',
};

function record(root, scope = 'customer') {
  const captured = captureValidationCandidate(root);
  return recordValidationScopeEvidence(root, scope, environment, captured.tree);
}

test('records and reuses evidence only for the exact clean tree and check set', (t) => {
  const root = repository(t);
  const result = record(root);
  const saved = JSON.parse(readFileSync(result.path, 'utf8'));

  assert.equal(saved.tree, git(root, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(saved.records[0].commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment)?.tree,
    saved.tree,
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'right-holder', environment),
    undefined,
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', {
      ...environment,
      pnpmVersion: '0.0.0',
    }),
    undefined,
  );

  git(root, 'commit', '--allow-empty', '-qm', 'same tree, new commit');
  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment)?.tree,
    saved.tree,
  );
});

test('keeps independent validation records for the same tree', (t) => {
  const root = repository(t);
  const customer = record(root);
  record(root, 'right-holder');

  assert.equal(
    findReusableValidationScopeEvidence(root, 'customer', environment)?.tree,
    customer.tree,
  );
  assert.equal(
    findReusableValidationScopeEvidence(root, 'right-holder', environment)
      ?.scope,
    'right-holder',
  );
});

test('reuses evidence from another worktree of the same repository', (t) => {
  const root = repository(t);
  const linked = mkdtempSync(join(tmpdir(), 'dev-cor-evidence-linked-'));
  rmSync(linked, { recursive: true, force: true });
  git(root, 'worktree', 'add', '--detach', linked, 'HEAD');

  try {
    const recorded = record(root);
    assert.equal(
      findReusableValidationScopeEvidence(linked, 'customer', environment)
        ?.tree,
      recorded.tree,
    );
  } finally {
    git(root, 'worktree', 'remove', '--force', linked);
  }
});

test('rejects tracked, staged, and untracked candidate changes', (t) => {
  const tracked = repository(t);
  writeFileSync(join(tracked, 'source.txt'), 'dirty\n');
  assert.throws(() => record(tracked), /clean|dirty/i);

  const staged = repository(t);
  writeFileSync(join(staged, 'source.txt'), 'staged\n');
  git(staged, 'add', 'source.txt');
  assert.throws(() => record(staged), /clean|dirty/i);

  const untracked = repository(t);
  writeFileSync(join(untracked, 'extra.txt'), 'untracked\n');
  assert.throws(() => record(untracked), /clean|dirty/i);
});

test('derives checks from known scopes and rejects caller-defined scope names', (t) => {
  const root = repository(t);
  assert.throws(() => record(root, '../escape'), /scope/i);
});
