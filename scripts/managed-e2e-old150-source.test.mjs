import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateOld150Receipt,
  validateOld150CopiedBytes,
  loadManagedOld150Source,
  admitManagedOld150Source,
  parseManagedOld150SourceRef,
} from './managed-e2e-old150-source.mjs';
import { admitManagedWorkerDatabase } from './managed-e2e-worker-admission.mjs';
vi.mock('./managed-e2e-worker-admission.mjs', () => ({
  MANAGED_WORKER_CONTEXT_ENV: 'DEV_COR_MANAGED_E2E_WORKER_CONTEXT',
  admitManagedWorkerDatabase: vi.fn(),
}));
const sha = (x) => createHash('sha256').update(x).digest('hex');
function fixture() {
  const entries = Array.from({ length: 150 }, (_, i) => ({
    name: `m${i}`,
    files: [{ name: 'migration.sql', raw: Buffer.from(`SELECT ${i};\n`) }],
  }));
  const source = {
    head: 'a'.repeat(40),
    objectFormat: 'sha1',
    rows: entries.map((x) => ({
      name: x.name,
      bytes: x.files[0].raw.length,
      sha256: sha(x.files[0].raw),
      headBlobOid: 'a'.repeat(40),
    })),
  };
  const manifest = {
    runId: 'ownrun',
    parentRunId: 'parent',
    containerId: 'c'.repeat(64),
    candidateSha256: 'd'.repeat(64),
    directory: 'C:\\private\\managed-gates\\ownrun',
  };
  const sourceDirectory = manifest.directory + '\\old150-source';
  const context = {
    manifest,
    manifestPath: 'manifest.json',
    manifestSha256: 'e'.repeat(64),
    source,
    sourceDirectory,
  };
  const receipt = {
    schemaVersion: 1,
    purpose: 'controlled-managed-e2e-head-exact-old150-source',
    state: 'SOURCE_COPIES_COMPLETE',
    manifestPath: context.manifestPath,
    manifestSha256: context.manifestSha256,
    runId: manifest.runId,
    parentRunId: manifest.parentRunId,
    containerId: manifest.containerId,
    candidateSha256: manifest.candidateSha256,
    database: 'dev_cor_test',
    port: 15446,
    sourceDirectory,
    source: globalThis.structuredClone(source),
    sqlBoundaryExclusive: '20261014170000_case_external_entry_actions',
  };
  return { entries, source, context, receipt };
}
test('full150 copied SQL hashes exact', () => {
  const f = fixture();
  validateOld150CopiedBytes(f.source.rows, f.entries);
});
for (const [name, mutate] of [
  [
    'SQL bytes',
    (f) =>
      (f.entries[70].files[0].raw = Buffer.from('ALTER TABLE unexpected;')),
  ],
  ['missing migration', (f) => f.entries.pop()],
  [
    'extra file',
    (f) =>
      f.entries[0].files.push({ name: 'extra.sql', raw: Buffer.from('x') }),
  ],
  ['wrong order', (f) => f.entries.reverse()],
])
  test(`reject copied ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateOld150CopiedBytes(f.source.rows, f.entries));
  });
test('receipt matches exact source/run/manifest tuple', () => {
  const f = fixture();
  validateOld150Receipt(f.receipt, f.context);
});
for (const [name, mutate] of [
  ['wrong run', (f) => (f.receipt.runId = 'foreign')],
  ['wrong CID', (f) => (f.receipt.containerId = 'f'.repeat(64))],
  ['wrong manifest', (f) => (f.receipt.manifestSha256 = 'f'.repeat(64))],
  ['wrong source', (f) => (f.receipt.source.rows[0].sha256 = 'f'.repeat(64))],
  ['legacy path', (f) => (f.receipt.sourceDirectory = 'C:\\legacy')],
  ['wrong port', (f) => (f.receipt.port = 15433)],
])
  test(`reject ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateOld150Receipt(f.receipt, f.context));
  });
test('missing worker is legacy only; cannot inject source receipt', () => {
  assert.equal(loadManagedOld150Source({ environment: {} }), null);
  assert.throws(() =>
    loadManagedOld150Source({
      environment: { DEV_COR_MANAGED_OLD150_SOURCE: '{}' },
    }),
  );
});
test('worker admission rejection never falls back or reads copies', async () => {
  vi.mocked(admitManagedWorkerDatabase).mockRejectedValueOnce(Error('denied'));
  await assert.rejects(
    admitManagedOld150Source({ databaseUrl: 'not-used' }),
    /denied/,
  );
});
test('nonmanaged15446 cannot reach historical SQL or callback', async () => {
  const oldNode = process.env.NODE_ENV,
    oldSource = process.env.DEV_COR_MANAGED_OLD150_SOURCE;
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.DEV_COR_MANAGED_OLD150_SOURCE;
    vi.mocked(admitManagedWorkerDatabase).mockResolvedValueOnce(null);
    await assert.rejects(
      admitManagedOld150Source({
        databaseUrl:
          'postgresql://dev_cor_test:offline@127.0.0.1:15446/dev_cor_test',
      }),
    );
  } finally {
    if (oldNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNode;
    if (oldSource === undefined)
      delete process.env.DEV_COR_MANAGED_OLD150_SOURCE;
    else process.env.DEV_COR_MANAGED_OLD150_SOURCE = oldSource;
  }
});

test('missing or malformed managed source receipt rejects before file access', () => {
  for (const environment of [
    {},
    { DEV_COR_MANAGED_OLD150_SOURCE: '{}' },
    {
      DEV_COR_MANAGED_OLD150_SOURCE: JSON.stringify({
        path: 'x',
        sha256: 'invalid',
      }),
    },
  ])
    assert.throws(() => parseManagedOld150SourceRef(environment));
});

test('actual independent temporary SQL file tampering is detected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-old150-unit-')),
    file = join(directory, 'migration.sql'),
    f = fixture();
  try {
    writeFileSync(file, f.entries[42].files[0].raw);
    f.entries[42].files[0].raw = readFileSync(file);
    validateOld150CopiedBytes(f.source.rows, f.entries);
    writeFileSync(file, 'SELECT changed;');
    f.entries[42].files[0].raw = readFileSync(file);
    assert.throws(() => validateOld150CopiedBytes(f.source.rows, f.entries));
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
});
