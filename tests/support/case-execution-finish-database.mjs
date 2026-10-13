import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { validateIsolatedTestDatabaseUrl } from '../../scripts/test-environment.mjs';
import { verifyCaseExecutionMailingAndFilingDatabase } from './case-execution-mailing-database.mjs';
import { executionSourceSnapshot } from './case-execution-finish-migration.mjs';

const fixtureDepartments = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
];

// This cleanup is limited to the existing synthetic core-lead fixture departments.
// It runs before the established fixture cleanup, never against a preview database.
export async function clearCaseExecutionFinishFixture() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || databaseUrl === undefined)
    throw new Error(
      'Execution finish cleanup requires the isolated test database',
    );
  validateIsolatedTestDatabaseUrl(databaseUrl, { allowRandomPort: true });
  if (
    resolve(process.env.PRIVATE_FILE_ROOT ?? '') !==
    resolve(process.cwd(), '.local/private-files/test')
  )
    throw new Error('Execution finish cleanup requires the isolated file root');
  const requireFromBackend = createRequire(
    resolve(process.cwd(), 'backend/package.json'),
  );
  const { Client } = requireFromBackend('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = await client.query(
      'SELECT current_database() AS database, current_schema() AS schema',
    );
    if (
      identity.rows[0].database !== 'dev_cor_test' ||
      identity.rows[0].schema !== 'public'
    )
      throw new Error('Unexpected execution finish fixture database or schema');
    await client.query('BEGIN');
    try {
      const guarded = [
        'cases',
        'case_execution_finishes',
        'case_execution_finish_versions',
        'case_execution_finish_receipts',
        'material_references',
        'audit_events',
      ];
      for (const table of guarded)
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      await client.query(
        `UPDATE cases c SET stage='EXECUTING', version=f.from_version
         FROM case_execution_finishes f
         WHERE c.id=f.case_id AND c.department_id=f.department_id
           AND c.department_id=ANY($1::uuid[])`,
        [fixtureDepartments],
      );
      for (const table of [
        'case_execution_finish_versions',
        'case_execution_finish_receipts',
        'case_execution_finishes',
      ])
        await client.query(
          `DELETE FROM "${table}" WHERE department_id=ANY($1::uuid[])`,
          [fixtureDepartments],
        );
      await client.query(
        `DELETE FROM material_references
         WHERE department_id=ANY($1::uuid[]) AND purpose='EXECUTION_FINISH_BASIS'`,
        [fixtureDepartments],
      );
      await client.query(
        `DELETE FROM audit_events WHERE department_id=ANY($1::uuid[])
         AND resource_type='CASE' AND action='case.execution.finished'`,
        [fixtureDepartments],
      );
      for (const table of [...guarded].reverse())
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const code = (error) => error?.response?.code ?? error?.code ?? null;
async function rejected(command) {
  try {
    await command();
    return null;
  } catch (error) {
    return code(error);
  }
}
async function finishSnapshot(client, caseId) {
  return JSON.stringify(
    (
      await client.query(
        `SELECT c.stage,c.version,
    (SELECT count(*)::int FROM case_execution_finishes WHERE case_id=c.id) AS facts,
    (SELECT count(*)::int FROM case_execution_finish_versions WHERE case_id=c.id) AS versions,
    (SELECT count(*)::int FROM case_execution_finish_receipts WHERE case_id=c.id) AS receipts,
    (SELECT count(*)::int FROM audit_events WHERE resource_type='CASE' AND resource_id=c.id AND action='case.execution.finished') AS audits,
    (SELECT count(*)::int FROM material_references WHERE resource_type='case' AND resource_id=c.id AND purpose='EXECUTION_FINISH_BASIS') AS refs
    FROM cases c WHERE c.id=$1`,
        [caseId],
      )
    ).rows[0],
  );
}
async function sqlRejected(client, sql, values) {
  await client.query('BEGIN');
  try {
    await client.query(sql, values);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    return null;
  } catch (error) {
    return error.code ?? null;
  } finally {
    await client.query('ROLLBACK');
  }
}
async function faultRollback(
  client,
  service,
  actor,
  caseId,
  input,
  table,
  event,
  condition,
) {
  const before = await finishSnapshot(client, caseId);
  const name = `ca015_fault_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${condition} THEN RAISE EXCEPTION 'ca015 injected fault' USING ERRCODE='23514';
    END IF; RETURN NEW; END $$`);
  await client.query(`CREATE TRIGGER "${name}" BEFORE ${event} ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
  let injected = false;
  try {
    await service.finish(actor, caseId, {
      ...input,
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    injected = String(error.message).includes('ca015 injected fault');
  } finally {
    await client.query(`DROP TRIGGER "${name}" ON "${table}"`);
    await client.query(`DROP FUNCTION "${name}"()`);
  }
  return injected && (await finishSnapshot(client, caseId)) === before;
}

export async function verifyCaseExecutionFinishDatabase() {
  const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
  const { AccessControlService } = backend(
    './dist/access-control/access-control.service.js',
  );
  const { PrismaAccessControlStore } = backend(
    './dist/access-control/prisma-access-control.store.js',
  );
  const { CaseExecutionFinishService } = backend(
    './dist/modules/cases/case-execution-finish.service.js',
  );
  const result = await verifyCaseExecutionMailingAndFilingDatabase({
    afterFiling: async ({
      actor,
      roleId,
      caseId,
      materials,
      database,
      client,
      trackStorageKey,
      filed,
    }) => {
      const beforeSource = await executionSourceSnapshot(client, caseId);
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES ($1,$2,'case.execution.finish','DEPARTMENT') ON CONFLICT DO NOTHING`,
        [randomUUID(), roleId],
      );
      const service = new CaseExecutionFinishService(
        database,
        new AccessControlService(new PrismaAccessControlStore(database)),
        materials,
      );
      const draft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'EXECUTION_FINISH_BASIS',
        purpose: 'EXECUTION_FINISH_BASIS',
        originalFilename: 'finish-basis.pdf',
        declaredMimeType: 'application/pdf',
      });
      const uploaded = await materials.finalizeUpload(
        actor,
        draft.id,
        Readable.from(
          Buffer.from('%PDF-1.7\nCA015 synthetic actual basis\n%%EOF\n'),
        ),
      );
      const version = await database.contentVersion.findUniqueOrThrow({
        where: { id: uploaded.contentVersionId },
        select: { storageKey: true },
      });
      trackStorageKey(version.storageKey);
      const input = {
        expectedVersion: filed.version,
        expectedFilingId: filed.filingId,
        idempotencyKey: randomUUID(),
        finishedAt: todayShanghai(),
        reason: '实际执行程序结束',
        basisNote: '实际结束说明及已上传依据',
        basisContentVersionIds: [uploaded.contentVersionId],
      };
      try {
        const wrongSource = await rejected(() =>
          service.finish(actor, caseId, {
            ...input,
            expectedFilingId: randomUUID(),
          }),
        );
        const wrongVersion = await rejected(() =>
          service.finish(actor, caseId, {
            ...input,
            expectedVersion: input.expectedVersion - 1,
          }),
        );
        const noBasis = await rejected(() =>
          service.finish(actor, caseId, {
            ...input,
            basisNote: null,
            basisContentVersionIds: [],
          }),
        );
        const future = await rejected(() =>
          service.finish(actor, caseId, { ...input, finishedAt: '2099-01-01' }),
        );
        const clientDenied = await rejected(() =>
          service.finish(
            { ...actor, clientCustomerId: randomUUID() },
            caseId,
            input,
          ),
        );
        const notaryDenied = await rejected(() =>
          service.finish(
            { ...actor, notaryOfficeId: randomUUID() },
            caseId,
            input,
          ),
        );
        const foreignDenied = await rejected(() =>
          service.finish(
            { ...actor, departmentId: randomUUID() },
            caseId,
            input,
          ),
        );
        const wrongMaterial = await rejected(() =>
          service.finish(actor, caseId, {
            ...input,
            basisContentVersionIds: [randomUUID()],
          }),
        );
        const stageOnly = await sqlRejected(
          client,
          "UPDATE cases SET stage='WAITING_ARCHIVE',version=version+1 WHERE id=$1",
          [caseId],
        );
        const faults = {};
        for (const [table, event, condition] of [
          [
            'audit_events',
            'INSERT',
            `NEW.resource_id='${caseId}' AND NEW.action='case.execution.finished'`,
          ],
          ['case_execution_finishes', 'INSERT', `NEW.case_id='${caseId}'`],
          [
            'cases',
            'UPDATE',
            `NEW.id='${caseId}' AND NEW.stage='WAITING_ARCHIVE'`,
          ],
          [
            'case_execution_finish_versions',
            'INSERT',
            `NEW.case_id='${caseId}'`,
          ],
          [
            'material_references',
            'INSERT',
            `NEW.resource_id='${caseId}' AND NEW.purpose='EXECUTION_FINISH_BASIS'`,
          ],
          [
            'case_execution_finish_receipts',
            'INSERT',
            `NEW.case_id='${caseId}'`,
          ],
        ])
          faults[table] = await faultRollback(
            client,
            service,
            actor,
            caseId,
            input,
            table,
            event,
            condition,
          );
        const competing = {
          ...input,
          idempotencyKey: randomUUID(),
          reason: '另一项实际结束登记',
        };
        const race = await Promise.allSettled([
          service.finish(actor, caseId, input),
          service.finish(actor, caseId, competing),
        ]);
        const winners = race.filter((item) => item.status === 'fulfilled');
        if (winners.length !== 1)
          throw new Error(
            'Execution finish race requires exactly one committed winner',
          );
        const finished = winners[0].value;
        const winnerInput = race[0].status === 'fulfilled' ? input : competing;
        const replay = isDeepStrictEqual(
          await service.finish(actor, caseId, winnerInput),
          finished,
        );
        const conflict = await rejected(() =>
          service.finish(actor, caseId, {
            ...winnerInput,
            reason: '改变原键内容',
          }),
        );
        const stable = await finishSnapshot(client, caseId);
        await database.userAccount.update({
          where: { id: actor.userId },
          data: { active: false },
        });
        const disabledReplay = await rejected(() =>
          service.finish(actor, caseId, winnerInput),
        );
        await database.userAccount.update({
          where: { id: actor.userId },
          data: { active: true },
        });
        const current = await database.userAccount.findUniqueOrThrow({
          where: { id: actor.userId },
          select: { authorizationRevision: true },
        });
        const currentActor = {
          ...actor,
          authorizationRevision: current.authorizationRevision,
        };
        await client.query(
          "DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.execution.finish'",
          [roleId],
        );
        const revokedReplay = await rejected(() =>
          service.finish(currentActor, caseId, winnerInput),
        );
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,'case.execution.finish','DEPARTMENT')",
          [randomUUID(), roleId],
        );
        const restoredReplay = isDeepStrictEqual(
          await service.finish(currentActor, caseId, winnerInput),
          finished,
        );
        const immutable = {};
        for (const table of [
          'case_execution_finishes',
          'case_execution_finish_versions',
          'case_execution_finish_receipts',
        ]) {
          immutable[`${table}:update`] = await sqlRejected(
            client,
            `UPDATE "${table}" SET case_id=case_id WHERE case_id=$1`,
            [caseId],
          );
          immutable[`${table}:delete`] = await sqlRejected(
            client,
            `DELETE FROM "${table}" WHERE case_id=$1`,
            [caseId],
          );
        }
        immutable.audit = await sqlRejected(
          client,
          "DELETE FROM audit_events WHERE resource_id=$1 AND action='case.execution.finished'",
          [caseId],
        );
        const state = JSON.parse(await finishSnapshot(client, caseId));
        const fact = await database.caseExecutionFinish.findUniqueOrThrow({
          where: { caseId },
          include: { versions: true },
        });
        return {
          wrongSource,
          wrongVersion,
          noBasis,
          future,
          clientDenied,
          notaryDenied,
          foreignDenied,
          wrongMaterial,
          stageOnly,
          faults,
          singleWinner: winners.length === 1,
          replay,
          conflict,
          disabledReplay,
          revokedReplay,
          restoredReplay,
          refusedReplayUnchanged:
            stable === (await finishSnapshot(client, caseId)),
          immutable,
          finalState:
            state.stage === 'WAITING_ARCHIVE' &&
            state.version === filed.version + 1 &&
            state.facts === 1 &&
            state.versions === 1 &&
            state.receipts === 1 &&
            state.audits === 1 &&
            state.refs === 1,
          exactBasis:
            fact.versions.length === 1 &&
            fact.versions[0].contentVersionId === uploaded.contentVersionId &&
            fact.filingId === filed.filingId,
          oldFactsPreserved: isDeepStrictEqual(
            await executionSourceSnapshot(client, caseId),
            beforeSource,
          ),
        };
      } finally {
        // Random fixture ownership is inherited from the existing source builder.
        // Remove only the new dependent facts before that builder's established cleanup.
        await (async () => {
          await client.query('BEGIN');
          try {
            await client.query('SET LOCAL session_replication_role=replica');
            await client.query(
              "UPDATE cases SET stage='EXECUTING',version=$2 WHERE id=$1",
              [caseId, filed.version],
            );
            for (const table of [
              'case_execution_finish_versions',
              'case_execution_finish_receipts',
              'case_execution_finishes',
            ])
              await client.query(`DELETE FROM "${table}" WHERE case_id=$1`, [
                caseId,
              ]);
            await client.query(
              "DELETE FROM material_references WHERE resource_type='case' AND resource_id=$1 AND purpose='EXECUTION_FINISH_BASIS'",
              [caseId],
            );
            await client.query(
              "DELETE FROM audit_events WHERE resource_type='CASE' AND resource_id=$1 AND action='case.execution.finished'",
              [caseId],
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        })();
      }
    },
  });
  return result.continuation;
}
