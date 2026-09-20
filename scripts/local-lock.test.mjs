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
import { acquireLocalLock } from './local-lock.mjs';

function lockRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-lock-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('rejects a concurrent owner and releases only its own lock', (t) => {
  const root = lockRoot(t);
  const first = acquireLocalLock(root, 'shared-e2e', { ownerPid: 101 });

  assert.throws(
    () => acquireLocalLock(root, 'shared-e2e', { ownerPid: 202 }),
    /shared-e2e.*already locked/i,
  );
  const owner = JSON.parse(
    readFileSync(join(first.path, 'owner.json'), 'utf8'),
  );
  assert.equal(owner.pid, 101);
  assert.doesNotMatch(JSON.stringify(owner), /password|secret/i);

  first.release();
  const second = acquireLocalLock(root, 'shared-e2e', { ownerPid: 202 });
  first.release();
  assert.equal(
    JSON.parse(readFileSync(join(second.path, 'owner.json'), 'utf8')).pid,
    202,
  );
  second.release();
});

test('never reclaims a stale lock from time alone', (t) => {
  const root = lockRoot(t);
  const stale = join(root, 'validation-attempt.lock');
  mkdirSync(stale);
  writeFileSync(
    join(stale, 'owner.json'),
    JSON.stringify({ pid: 999999, token: 'unknown', startedAt: '2000-01-01' }),
  );

  assert.throws(
    () => acquireLocalLock(root, 'validation-attempt', { ownerPid: 303 }),
    /already locked.*confirm.*process/i,
  );
});
