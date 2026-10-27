// Invoke through the owned batch-2 environment wrapper after the integrated
// 184–190 source tree has passed review, before any Playwright webServer starts.
import {
  assertBatch2Admission,
  verifyBatch2EmptyMigrationAndEpoch,
} from './batch2-proxy-calendar-acceptance.mjs';

assertBatch2Admission();
const containerId = process.env.DEV_COR_TEST_DATABASE_CONTAINER_ID;
if (
  process.env.DEV_COR_OPS_BATCH2_OWNED_CONTAINER_ID !== undefined &&
  process.env.DEV_COR_OPS_BATCH2_OWNED_CONTAINER_ID !== containerId
)
  throw new Error('Owned container ID conflicts with the captured target');
process.env.DEV_COR_OPS_BATCH2_OWNED_CONTAINER_ID = containerId;
if (process.env.DEV_COR_OPS_BATCH2_READY !== '1')
  throw new Error('Batch 2 operations acceptance is not READY');

const { verifyBatch2UsernameMigration } =
  await import('./batch2-username-migration.mjs');
const { verifyBatch2CaseConsolidationMigration } =
  await import('./batch2-case-consolidation-migration.mjs');
const same = (actual, expected, name) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name} result differs from its existing spec assertion`);
};

same(
  await verifyBatch2UsernameMigration(),
  {
    migrationCount: 185,
    legacyUsername: 'legacy.user',
    legacyLoginUsername: 'legacy.user',
    uniqueIndexRetained: true,
  },
  '185 username',
);
const proxyCalendar = await verifyBatch2EmptyMigrationAndEpoch();
same(
  proxyCalendar.tables,
  [
    'calendar_manual_items',
    'calendar_reminder_reads',
    'case_refund_applications',
  ],
  '187 tables',
);
same(proxyCalendar.epoch, [0, 0, 1, 2], '187 owner epochs');
if (
  proxyCalendar.migrationCount !== 187 ||
  proxyCalendar.invalidTypesRejected !== true ||
  proxyCalendar.legacyExternalPreserved !== true
)
  throw new Error('186/187 result differs from its existing spec assertion');
same(
  await verifyBatch2CaseConsolidationMigration(),
  {
    before: 0,
    preserved: 2,
    tables: 4,
    incompleteRoot: '23514',
    childProgress: '23514',
    immutableMember: '55000',
    mainProgress: null,
  },
  '188 consolidation',
);
console.log('185, 186/187 and 188 pre-app owned-schema probes passed');
