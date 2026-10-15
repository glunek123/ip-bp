import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { coreLeadFixtures } from '../support/core-lead-database.mjs';
import {
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
} from '../support/case-archive-database.mjs';
import {
  applyCaseExternalEntryMigration,
  assertSqlRejected,
  copyOldCaseSchema,
  createCaseExternalEntrySchema,
  dropCaseExternalEntrySchema,
  externalEntryActionGrantRows,
  externalEntryActionMigration,
  externalEntryFoundationMigration,
  externalEntryNormalGuardMigration,
  newCaseExternalEntrySchema,
  oldCaseMigrations,
  replayOldCaseMigrations,
  snapshotOldCaseRows,
  withCaseExternalEntryMigrationDatabase,
  createCaseExternalFactSourceProbe,
  assertCaseExternalFactSourceProbe,
  failExternalEntryNormalGuardMigrationAtomically,
} from '../support/case-external-entry-migration.mjs';
import { allowOtherEnterpriseAccountSetup } from '../support/case-complaint-mailing-database.mjs';
import { seedCoreLeadE2eData } from '../support/core-lead-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { clearCaseExternalEntryFixture } from '../support/case-external-entry-database.mjs';
import { prepareCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { prepareCaseFilingFixture } from '../support/case-filing-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function clean() {
  await clearCaseExternalEntryFixture();
  await seedCoreLeadE2eData({ reuseExisting: true });
}

