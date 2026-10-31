import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as realAdmission from './managed-e2e-admission.mjs';
import * as testEnvironment from './test-environment.mjs';
import {
  MANAGED_WORKER_CONTEXT_ENV,
  createManagedWorkerEnvironment,
  clearManagedWorkerContext,
  admitManagedWorkerDatabase,
} from './managed-e2e-worker-admission.mjs';

const root = process.cwd();
const databaseUrl =
  'postgresql://dev_cor_test:offline@127.0.0.1:15446/dev_cor_test';
const receipt = {
  kind: 'controlled-managed-e2e-readonly-admission',
  manifestSha256: 'a'.repeat(64),
  runId: '11111111-1111-4111-8111-111111111111',
  parentRunId: '22222222-2222-4222-8222-222222222222',
  containerId: 'b'.repeat(64),
  candidateSha256: 'c'.repeat(64),
  migrationCount: 266,
  actorIds: ['33333333-3333-4333-8333-333333333333'],
};
const selection = {
  manifestPath: join(tmpdir(), 'worker-offline-manifest.json'),
  manifestSha256: receipt.manifestSha256,
  files: ['tests/e2e/case-closure.spec.ts'],
};
function fixture() {
  const environment = createManagedWorkerEnvironment({
    root,
    environment: { DATABASE_URL: databaseUrl },
    selection,
    admission: receipt,
  });
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv(
    MANAGED_WORKER_CONTEXT_ENV,
    environment[MANAGED_WORKER_CONTEXT_ENV],
  );
  const capture = vi
    .spyOn(testEnvironment, 'validateBrowserTestDatabaseUrl')
    .mockReturnValue({ connectionString: databaseUrl });
  const admit = vi
    .spyOn(realAdmission, 'admitManagedE2e')
    .mockResolvedValue(receipt);
  return {
    environment,
    capture,
    admit,
    context: JSON.parse(environment[MANAGED_WORKER_CONTEXT_ENV]),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('absence is legacy, while context clearing never mutates its input', async () => {
  vi.stubEnv(MANAGED_WORKER_CONTEXT_ENV, undefined);
  const capture = vi.spyOn(testEnvironment, 'validateBrowserTestDatabaseUrl');
  const admit = vi.spyOn(realAdmission, 'admitManagedE2e');
  assert.equal(await admitManagedWorkerDatabase({ databaseUrl }), null);
  assert.equal(capture.mock.calls.length, 0);
  assert.equal(admit.mock.calls.length, 0);
  const original = {
    DATABASE_URL: databaseUrl,
    [MANAGED_WORKER_CONTEXT_ENV]: 'caller value',
  };
  const cleaned = clearManagedWorkerContext(original);
  assert.equal(Object.hasOwn(cleaned, MANAGED_WORKER_CONTEXT_ENV), false);
  assert.equal(original[MANAGED_WORKER_CONTEXT_ENV], 'caller value');
  assert.equal(clearManagedWorkerContext(cleaned), cleaned);
});

test('real capture and admission run on every callback boundary without caching', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await admitManagedWorkerDatabase({ root, databaseUrl });
    assert.deepEqual(target, {
      kind: 'managed-e2e-callback-target',
      connectionString: databaseUrl,
    });
    assert.equal(Object.isFrozen(target), true);
  }
  assert.equal(f.capture.mock.calls.length, 2);
  assert.equal(f.admit.mock.calls.length, 2);
  assert.deepEqual(f.admit.mock.calls[0], [
    {
      root,
      manifestPath: selection.manifestPath,
      manifestSha256: selection.manifestSha256,
      databaseUrl,
    },
  ]);
});

test.each([
  ['schemaVersion', 2],
  ['purpose', 'admitted=true'],
  ['root', join(tmpdir(), 'different-root')],
  ['manifestPath', 'relative.json'],
  ['manifestSha256', 'invalid'],
  ['runId', 'invalid'],
  ['parentRunId', receipt.runId],
  ['containerId', 'short'],
  ['candidateSha256', 'short'],
  ['migrationCount', 265],
  ['actorIds', []],
  ['actorIds', [receipt.actorIds[0], receipt.actorIds[0]]],
  ['databaseUrlSha256', 'd'.repeat(64)],
  ['suites', []],
  ['suites', ['tests/e2e/.*']],
  ['suites', ['tests/e2e/case-section-record-ui.spec.ts']],
  ['suites', ['tests/e2e/batch2-lead-import.spec.ts']],
  ['unknown', true],
])(
  'rejects context %s before capture, admission or caller callback',
  async (field, value) => {
    const f = fixture();
    vi.stubEnv(
      MANAGED_WORKER_CONTEXT_ENV,
      JSON.stringify({ ...f.context, [field]: value }),
    );
    let callbacks = 0;
    await assert.rejects(async () => {
      await admitManagedWorkerDatabase({ root, databaseUrl });
      callbacks++;
    });
    assert.equal(callbacks, 0);
    assert.equal(f.capture.mock.calls.length, 0);
    assert.equal(f.admit.mock.calls.length, 0);
  },
);

