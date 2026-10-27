import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const approved = {
  NODE_ENV: 'test',
  BATCH2_ACCEPTANCE_READY: 'batch2-ops-20261027-approved',
  DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-ops-batch2-20261027',
  DEV_COR_TEST_DATABASE_CONTAINER_ID: 'a'.repeat(64),
  DATABASE_URL:
    'postgresql://dev_cor_test:synthetic@127.0.0.1:15440/dev_cor_test',
};
test('batch 2 admission requires exact new container target and ready flag', () => {
  assert.equal(assertBatch2Admission(approved).databaseName, 'dev_cor_test');
  for (const changed of [
    { BATCH2_ACCEPTANCE_READY: undefined },
    { DEV_COR_TEST_DATABASE_PROJECT: 'dev-cor-v6-followups-20261026' },
    { DEV_COR_TEST_DATABASE_CONTAINER_ID: undefined },
    {
      DATABASE_URL:
        'postgresql://dev_cor_test:synthetic@127.0.0.1:15433/dev_cor_test',
    },
    {
      DATABASE_URL:
        'postgresql://dev_cor_test:synthetic@127.0.0.1:15440/production',
    },
  ])
    assert.throws(() => assertBatch2Admission({ ...approved, ...changed }));
});