test.beforeEach(async () => {
  await clean();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('CA018 upgrades an actual 150-migration case and guards normal fact sources atomically', async ({
  request,
}) => {
  test.setTimeout(180_000);
  expect(oldCaseMigrations).toHaveLength(150);

  const prior = await createClosedCaseArchiveSourceThroughApi(request);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  const archivedResponse = await request.post(
    `/api/v1/cases/${prior.caseId}/archive`,
    {
      headers: operator,
      data: {
        expectedVersion: prior.closureResult.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: prior.closureResult.closureVersionId,
        archiveAt: today(),
        archiveType: 'MEDIATION',
        archiveReason: 'CA018 real legacy migration fixture',
      },
    },
  );
  expect(archivedResponse.status()).toBe(201);
  const archived = await archivedResponse.json();
  expect(archived.stage).toBe('ARCHIVED');

  await withCaseExternalEntryMigrationDatabase(async (client) => {
    const priorIdentity = (
      await client.query('SELECT department_id FROM public.cases WHERE id=$1', [
        prior.caseId,
      ])
    ).rows[0];
    const priorDepartmentId = priorIdentity?.department_id;
    if (typeof priorDepartmentId !== 'string')
      throw new Error('Legacy case department identity is missing');
    const empty = newCaseExternalEntrySchema('ca018_empty');
    const upgrade = newCaseExternalEntrySchema('ca018_upgrade');
    const retry = newCaseExternalEntrySchema('ca018_retry');
    const schemas = [empty, upgrade, retry];
    try {
      await createCaseExternalEntrySchema(client, empty);
      await replayOldCaseMigrations(client);
      const emptyOldObjects = Number(
        (
          await client.query(
            `SELECT count(*) AS n FROM information_schema.tables
             WHERE table_schema=$1 AND table_type='BASE TABLE'
               AND table_name <> '_prisma_migrations'`,
            [empty],
          )
        ).rows[0].n,
      );
      expect(emptyOldObjects).toBeGreaterThan(100);
      await applyCaseExternalEntryMigration(
        client,
        externalEntryActionMigration,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryFoundationMigration,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryNormalGuardMigration,
      );
      expect(await externalEntryActionGrantRows(client, empty)).toEqual([]);

      await createCaseExternalEntrySchema(client, upgrade);
      await replayOldCaseMigrations(client);
      await copyOldCaseSchema(client, upgrade);
      const before = await snapshotOldCaseRows(client, upgrade, prior.caseId);
      expect(before.cases[0]?.stage).toBe('ARCHIVED');
      expect(before.cases[0]?.source_lead_id).not.toBeNull();
      expect(before.cases[0]?.source_notary_matter_id).not.toBeNull();
      expect(before.cases[0]?.certificate_id).not.toBeNull();
      await applyCaseExternalEntryMigration(
        client,
        externalEntryActionMigration,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryFoundationMigration,
      );
      await createCaseExternalFactSourceProbe(client, upgrade);
      await assertCaseExternalFactSourceProbe(
        client,
        upgrade,
        prior.caseId,
        priorDepartmentId,
        false,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryNormalGuardMigration,
      );
      await assertCaseExternalFactSourceProbe(
        client,
        upgrade,
        prior.caseId,
        priorDepartmentId,
        true,
      );
      expect(
        await snapshotOldCaseRows(
          client,
          upgrade,
          prior.caseId,
          before.columnManifest,
        ),
      ).toEqual(before);
      expect(await externalEntryActionGrantRows(client, upgrade)).toEqual([]);

      await createCaseExternalEntrySchema(client, retry);
      await replayOldCaseMigrations(client);
      await copyOldCaseSchema(client, retry);
      const retryBefore = await snapshotOldCaseRows(
        client,
        retry,
        prior.caseId,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryActionMigration,
      );
      await client.query('CREATE TABLE case_external_entries(id uuid)');
      await expect(
        applyCaseExternalEntryMigration(
          client,
          externalEntryFoundationMigration,
        ),
      ).rejects.toThrow();
      expect(
        (
          await client.query(
            `SELECT is_nullable FROM information_schema.columns
             WHERE table_schema=$1 AND table_name='cases'
               AND column_name='source_lead_id'`,
            [retry],
          )
        ).rows[0].is_nullable,
      ).toBe('NO');
      expect(
        (
          await client.query(
            `SELECT count(*) AS n FROM pg_constraint
             WHERE connamespace=$1::regnamespace
               AND conname='cases_source_triple_check'`,
            [retry],
          )
        ).rows[0].n,
      ).toBe('0');
      expect(
        (
          await client.query(
            `SELECT count(*) AS n FROM pg_type t
             JOIN pg_namespace n ON n.oid=t.typnamespace
             WHERE n.nspname=$1 AND t.typname='case_external_entry_kind'`,
            [retry],
          )
        ).rows[0].n,
      ).toBe('0');
      await client.query('DROP TABLE case_external_entries');
      await applyCaseExternalEntryMigration(
        client,
        externalEntryFoundationMigration,
      );
      expect(
        await snapshotOldCaseRows(
          client,
          retry,
          prior.caseId,
          retryBefore.columnManifest,
        ),
      ).toEqual(retryBefore);
      await createCaseExternalFactSourceProbe(client, retry);
      await assertCaseExternalFactSourceProbe(
        client,
        retry,
        prior.caseId,
        priorDepartmentId,
        false,
      );
      const failedGuardMigration =
        await failExternalEntryNormalGuardMigrationAtomically(client, retry);
      expect(failedGuardMigration.errorCode).toBe('22012');
      expect(failedGuardMigration.after).toBe(failedGuardMigration.before);
      await assertCaseExternalFactSourceProbe(
        client,
        retry,
        prior.caseId,
        priorDepartmentId,
        false,
      );
      await applyCaseExternalEntryMigration(
        client,
        externalEntryNormalGuardMigration,
      );
      await assertCaseExternalFactSourceProbe(
        client,
        retry,
        prior.caseId,
        priorDepartmentId,
        true,
      );
      expect(
        await snapshotOldCaseRows(
          client,
          retry,
          prior.caseId,
          retryBefore.columnManifest,
        ),
      ).toEqual(retryBefore);
      expect(
        (
          await client.query(
            `SELECT count(*) AS n FROM information_schema.tables
             WHERE table_schema=$1 AND table_name='case_external_entries'`,
            [retry],
          )
        ).rows[0].n,
      ).toBe('1');
      expect(await externalEntryActionGrantRows(client, retry)).toEqual([]);

      await client.query(`SET search_path TO "${upgrade}"`);
      expect(
        (await client.query('SELECT id FROM cases WHERE id=$1', [prior.caseId]))
          .rows,
      ).toHaveLength(1);
      await assertSqlRejected(client, () =>
        client.query(
          `UPDATE cases SET source_lead_id=NULL,source_notary_matter_id=NULL,
             certificate_id=NULL WHERE id=$1`,
          [prior.caseId],
        ),
      );
      expect(
        await snapshotOldCaseRows(
          client,
          upgrade,
          prior.caseId,
          before.columnManifest,
        ),
      ).toEqual(before);
    } finally {
      for (const schema of schemas)
        await dropCaseExternalEntrySchema(client, schema).catch(
          () => undefined,
        );
    }
  });
});