test.each(['', 'true', 'null', '{}', '{', '[]'])(
  'a present malformed tuple %j cannot fall back to legacy',
  async (raw) => {
    const f = fixture();
    vi.stubEnv(MANAGED_WORKER_CONTEXT_ENV, raw);
    await assert.rejects(admitManagedWorkerDatabase({ root, databaseUrl }));
    assert.equal(f.capture.mock.calls.length, 0);
    assert.equal(f.admit.mock.calls.length, 0);
  },
);

test.each([
  ['kind', 'admitted'],
  ['manifestSha256', 'd'.repeat(64)],
  ['runId', '44444444-4444-4444-8444-444444444444'],
  ['parentRunId', '44444444-4444-4444-8444-444444444444'],
  ['containerId', 'd'.repeat(64)],
  ['candidateSha256', 'd'.repeat(64)],
  ['migrationCount', 267],
  ['actorIds', ['44444444-4444-4444-8444-444444444444']],
])(
  'rejects a changed actual %s before the caller callback',
  async (field, value) => {
    const f = fixture();
    f.admit.mockResolvedValue({ ...receipt, [field]: value });
    let callbacks = 0;
    await assert.rejects(async () => {
      await admitManagedWorkerDatabase({ root, databaseUrl });
      callbacks++;
    });
    assert.equal(callbacks, 0);
    assert.equal(f.capture.mock.calls.length, 1);
    assert.equal(f.admit.mock.calls.length, 1);
  },
);

test.each(['capture', 'admission'])(
  'a real boundary %s failure never reaches the caller',
  async (phase) => {
    const f = fixture();
    const failure = new Error(`offline ${phase} rejected`);
    if (phase === 'capture')
      f.capture.mockImplementation(() => {
        throw failure;
      });
    else f.admit.mockRejectedValue(failure);
    let callbacks = 0;
    await assert.rejects(async () => {
      await admitManagedWorkerDatabase({ root, databaseUrl });
      callbacks++;
    }, failure);
    assert.equal(callbacks, 0);
    assert.equal(f.admit.mock.calls.length, phase === 'capture' ? 0 : 1);
  },
);

test('changing worker input during awaited admission is rejected', async () => {
  const f = fixture();
  f.admit.mockImplementation(async () => {
    vi.stubEnv(
      MANAGED_WORKER_CONTEXT_ENV,
      JSON.stringify({ ...f.context, suites: ['tests/e2e/auth.spec.ts'] }),
    );
    return receipt;
  });
  await assert.rejects(
    admitManagedWorkerDatabase({ root, databaseUrl }),
    /context changed/,
  );
});

test('a worker tuple never permits a non-test process or a changed environment URL', async () => {
  const f = fixture();
  vi.stubEnv('NODE_ENV', 'production');
  await assert.rejects(admitManagedWorkerDatabase({ root, databaseUrl }));
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', databaseUrl.replace(':15446/', ':15433/'));
  await assert.rejects(admitManagedWorkerDatabase({ root, databaseUrl }));
  assert.equal(f.capture.mock.calls.length, 0);
  assert.equal(f.admit.mock.calls.length, 0);
});

test('builder replaces inherited worker data and refuses an unbound admission', () => {
  const original = {
    DATABASE_URL: databaseUrl,
    [MANAGED_WORKER_CONTEXT_ENV]: 'inherited',
  };
  const built = createManagedWorkerEnvironment({
    root,
    environment: original,
    selection,
    admission: receipt,
  });
  assert.notEqual(built[MANAGED_WORKER_CONTEXT_ENV], 'inherited');
  assert.equal(original[MANAGED_WORKER_CONTEXT_ENV], 'inherited');
  assert.throws(() =>
    createManagedWorkerEnvironment({
      root,
      environment: original,
      selection,
      admission: { ...receipt, manifestSha256: 'd'.repeat(64) },
    }),
  );
});
