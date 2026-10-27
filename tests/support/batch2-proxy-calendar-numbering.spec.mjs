import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { assertPlainNumberingReceiptPath } from './batch2-proxy-calendar-numbering.mjs';

function withTemporaryCandidate(check) {
  const parent = resolve(tmpdir());
  const candidate = mkdtempSync(join(parent, 'batch2-numbering-'));
  try {
    check(candidate);
  } finally {
    assert.ok(resolve(candidate).startsWith(`${parent}${sep}`));
    rmSync(candidate, { recursive: true, force: true });
  }
}

test('numbering receipt remains inside a plain candidate .local directory', () => {
  withTemporaryCandidate((candidate) => {
    const path = assertPlainNumberingReceiptPath(candidate);
    assert.equal(
      path,
      resolve(candidate, '.local/batch2-calendar/numbering-receipt.json'),
    );
    mkdirSync(resolve(candidate, '.local/batch2-calendar'), {
      recursive: true,
    });
    assert.equal(assertPlainNumberingReceiptPath(candidate), path);
    writeFileSync(path, 'existing receipt', { flag: 'wx' });
    assert.throws(
      () => assertPlainNumberingReceiptPath(candidate),
      /already exists/u,
    );
  });
});

test('numbering receipt rejects a linked .local parent before any write', () => {
  withTemporaryCandidate((candidate) => {
    const destination = resolve(candidate, 'elsewhere');
    mkdirSync(destination);
    symlinkSync(
      destination,
      resolve(candidate, '.local'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => assertPlainNumberingReceiptPath(candidate), /Linked/u);
  });
});
