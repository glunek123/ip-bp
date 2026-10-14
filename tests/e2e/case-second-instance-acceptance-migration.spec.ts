import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseArchiveFixture,
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
} from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import {
  clearRecordEditFixture,
  setRecordEditGrant,
} from '../support/case-record-edit-database.js';
import {
  clearSecondInstanceAcceptanceFixture,
  createSecondInstanceAcceptanceAppealSource,
  grantSecondInstanceAcceptancePredecessors,
  withSecondInstanceAcceptanceDatabase,
} from '../support/case-second-instance-acceptance-database.mjs';
import {
  copyOldTables,
  assertNoOrphanedOldForeignKeys,
} from '../support/case-execution-mailing-migration.mjs';

const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const enumMigration = '20261014160000_second_instance_acceptance_enums';
const recordsMigration = '20261014160100_second_instance_acceptance_records';
const action = 'case.second-instance-acceptance.update';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function clean() {
  await clearSecondInstanceAcceptanceFixture();
  await clearRecordEditFixture();
  await clearCaseArchiveFixture();
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  await clean();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
  await grantSecondInstanceAcceptancePredecessors();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('CE-002 replays 150 into empty schema and upgrades real 148 facts without changing old records or grants', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: Buffer.from('%PDF-1.7\nCE002 migration old file bytes\n%%EOF\n'),
  });
  const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  const archive = await request.post(`/api/v1/cases/${source.caseId}/archive`, {
    headers,
    data: {
      expectedVersion: source.closureResult.version,
      idempotencyKey: randomUUID(),
      expectedClosureVersionId: source.closureResult.closureVersionId,
      archiveAt: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      archiveType: 'EXECUTION_COLLECTED',
      archiveReason: 'CE002旧归档锚迁移保持',
    },
  });
  expect(archive.status(), await archive.text()).toBe(201);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  const detailResponse = await request.get(`/api/v1/cases/${source.caseId}`, {
    headers,
  });
  expect(detailResponse.status(), await detailResponse.text()).toBe(200);
  const detail = (await detailResponse.json()) as {
    acceptance: { id: string; acceptedAt: string; courtCaseNo: string };
  };
  const correction = await request.post(
    `/api/v1/cases/${source.caseId}/acceptance-correction`,
    {
      headers,
      data: {
        acceptanceId: detail.acceptance.id,
        expectedAcceptanceRevision: 0,
        idempotencyKey: randomUUID(),
        acceptedAt: detail.acceptance.acceptedAt,
        courtCaseNo: 'CE002迁移前更正一审案号',
        reason: '保留旧回执与审计',
      },
    },
  );
  expect(correction.status(), await correction.text()).toBe(201);
  const appeal = await createSecondInstanceAcceptanceAppealSource(request);
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  expect(names).toHaveLength(150);
  expect(names.slice(-2)).toEqual([enumMigration, recordsMigration]);
  const sql = (name: string) =>
    readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  const emptySchema = `ce002_empty_${randomUUID().replaceAll('-', '')}`;
  const upgradeSchema = `ce002_upgrade_${randomUUID().replaceAll('-', '')}`;
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    const rows = async (statement: string, parameters: unknown[] = []) =>
      (await client.query(statement, parameters)).rows;
    const apply = async (migrationNames: string[]) => {
      for (const name of migrationNames) await client.query(await sql(name));
    };
    const oldSnapshot = async (caseId: string) => ({
      case: await rows('SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1', [
        caseId,
      ]),
      acceptances: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptances t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      matchReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_match_receipts t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      recordReceipts: await rows(
        'SELECT to_jsonb(t) AS row FROM case_record_edit_receipts t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      archive: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_versions t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      materialReferences: await rows(
        "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
        [caseId],
      ),
      contentVersions: await rows(
        "SELECT to_jsonb(t) AS row FROM content_versions t JOIN materials m ON m.id=t.material_id WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY t.id",
        [caseId],
      ),
      audit: await rows(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
        [caseId],
      ),
      grants: await rows(
        'SELECT to_jsonb(t) AS row FROM role_grants t WHERE action::text <> $1 ORDER BY id',
        [action],
      ),
    });
    const publicSnapshot = await oldSnapshot(source.caseId);
    const publicAppealSnapshot = await oldSnapshot(appeal.caseId);
    expect(publicSnapshot.archive.length).toBeGreaterThan(0);
    expect(publicSnapshot.recordReceipts.length).toBeGreaterThan(0);
    expect(publicSnapshot.contentVersions.length).toBeGreaterThan(0);
    expect(publicSnapshot.grants.length).toBeGreaterThan(0);
    expect(publicAppealSnapshot.contentVersions.length).toBeGreaterThan(0);
    const noNewGrant = async () => {
      expect(
        await rows(
          'SELECT count(*)::int AS n FROM role_grants WHERE action::text=$1',
          [action],
        ),
      ).toEqual([{ n: 0 }]);
    };
    const failure = async (statement: string, values: unknown[]) => {
      await client.query('BEGIN');
      let rejected: { code?: string; message?: string } | null = null;
      try {
        await client.query(statement, values);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      } catch (error) {
        rejected = error as { code?: string; message?: string };
      } finally {
        await client.query('ROLLBACK');
      }
      expect(rejected).not.toBeNull();
      return rejected;
    };
    try {
      await client.query(`CREATE SCHEMA ${quote(emptySchema)}`);
      await client.query(`SET search_path TO ${quote(emptySchema)}`);
      await apply(names);
      expect(
        await rows(
          "SELECT to_regclass('case_second_instance_acceptance_changes') IS NOT NULL AS changes,to_regclass('case_record_edit_receipts') IS NOT NULL AS receipts",
        ),
      ).toEqual([{ changes: true, receipts: true }]);
      await noNewGrant();

      await client.query(`CREATE SCHEMA ${quote(upgradeSchema)}`);
      await client.query(`SET search_path TO ${quote(upgradeSchema)}`);
      await apply(names.slice(0, 148));
      await copyOldTables(client, upgradeSchema);
      expect(
        await assertNoOrphanedOldForeignKeys(client, upgradeSchema),
      ).toBeGreaterThan(0);
      const copied = await oldSnapshot(source.caseId);
      expect(copied).toEqual(publicSnapshot);
      expect(await oldSnapshot(appeal.caseId)).toEqual(publicAppealSnapshot);
      await apply([enumMigration]);
      const ddl = await sql(recordsMigration);
      expect(ddl).toMatch(/COMMIT;\s*$/u);
      let failedCode: string | undefined;
      try {
        await client.query(ddl.replace(/COMMIT;\s*$/u, 'SELECT 1/0;\nCOMMIT;'));
      } catch (error) {
        failedCode = (error as { code?: string }).code;
        await client.query('ROLLBACK');
      }
      expect(failedCode).toBe('22012');
      expect(
        await rows(
          "SELECT to_regclass('case_second_instance_acceptance_changes') IS NULL AS absent",
        ),
      ).toEqual([{ absent: true }]);
      expect(await oldSnapshot(source.caseId)).toEqual(copied);
      expect(await oldSnapshot(appeal.caseId)).toEqual(publicAppealSnapshot);
      await apply([recordsMigration]);
      expect(await oldSnapshot(source.caseId)).toEqual(publicSnapshot);
      expect(await oldSnapshot(appeal.caseId)).toEqual(publicAppealSnapshot);
      await noNewGrant();
      expect(
        await rows(
          'SELECT count(*)::int AS n FROM case_second_instance_acceptance_changes',
        ),
      ).toEqual([{ n: 0 }]);

      const root = (
        await rows(
          'SELECT id,case_id,department_id,trial_round_id,recorded_by_user_id FROM case_judgment_next_steps WHERE id=$1',
          [appeal.choiceId],
        )
      )[0];
      expect(root).toBeDefined();
      const oldAudit = (
        await rows(
          "SELECT id FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 ORDER BY created_at LIMIT 1",
          [appeal.caseId],
        )
      )[0];
      expect(oldAudit).toBeDefined();
      const insert =
        'INSERT INTO case_second_instance_acceptance_changes(id,case_id,department_id,trial_round_id,choice_id,prior_change_id,from_revision,to_revision,accepted_at,court_case_no,reason,recorded_by_user_id,audit_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)';
      const base = [
        randomUUID(),
        appeal.caseId,
        root.department_id,
        appeal.trialRoundId,
        appeal.choiceId,
        null,
        0,
        1,
        appeal.date,
        'SQL原始案号',
        null,
        root.recorded_by_user_id,
        oldAudit.id,
      ];
      expect(
        (await failure(insert, [base[0], source.caseId, ...base.slice(2)]))
          ?.code,
      ).toBe('23503');
      const brokenChain = [...base];
      brokenChain[6] = 1;
      brokenChain[7] = 2;
      brokenChain[10] = '伪造前序';
      expect((await failure(insert, brokenChain))?.code).toBe('23514');
      expect(
        (
          await failure(insert, [
            ...base.slice(0, 8),
            '2099-01-01',
            ...base.slice(9),
          ])
        )?.code,
      ).toBe('23514');
      expect(
        (await failure(insert, [...base.slice(0, 12), oldAudit.id]))?.code,
      ).toBe('23514');
      const priorDay = new Date(`${appeal.date}T00:00:00Z`);
      priorDay.setUTCDate(priorDay.getUTCDate() - 1);
      expect(
        await rows(
          'SELECT check_case_second_acceptance_dates($1,$2,$3,$4,$5::date) AS allowed',
          [
            appeal.choiceId,
            appeal.caseId,
            root.department_id,
            appeal.trialRoundId,
            priorDay.toISOString().slice(0, 10),
          ],
        ),
      ).toEqual([{ allowed: false }]);
      expect(
        await rows(
          'SELECT check_case_second_acceptance_dates($1,$2,$3,$4,$5::date) AS allowed',
          [
            appeal.choiceId,
            appeal.caseId,
            root.department_id,
            appeal.trialRoundId,
            new Date(`${appeal.date}T00:00:00Z`).toISOString().slice(0, 10),
          ],
        ),
      ).toEqual([{ allowed: true }]);
      expect(
        await rows(
          'SELECT case_record_edit_actor_authorized($1,$2,$3,$4) AS allowed',
          [root.recorded_by_user_id, appeal.caseId, root.department_id, action],
        ),
      ).toEqual([{ allowed: false }]);
      const oldCase = (
        publicSnapshot.case[0] as {
          row: { department_id: string; responsible_user_id: string };
        }
      ).row;
      const forged = {
        caseId: source.caseId,
        choiceId: randomUUID(),
        trialRoundId: randomUUID(),
        changeId: randomUUID(),
        acceptanceRevision: 1,
        acceptedAt: null,
        courtCaseNo: '伪造案号',
        recordedAt: new Date().toISOString(),
      };
      expect(
        (
          await failure(
            "INSERT INTO case_record_edit_receipts(id,department_id,actor_user_id,case_id,command,idempotency_key,request_fingerprint,result_snapshot) VALUES($1,$2,$3,$4,'SECOND_INSTANCE_ACCEPTANCE_SAVE',$5,$6,$7::jsonb)",
            [
              randomUUID(),
              oldCase.department_id,
              oldCase.responsible_user_id,
              source.caseId,
              randomUUID(),
              'a'.repeat(64),
              JSON.stringify(forged),
            ],
          )
        )?.code,
      ).toBe('23514');
      expect(await oldSnapshot(source.caseId)).toEqual(publicSnapshot);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('SET search_path TO public').catch(() => undefined);
      for (const schema of [upgradeSchema, emptySchema])
        if (/^ce002_(?:upgrade|empty)_[0-9a-f]{32}$/u.test(schema))
          await client
            .query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
            .catch(() => undefined);
    }
  });
});
