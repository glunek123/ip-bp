/** Import-safe transport and per-callback admission; environment data never grants access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { admitManagedE2e } from './managed-e2e-admission.mjs';
import { validateBrowserTestDatabaseUrl } from './test-environment.mjs';

export const MANAGED_WORKER_CONTEXT_ENV = 'DEV_COR_MANAGED_E2E_WORKER_CONTEXT';
const digest = (value) => assert.match(value, /^[a-f0-9]{64}$/u);
const uuid = (value) =>
  assert.match(
    value,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fields = [
  'schemaVersion',
  'purpose',
  'root',
  'manifestPath',
  'manifestSha256',
  'runId',
  'parentRunId',
  'containerId',
  'candidateSha256',
  'migrationCount',
  'actorIds',
  'databaseUrlSha256',
  'suites',
];

function validateContext(context, root) {
  assert.ok(context && typeof context === 'object' && !Array.isArray(context));
  assert.deepEqual(Object.keys(context).sort(), [...fields].sort());
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.purpose, 'controlled-managed-e2e-worker-context');
  assert.ok(isAbsolute(context.root));
  assert.equal(context.root, resolve(root));
  assert.ok(isAbsolute(context.manifestPath));
  for (const field of [
    'manifestSha256',
    'containerId',
    'candidateSha256',
    'databaseUrlSha256',
  ])
    digest(context[field]);
  uuid(context.runId);
  uuid(context.parentRunId);
  assert.notEqual(context.runId, context.parentRunId);
  assert.ok(
    Number.isSafeInteger(context.migrationCount) &&
      context.migrationCount >= 266,
  );
  assert.ok(Array.isArray(context.actorIds) && context.actorIds.length > 0);
  context.actorIds.forEach(uuid);
  assert.equal(new Set(context.actorIds).size, context.actorIds.length);
  assert.ok(Array.isArray(context.suites) && context.suites.length > 0);
  assert.equal(new Set(context.suites).size, context.suites.length);
  for (const suite of context.suites) {
    assert.match(suite, /^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/u);
    assert.ok(
      suite !== 'tests/e2e/case-section-record-ui.spec.ts' &&
        suite !== 'tests/e2e/batch2-lead-import.spec.ts',
      'Managed H/import worker is not wired',
    );
  }
  return context;
}

function verifyReceipt(context, admission) {
  assert.equal(admission?.kind, 'controlled-managed-e2e-readonly-admission');
  for (const field of [
    'manifestSha256',
    'runId',
    'parentRunId',
    'containerId',
    'candidateSha256',
    'migrationCount',
  ])
    assert.equal(admission[field], context[field]);
  assert.ok(Array.isArray(admission.actorIds));
  assert.deepEqual(
    [...admission.actorIds].sort(),
    [...context.actorIds].sort(),
  );
}

/** Legacy runners must not forward a caller-supplied managed worker tuple. */
export function clearManagedWorkerContext(environment) {
  if (!Object.hasOwn(environment, MANAGED_WORKER_CONTEXT_ENV))
    return environment;
  const cleaned = { ...environment };
  delete cleaned[MANAGED_WORKER_CONTEXT_ENV];
  return cleaned;
}

/** Pure serialization, called only after the runner's real admission has completed. */
export function createManagedWorkerEnvironment({
  root,
  environment,
  selection,
  admission,
}) {
  assert.equal(typeof environment.DATABASE_URL, 'string');
  const context = validateContext(
    {
      schemaVersion: 1,
      purpose: 'controlled-managed-e2e-worker-context',
      root: resolve(root),
      manifestPath: selection.manifestPath,
      manifestSha256: selection.manifestSha256,
      runId: admission?.runId,
      parentRunId: admission?.parentRunId,
      containerId: admission?.containerId,
      candidateSha256: admission?.candidateSha256,
      migrationCount: admission?.migrationCount,
      actorIds: admission?.actorIds,
      databaseUrlSha256: sha(environment.DATABASE_URL),
      suites: selection.files,
    },
    root,
  );
  verifyReceipt(context, admission);
  return {
    ...clearManagedWorkerContext(environment),
    [MANAGED_WORKER_CONTEXT_ENV]: JSON.stringify(context),
  };
}

/** No caching or cleanup exception: each invocation performs actual capture/admission. */
export async function admitManagedWorkerDatabase({
  root = process.cwd(),
  databaseUrl,
}) {
  const raw = process.env[MANAGED_WORKER_CONTEXT_ENV];
  if (raw === undefined) return null;
  assert.equal(process.env.NODE_ENV, 'test');
  const context = validateContext(JSON.parse(raw), root);
  assert.equal(typeof databaseUrl, 'string');
  assert.ok(
    process.env.DATABASE_URL === databaseUrl,
    'Worker database URL changed',
  );
  assert.equal(sha(databaseUrl), context.databaseUrlSha256);
  const target = validateBrowserTestDatabaseUrl(databaseUrl, root);
  const admission = await admitManagedE2e({
    root,
    manifestPath: context.manifestPath,
    manifestSha256: context.manifestSha256,
    databaseUrl: target.connectionString,
  });
  verifyReceipt(context, admission);
  assert.ok(
    process.env[MANAGED_WORKER_CONTEXT_ENV] === raw &&
      process.env.DATABASE_URL === databaseUrl,
    'Worker context changed during admission',
  );
  return Object.freeze({
    kind: 'managed-e2e-callback-target',
    connectionString: target.connectionString,
  });
}
