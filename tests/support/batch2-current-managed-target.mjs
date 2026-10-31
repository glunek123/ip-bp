import {
  captureTestEnvironment,
  validateIsolatedTestDatabaseUrl,
} from '../../scripts/test-environment.mjs';

export function isBatch2Current269(environment = process.env) {
  return environment.BATCH2_CURRENT_269_SCOPE !== undefined;
}

// A branch selector is not a ledger receipt. The owned parent/child window
// separately verifies plan, receipt, source invariance and the complete 269 ledger.
export function assertBatch2Current269Target(
  environment = process.env,
  root = process.cwd(),
) {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.BATCH2_CURRENT_269_SCOPE !== 'owned-child-269'
  )
    throw new Error('Batch2 current scope is not the owned 269 child');
  const project = environment.DEV_COR_TEST_DATABASE_PROJECT;
  const id = environment.DEV_COR_TEST_DATABASE_CONTAINER_ID;
  if (
    project !== 'dev-cor-closure-flow-20261030' ||
    !/^[a-f0-9]{64}$/u.test(id ?? '')
  )
    throw new Error('Batch2 current child physical binding differs');
  if (
    Object.keys(environment).some(
      (key) =>
        key.startsWith('DEV_COR_MANAGED_') || key.startsWith('CA018_OLD150_'),
    )
  )
    throw new Error(
      'Batch2 current child rejects inherited managed or old worker context',
    );
  const url = environment.DEV_COR_TEST_DATABASE_URL;
  if (!url || url !== environment.DATABASE_URL)
    throw new Error('Batch2 current child requires the captured URL');
  const target = validateIsolatedTestDatabaseUrl(url, {
    allowRandomPort: true,
  });
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== 15446 ||
    target.database !== 'dev_cor_test' ||
    target.username !== 'dev_cor_test'
  )
    throw new Error(
      'Batch2 current child requires the owned loopback 15446 target',
    );
  const captured = captureTestEnvironment(root, {
    inheritedEnvironment: environment,
    pnpmVersion: '11.27.0',
  });
  if (captured.childEnvironment.DATABASE_URL !== url)
    throw new Error('Batch2 current child captured URL differs');
  return url;
}
