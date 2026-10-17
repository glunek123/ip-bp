import { test } from '@playwright/test';
import { verifyLeadBatchPushMigration } from '../support/lead-batch-push-migration.mjs';

test('replays lead batch push migration on an empty owned schema and upgrades a minimal 160 predecessor', async () => {
  const result = await verifyLeadBatchPushMigration();
  if (!Array.isArray(result.source) || result.source.length !== 161)
    throw new Error('Migration evidence source set is incomplete');
  const source = result.source as Array<{ name: string; sha256: string }>;
  if (
    source.at(-1)?.name !== '20261016110000_lead_batch_push' ||
    source.at(-1)?.sha256 !==
      '1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87'
  )
    throw new Error(
      'Migration evidence does not include the pinned 161 source',
    );
  if (
    JSON.stringify(result.checks) !==
    JSON.stringify([
      'empty-owned-full-161-source-replay',
      'owned-160-fixture-ddl-rollback',
      'owned-160-minimal-membership-upgrade-failure-and-raw-retry',
    ])
  )
    throw new Error('Migration evidence checks are incomplete');
  if (
    result.fixture !==
      'department + internal user + membership only; no lead or business receipt facts' ||
    result.cleanedSchemas !== 2
  )
    throw new Error('Migration fixture/cleanup evidence is incomplete');
  if (result.publicUnchanged !== true)
    throw new Error('Public catalog preservation was not confirmed');
  const digests = result.publicDigests as Record<string, unknown>;
  const values = [digests.before, digests.beforeCleanup, digests.after];
  if (
    !values.every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value),
    )
  )
    throw new Error('Public catalog digest evidence is incomplete');
  if (new Set(values).size !== 1)
    throw new Error('Public catalog digests do not match');
  if (
    typeof result.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(result.fingerprint)
  )
    throw new Error('Captured non-secret environment fingerprint is missing');
  await test.info().attach('lead-batch-migration-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          source: result.source,
          checks: result.checks,
          fixture: result.fixture,
          cleanedSchemas: result.cleanedSchemas,
          publicUnchanged: result.publicUnchanged,
          publicDigests: result.publicDigests,
          fingerprint: result.fingerprint,
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
});
