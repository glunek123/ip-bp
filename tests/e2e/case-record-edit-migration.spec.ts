import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
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
import {
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseComplaintMailingFixture,
  allowOtherEnterpriseAccountSetup,
} from '../support/case-complaint-mailing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import {
  copyOldTables,
  assertNoOrphanedOldForeignKeys,
} from '../support/case-execution-mailing-migration.mjs';
import {
  clearRecordEditFixture,
  withRecordEditDatabase,
} from '../support/case-record-edit-database.js';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const migrationRoot = resolve(process.cwd(), 'backend/prisma/migrations');
const enumMigration = '20261014120000_case_record_edit_enums';
const factMigration = '20261014120100_case_record_edits';
const newActions = ['case.defendant-contact.update', 'case.acceptance.correct'];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function clean() {
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
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('CE-001 replays 146 predecessors, preserves archived old facts/receipts/grants, and safely retries failed DDL', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: Buffer.from('%PDF-1.7\nCE001 archive predecessor bytes\n%%EOF\n'),
  });
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  const archive = await request.post(`/api/v1/cases/${source.caseId}/archive`, {
    headers: operator,
    data: {
      expectedVersion: source.closureResult.version,
      idempotencyKey: randomUUID(),
      expectedClosureVersionId: source.closureResult.closureVersionId,
      archiveAt: today(),
      archiveType: 'EXECUTION_COLLECTED',
      archiveReason: '已办结并归档，保留原锚',
    },
  });
  expect(archive.status(), await archive.text()).toBe(201);
  const downloadUrl = `/api/v1/materials/${source.file!.materialId}/versions/${source.file!.contentVersionId}/content`;
  const originalFile = await request.get(downloadUrl, { headers: operator });
  expect(originalFile.status()).toBe(200);
  const originalBytes = await originalFile.body();

  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  expect(names.slice(-2)).toEqual([enumMigration, factMigration]);
  expect(names).toHaveLength(148);
  const prior = names.slice(0, 146);
  const sql = async (name: string) =>
    readFile(resolve(migrationRoot, name, 'migration.sql'), 'utf8');
  const emptySchema = `ce001_empty_${randomUUID().replaceAll('-', '')}`;
  const upgradeSchema = `ce001_upgrade_${randomUUID().replaceAll('-', '')}`;

  await withRecordEditDatabase(async (client) => {
    const apply = async (migrations: string[]) => {
      for (const name of migrations) await client.query(await sql(name));
    };
    const rows = async (query: string, params: unknown[] = []) =>
      (await client.query(query, params)).rows;
    const snapshot = async (caseId: string) => ({
      case: await rows('SELECT to_jsonb(t) AS row FROM cases t WHERE id=$1', [
        caseId,
      ]),
      defendants: await rows(
        "SELECT to_jsonb(t)-'contact_revision' AS row FROM case_defendants t WHERE case_id=$1 ORDER BY id",
        [caseId],
      ),
      acceptance: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptances t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      matchReceipt: await rows(
        'SELECT to_jsonb(t) AS row FROM case_match_receipts t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      acceptanceReceipt: await rows(
        'SELECT to_jsonb(t) AS row FROM case_acceptance_receipts t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      archiveVersions: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_versions t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      archiveReceipt: await rows(
        'SELECT to_jsonb(t) AS row FROM case_archive_receipts t WHERE case_id=$1 ORDER BY id',
        [caseId],
      ),
      content: await rows(
        "SELECT to_jsonb(t) AS row FROM content_versions t JOIN materials m ON m.id=t.material_id WHERE m.owner_type='CASE' AND m.owner_id=$1 ORDER BY t.id",
        [caseId],
      ),
      references: await rows(
        "SELECT to_jsonb(t) AS row FROM material_references t WHERE resource_type='case' AND resource_id=$1 ORDER BY id",
        [caseId],
      ),
      audits: await rows(
        "SELECT to_jsonb(t) AS row FROM audit_events t WHERE resource_type='CASE' AND resource_id=$1 ORDER BY id",
        [caseId],
      ),
      grants: await rows(
        'SELECT to_jsonb(t) AS row FROM role_grants t WHERE action::text <> ALL($1::text[]) ORDER BY id',
        [newActions],
      ),
    });
    const publicSnapshot = await snapshot(source.caseId);
    const assertNoNewGrant = async () => {
      const count = await rows(
        'SELECT count(*)::int AS n FROM role_grants WHERE role_template_id=$1 AND action::text=ANY($2::text[])',
        [coreLeadFixtures.roleA, newActions],
      );
      expect(count[0].n).toBe(0);
    };
    try {
      await client.query(`CREATE SCHEMA ${quote(emptySchema)}`);
      await client.query(`SET search_path TO ${quote(emptySchema)}`);
      await apply(names);
      const empty = await rows(
        "SELECT to_regclass('case_defendant_contact_changes') IS NOT NULL AS contacts,to_regclass('case_acceptance_corrections') IS NOT NULL AS corrections,to_regclass('case_record_edit_receipts') IS NOT NULL AS receipts",
      );
      expect(empty[0]).toEqual({
        contacts: true,
        corrections: true,
        receipts: true,
      });
      await assertNoNewGrant();

      await client.query(`CREATE SCHEMA ${quote(upgradeSchema)}`);
      await client.query(`SET search_path TO ${quote(upgradeSchema)}`);
      await apply(prior);
      await copyOldTables(client, upgradeSchema);
      expect(
        await assertNoOrphanedOldForeignKeys(client, upgradeSchema),
      ).toBeGreaterThan(0);
      const copied = await snapshot(source.caseId);
      expect(copied).toEqual(publicSnapshot);
      await apply([enumMigration]);
      const ddl = await sql(factMigration);
      expect(ddl).toMatch(/COMMIT;\s*$/u);
      let failureCode: string | null = null;
      try {
        await client.query(ddl.replace(/COMMIT;\s*$/u, 'SELECT 1/0;\nCOMMIT;'));
      } catch (error) {
        failureCode = (error as { code?: string }).code ?? null;
        await client.query('ROLLBACK');
      }
      expect(failureCode).toBe('22012');
      const rolledBack = await rows(
        "SELECT to_regclass('case_defendant_contact_changes') IS NULL AND to_regclass('case_acceptance_corrections') IS NULL AND to_regclass('case_record_edit_receipts') IS NULL AS absent",
      );
      expect(rolledBack[0].absent).toBe(true);
      expect(await snapshot(source.caseId)).toEqual(copied);
      await apply([factMigration]);
      expect(await snapshot(source.caseId)).toEqual(publicSnapshot);
      await assertNoNewGrant();
      const newFacts = await rows(
        'SELECT (SELECT count(*) FROM case_defendant_contact_changes) AS contacts,(SELECT count(*) FROM case_acceptance_corrections) AS corrections,(SELECT count(*) FROM case_record_edit_receipts) AS receipts',
      );
      expect(newFacts[0]).toEqual({
        contacts: '0',
        corrections: '0',
        receipts: '0',
      });

      const root = (
        await rows(
          'SELECT id,trial_round_id,department_id,recorded_by_user_id FROM case_acceptances WHERE case_id=$1 LIMIT 1',
          [source.caseId],
        )
      )[0];
      const originalAudit = (
        await rows(
          "SELECT id FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 LIMIT 1",
          [source.caseId],
        )
      )[0];
      const sqlCode = async (statement: string, parameters: unknown[]) => {
        await client.query('BEGIN');
        let code: string | null = null;
        try {
          await client.query(statement, parameters);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        } catch (error) {
          code = (error as { code?: string }).code ?? null;
        } finally {
          await client.query('ROLLBACK');
        }
        return code;
      };
      expect(
        await sqlCode(
          'UPDATE case_acceptances SET court_case_no=court_case_no WHERE id=$1',
          [root.id],
        ),
      ).toBe('23514');
      expect(
        await sqlCode('DELETE FROM case_acceptances WHERE id=$1', [root.id]),
      ).toBe('23514');
      expect(
        await sqlCode(
          'UPDATE case_archive_versions SET case_id=case_id WHERE case_id=$1',
          [source.caseId],
        ),
      ).toBe('23514');
      expect(
        await sqlCode('UPDATE case_defendants SET phone=$2 WHERE case_id=$1', [
          source.caseId,
          '非法绕过',
        ]),
      ).toBe('23514');
      expect(
        await sqlCode(
          'UPDATE case_defendants SET name=name||$2 WHERE case_id=$1',
          [source.caseId, '非法身份变更'],
        ),
      ).toBe('23514');
      expect(
        await sqlCode('DELETE FROM case_defendants WHERE case_id=$1', [
          source.caseId,
        ]),
      ).toBe('23514');
      expect(
        await sqlCode(
          'INSERT INTO case_acceptance_corrections(id,case_id,department_id,acceptance_id,trial_round_id,from_revision,to_revision,accepted_at,court_case_no,reason,recorded_by_user_id,audit_event_id) VALUES($1,$2,$3,$4,$5,1,2,$6,$7,$8,$9,$10)',
          [
            randomUUID(),
            source.caseId,
            root.department_id,
            root.id,
            root.trial_round_id,
            today(),
            '断链案号',
            '断链反例',
            root.recorded_by_user_id,
            originalAudit.id,
          ],
        ),
      ).toBe('23514');
      expect(await snapshot(source.caseId)).toEqual(publicSnapshot);

      const defendant = (
        await rows(
          'SELECT id,department_id,phone,address FROM case_defendants WHERE case_id=$1 ORDER BY id LIMIT 1',
          [source.caseId],
        )
      )[0];
      const fakeChangeId = randomUUID();
      const fakeResult = {
        caseId: source.caseId,
        defendantId: defendant.id,
        changeId: fakeChangeId,
        contactRevision: 1,
        phone: '010-66668888',
        address: defendant.address,
        recordedAt: new Date().toISOString(),
      };
      const receiptSql =
        "INSERT INTO case_record_edit_receipts(id,department_id,actor_user_id,case_id,command,idempotency_key,request_fingerprint,result_snapshot) VALUES($1,$2,$3,$4,'DEFENDANT_CONTACT_UPDATE',$5,$6,$7::jsonb)";
      expect(
        await sqlCode(receiptSql, [
          randomUUID(),
          defendant.department_id,
          root.recorded_by_user_id,
          source.caseId,
          randomUUID(),
          'a'.repeat(64),
          JSON.stringify(fakeResult),
        ]),
      ).toBe('23514');
      expect(
        await rows('SELECT count(*)::int AS n FROM case_record_edit_receipts'),
      ).toEqual([{ n: 0 }]);

      await client.query(
        "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,'case.defendant-contact.update','TEAM')",
        [randomUUID(), coreLeadFixtures.roleA],
      );
      const auditId = randomUUID();
      const recordedAt = new Date().toISOString();
      const contactResult = { ...fakeResult, recordedAt };
      const auditDetails = {
        defendantId: defendant.id,
        changeId: fakeChangeId,
        fromRevision: 0,
        toRevision: 1,
        beforePhone: defendant.phone,
        beforeAddress: defendant.address,
        phone: contactResult.phone,
        address: contactResult.address,
      };
      await client.query('BEGIN');
      try {
        await client.query(
          "INSERT INTO audit_events(id,department_id,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES($1,$2,$3,$3,'CASE',$4,'case.defendant-contact.updated',$5::jsonb)",
          [
            auditId,
            defendant.department_id,
            root.recorded_by_user_id,
            source.caseId,
            JSON.stringify(auditDetails),
          ],
        );
        await client.query(
          'UPDATE case_defendants SET phone=$2,contact_revision=1 WHERE id=$1',
          [defendant.id, contactResult.phone],
        );
        await client.query(
          'INSERT INTO case_defendant_contact_changes(id,case_id,department_id,defendant_id,from_revision,to_revision,before_phone,before_address,phone,address,recorded_at,recorded_by_user_id,audit_event_id) VALUES($1,$2,$3,$4,0,1,$5,$6,$7,$8,$9,$10,$11)',
          [
            fakeChangeId,
            source.caseId,
            defendant.department_id,
            defendant.id,
            defendant.phone,
            defendant.address,
            contactResult.phone,
            contactResult.address,
            recordedAt,
            root.recorded_by_user_id,
            auditId,
          ],
        );
        await client.query(receiptSql, [
          randomUUID(),
          defendant.department_id,
          root.recorded_by_user_id,
          source.caseId,
          randomUUID(),
          'b'.repeat(64),
          JSON.stringify(contactResult),
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      expect(
        await rows('SELECT count(*)::int AS n FROM case_record_edit_receipts'),
      ).toEqual([{ n: 1 }]);
      expect(
        await sqlCode(receiptSql, [
          randomUUID(),
          defendant.department_id,
          root.recorded_by_user_id,
          source.caseId,
          randomUUID(),
          'c'.repeat(64),
          JSON.stringify(contactResult),
        ]),
      ).toBe('23505');
      expect(
        await rows('SELECT count(*)::int AS n FROM case_record_edit_receipts'),
      ).toEqual([{ n: 1 }]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('SET search_path TO public').catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS ${quote(emptySchema)} CASCADE`)
        .catch(() => undefined);
      await client
        .query(`DROP SCHEMA IF EXISTS ${quote(upgradeSchema)} CASCADE`)
        .catch(() => undefined);
    }
  });
  const afterFile = await request.get(downloadUrl, { headers: operator });
  expect(afterFile.status()).toBe(200);
  expect(await afterFile.body()).toEqual(originalBytes);
});
