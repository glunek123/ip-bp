/** Explicit identity-bound source copies only. Import performs no IO/process/DB operation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateIsolatedTestDatabaseUrl } from './test-environment.mjs';
import {
  admitManagedE2e,
  validateManagedE2eTuple,
} from './managed-e2e-admission.mjs';
import {
  admitManagedWorkerDatabase,
  MANAGED_WORKER_CONTEXT_ENV,
} from './managed-e2e-worker-admission.mjs';
export const MANAGED_OLD150_SOURCE_ENV = 'DEV_COR_MANAGED_OLD150_SOURCE';
const boundary = '20261014170000_case_external_entry_actions';
const sha = (raw) => createHash('sha256').update(raw).digest('hex');
const digest = (x) => assert.match(x, /^[a-f0-9]{64}$/u);
function regular(p) {
  const full = resolve(p);
  for (let a = full; ; a = dirname(a)) {
    assert.ok(!lstatSync(a).isSymbolicLink());
    if (dirname(a) === a) break;
  }
  assert.equal(realpathSync.native(full), full);
  assert.ok(lstatSync(full).isFile());
  return readFileSync(full);
}
function bound(ref) {
  digest(ref.sha256);
  const raw = regular(ref.path);
  assert.equal(sha(raw), ref.sha256);
  return JSON.parse(raw);
}
function git(root, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
/** Every source blob must be exact HEAD bytes, not merely an equivalent SQL expression. */
export function verifyCurrentHead150(root) {
  const directory = join(root, 'backend/prisma/migrations');
  const names = readdirSync(directory)
    .filter((n) => /^\d{14}_/u.test(n) && n < boundary)
    .sort();
  assert.equal(names.length, 150);
  const format = git(root, ['rev-parse', '--show-object-format']).trim();
  assert.ok(['sha1', 'sha256'].includes(format));
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const blobs = new Map();
  for (const line of git(root, [
    'ls-tree',
    '-rz',
    'HEAD',
    '--',
    'backend/prisma/migrations',
  ])
    .split('\0')
    .filter(Boolean)) {
    const [meta, path] = line.split('\t');
    const [mode, type, oid] = meta.split(' ');
    blobs.set(path, { mode, type, oid });
  }
  const rows = names.map((name) => {
    const path = `backend/prisma/migrations/${name}/migration.sql`,
      raw = regular(join(root, path)),
      oid = createHash(format)
        .update(`blob ${raw.length}\0`)
        .update(raw)
        .digest('hex'),
      blob = blobs.get(path);
    assert.deepEqual(
      blob,
      { mode: '100644', type: 'blob', oid },
      `Current migration differs from HEAD: ${name}`,
    );
    return { name, bytes: raw.length, sha256: sha(raw), headBlobOid: oid };
  });
  return { head, objectFormat: format, rows };
}
export function validateOld150CopiedBytes(rows, entries) {
  assert.equal(rows.length, 150);
  assert.deepEqual(
    entries.map((x) => x.name),
    rows.map((x) => x.name),
  );
  for (const [i, entry] of entries.entries()) {
    assert.deepEqual(
      entry.files.map((x) => x.name),
      ['migration.sql'],
    );
    const raw = entry.files[0].raw;
    assert.ok(Buffer.isBuffer(raw));
    assert.equal(raw.length, rows[i].bytes);
    assert.equal(sha(raw), rows[i].sha256);
  }
}
export function validateOld150Receipt(
  receipt,
  { manifest, manifestPath, manifestSha256, source, sourceDirectory },
) {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(
    receipt.purpose,
    'controlled-managed-e2e-head-exact-old150-source',
  );
  assert.equal(receipt.state, 'SOURCE_COPIES_COMPLETE');
  assert.equal(receipt.manifestPath, manifestPath);
  assert.equal(receipt.manifestSha256, manifestSha256);
  for (const key of ['runId', 'parentRunId', 'containerId', 'candidateSha256'])
    assert.equal(receipt[key], manifest[key]);
  assert.equal(receipt.sourceDirectory, sourceDirectory);
  assert.equal(sourceDirectory, join(manifest.directory, 'old150-source'));
  assert.equal(receipt.database, 'dev_cor_test');
  assert.equal(receipt.port, 15446);
  assert.deepEqual(receipt.source, source);
  assert.equal(source.rows.length, 150);
  assert.equal(receipt.sqlBoundaryExclusive, boundary);
}
export function parseManagedOld150SourceRef(environment) {
  const raw = environment[MANAGED_OLD150_SOURCE_ENV];
  assert.equal(typeof raw, 'string', 'Managed old150 source receipt required');
  const ref = JSON.parse(raw);
  assert.deepEqual(Object.keys(ref).sort(), ['path', 'sha256']);
  digest(ref.sha256);
  return ref;
}
/** Readonly source selection only. This function never constitutes database admission. */
export function loadManagedOld150Source({
  root = process.cwd(),
  environment = process.env,
} = {}) {
  const workerRaw = environment[MANAGED_WORKER_CONTEXT_ENV];
  if (workerRaw === undefined) {
    assert.equal(
      environment[MANAGED_OLD150_SOURCE_ENV],
      undefined,
      'Managed source cannot be supplied to a legacy runner',
    );
    return null;
  }
  const worker = JSON.parse(workerRaw),
    manifestPath = worker.manifestPath,
    manifestSha256 = worker.manifestSha256;
  assert.equal(worker.purpose, 'controlled-managed-e2e-worker-context');
  assert.equal(worker.root, resolve(root));
  const manifest = bound({ path: manifestPath, sha256: manifestSha256 });
  for (const key of ['runId', 'parentRunId', 'containerId', 'candidateSha256'])
    assert.equal(worker[key], manifest[key]);
  validateManagedE2eTuple(manifest);
  assert.equal(manifest.purpose, 'controlled-synthetic-managed-e2e');
  assert.equal(manifest.database, 'dev_cor_test');
  assert.equal(manifest.port, 15446);
  assert.equal(manifest.host, '127.0.0.1');
  const sourceDirectory = join(manifest.directory, 'old150-source'),
    ref = parseManagedOld150SourceRef(environment);
  assert.equal(resolve(ref.path), join(sourceDirectory, 'source-receipt.json'));
  const receipt = bound(ref),
    source = verifyCurrentHead150(root);
  validateOld150Receipt(receipt, {
    manifest,
    manifestPath,
    manifestSha256,
    source,
    sourceDirectory,
  });
  const migrationsRoot = join(sourceDirectory, 'prisma', 'migrations');
  const entries = readdirSync(migrationsRoot)
    .sort()
    .map((name) => ({
      name,
      files: readdirSync(join(migrationsRoot, name)).map((file) => ({
        name: file,
        raw: regular(join(migrationsRoot, name, file)),
      })),
    }));
  validateOld150CopiedBytes(source.rows, entries);
  return {
    prismaRoot: join(sourceDirectory, 'prisma'),
    migrationsRoot,
    receiptRef: ref,
    rows: source.rows,
  };
}
/** Per-callback actual admission always precedes any caller SQL; source selection alone never grants access. */
export async function admitManagedOld150Source({
  root = process.cwd(),
  databaseUrl,
}) {
  const managed = await admitManagedWorkerDatabase({ root, databaseUrl });
  if (managed === null) {
    assert.equal(process.env[MANAGED_OLD150_SOURCE_ENV], undefined);
    assert.equal(process.env.NODE_ENV, 'test');
    validateIsolatedTestDatabaseUrl(databaseUrl);
    return null;
  }
  const source = loadManagedOld150Source({ root });
  assert.ok(source);
  return { ...source, connectionString: managed.connectionString };
}
/** Future explicit prepare only: owned-child real admission BEFORE any directory/source write. Never retry a partial directory. */
export async function prepareManagedOld150Source({
  root = process.cwd(),
  manifestPath,
  manifestSha256,
  databaseUrl,
}) {
  const admission = await admitManagedE2e({
    root,
    manifestPath,
    manifestSha256,
    databaseUrl,
  });
  const manifest = bound({ path: manifestPath, sha256: manifestSha256 });
  for (const key of ['runId', 'parentRunId', 'containerId', 'candidateSha256'])
    assert.equal(admission[key], manifest[key]);
  assert.equal(manifest.database, 'dev_cor_test');
  assert.equal(manifest.port, 15446);
  const source = verifyCurrentHead150(root),
    sourceDirectory = join(manifest.directory, 'old150-source');
  assert.ok(
    !existsSync(sourceDirectory),
    'Existing source intent/outcome cannot be overwritten or retried',
  );
  mkdirSync(sourceDirectory, { mode: 0o700 });
  const save = (p, value) =>
    writeFileSync(p, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  save(join(sourceDirectory, 'INTENT.json'), {
    state: 'SOURCE_COPY_INTENT_NO_DB_WRITES',
    manifestPath,
    manifestSha256,
    source,
    sourceDirectory,
  });
  const migrationsRoot = join(sourceDirectory, 'prisma', 'migrations');
  mkdirSync(migrationsRoot, { recursive: true, mode: 0o700 });
  for (const row of source.rows) {
    const raw = regular(
      join(root, 'backend/prisma/migrations', row.name, 'migration.sql'),
    );
    assert.equal(sha(raw), row.sha256);
    const directory = join(migrationsRoot, row.name);
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, 'migration.sql'), raw, {
      flag: 'wx',
      mode: 0o600,
    });
    assert.equal(sha(regular(join(directory, 'migration.sql'))), row.sha256);
  }
  assert.deepEqual(verifyCurrentHead150(root), source);
  const afterAdmission = await admitManagedE2e({
    root,
    manifestPath,
    manifestSha256,
    databaseUrl,
  });
  assert.deepEqual(afterAdmission, admission);
  assert.deepEqual(
    bound({ path: manifestPath, sha256: manifestSha256 }),
    manifest,
  );
  const receipt = {
    schemaVersion: 1,
    purpose: 'controlled-managed-e2e-head-exact-old150-source',
    state: 'SOURCE_COPIES_COMPLETE',
    manifestPath,
    manifestSha256,
    ...Object.fromEntries(
      ['runId', 'parentRunId', 'containerId', 'candidateSha256'].map((k) => [
        k,
        manifest[k],
      ]),
    ),
    database: 'dev_cor_test',
    port: 15446,
    sourceDirectory,
    source,
    sqlBoundaryExclusive: boundary,
  };
  validateOld150Receipt(receipt, {
    manifest,
    manifestPath,
    manifestSha256,
    source,
    sourceDirectory,
  });
  const ref = {
    path: join(sourceDirectory, 'source-receipt.json'),
    sha256: '',
  };
  save(ref.path, receipt);
  ref.sha256 = sha(regular(ref.path));
  return {
    receiptRef: ref,
    environment: { [MANAGED_OLD150_SOURCE_ENV]: JSON.stringify(ref) },
  };
}
