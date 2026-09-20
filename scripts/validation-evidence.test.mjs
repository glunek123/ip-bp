import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  findReusableEvidence,
  recordEvidence,
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

const request = {
  level: 'L2',
  scope: 'customer',
  checks: [
    'test:unit:customer',
    'check:fast',
    'format:check:slice:customer',
    'test:e2e:customer',
  ],
  nodeVersion: 'v24.21.0',
  pnpmVersion: '11.27.0',
};

test('records and reuses evidence only for the exact clean tree and check set', (t) => {
  const root = repository(t);
  const result = recordEvidence(root, request);
  const saved = JSON.parse(readFileSync(result.path, 'utf8'));

  assert.equal(saved.tree, git(root, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(saved.records[0].commit, git(root, 'rev-parse', 'HEAD'));
  assert.deepEqual(saved.records[0].checks, request.checks);
  assert.equal(findReusableEvidence(root, request)?.tree, saved.tree);
  assert.equal(
    findReusableEvidence(root, { ...request, checks: ['check:fast'] }),
    undefined,
  );
  assert.equal(
    findReusableEvidence(root, { ...request, pnpmVersion: '0.0.0' }),
    undefined,
  );

  git(root, 'commit', '--allow-empty', '-qm', 'same tree, new commit');
  assert.equal(findReusableEvidence(root, request)?.tree, saved.tree);
});

test('keeps independent validation records for the same tree', (t) => {
  const root = repository(t);
  const customer = recordEvidence(root, request);
  const holderRequest = {
    ...request,
    scope: 'right-holder',
    checks: ['test:unit:right-holder', 'test:e2e:right-holder'],
  };
  recordEvidence(root, holderRequest);

  assert.equal(findReusableEvidence(root, request)?.tree, customer.tree);
  assert.equal(
    findReusableEvidence(root, holderRequest)?.scope,
    'right-holder',
  );
});

test('rejects tracked, staged, and untracked candidate changes', (t) => {
  const tracked = repository(t);
  writeFileSync(join(tracked, 'source.txt'), 'dirty\n');
  assert.throws(() => recordEvidence(tracked, request), /clean|dirty/i);

  const staged = repository(t);
  writeFileSync(join(staged, 'source.txt'), 'staged\n');
  git(staged, 'add', 'source.txt');
  assert.throws(() => recordEvidence(staged, request), /clean|dirty/i);

  const untracked = repository(t);
  writeFileSync(join(untracked, 'extra.txt'), 'untracked\n');
  assert.throws(() => recordEvidence(untracked, request), /clean|dirty/i);
});

test('rejects invalid levels, scopes, and empty or duplicate checks', (t) => {
  const root = repository(t);
  assert.throws(
    () => recordEvidence(root, { ...request, level: 'L4' }),
    /level/i,
  );
  assert.throws(
    () => recordEvidence(root, { ...request, scope: '../escape' }),
    /scope/i,
  );
  assert.throws(
    () => recordEvidence(root, { ...request, checks: [] }),
    /check/i,
  );
  assert.throws(
    () =>
      recordEvidence(root, {
        ...request,
        checks: ['check:fast', 'check:fast'],
      }),
    /duplicate/i,
  );
});
