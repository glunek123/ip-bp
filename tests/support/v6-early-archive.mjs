import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  grantV6SyntheticRole,
  seedV6ExternalCase,
  seedV6InternalCustomer,
  v6ScopedPrisma,
  withV6FollowupSchema,
} from './v6-followup-fixture.mjs';

const root = process.cwd();
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const { Client } = requireBackend('pg');
const cutover = readFileSync(
  resolve(
    root,
    'docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    if (error?.response?.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}

export async function verifyV6EarlyArchive() {
  return withV6FollowupSchema(async ({ client, schema }) => {
    const owner = await seedV6InternalCustomer(client);
    const source = await seedV6ExternalCase(client, owner);
    const concurrentSource = await seedV6ExternalCase(client, owner, {
      createdAt: '2026-10-25T02:00:00Z',
    });
    const batchSource = await seedV6ExternalCase(client, owner, {
      createdAt: '2026-10-25T03:00:00Z',
    });
    await client.query(cutover);
    const roleId = await grantV6SyntheticRole(client, owner, [
      ['case.archive', 'SELF'],
      ['case.external-entry.create', 'SELF'],
      ['case.hearing.schedule', 'SELF'],
      ['customer.read', 'DEPARTMENT'],
    ]);
    const before = (
      await client.query('SELECT * FROM cases WHERE id=$1', [source.caseId])
    ).rows[0];
    const sourceEvidence = (
      await client.query(
        `SELECT
          (SELECT to_jsonb(e) FROM case_external_entries e WHERE id=$1) AS entry,
          (SELECT to_jsonb(r) FROM case_external_entry_receipts r WHERE id=$2) AS receipt`,
        [source.entryId, source.receiptId],
      )
    ).rows[0];
    const database = v6ScopedPrisma(schema);
    try {
      const { AccessControlService } = requireBackend(
        resolve(root, 'backend/dist/access-control/access-control.service.js'),
      );
      const { PrismaAccessControlStore } = requireBackend(
        resolve(
          root,
          'backend/dist/access-control/prisma-access-control.store.js',
        ),
      );
      const { CaseEarlyArchiveService } = requireBackend(
        resolve(
          root,
          'backend/dist/modules/cases/case-early-archive.service.js',
        ),
      );
      const { CaseBatchArchiveService } = requireBackend(
        resolve(
          root,
          'backend/dist/modules/cases/case-batch-archive.service.js',
        ),
      );
      const { CaseHearingService } = requireBackend(
        resolve(root, 'backend/dist/modules/cases/case-hearing.service.js'),
      );
      const { CaseExternalEntryService } = requireBackend(
        resolve(
          root,
          'backend/dist/modules/cases/case-external-entry.service.js',
        ),
      );
      const { CustomerCaseEntrySourceService } = requireBackend(
        resolve(
          root,
          'backend/dist/modules/customers/customer-case-entry-source.service.js',
        ),
      );
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const service = new CaseEarlyArchiveService(database, access);
      const batch = new CaseBatchArchiveService(database, access, service);
      const actor = {
        userId: owner.actorUserId,
        departmentId: owner.departmentId,
        authorizationRevision: 1,
      };
      const archiveAt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const input = {
        expectedVersion: before.version,
        idempotencyKey: 'v6-early-archive-once',
        archiveAt,
        reason: '合成案件停止后续诉讼办理',
      };
      await client.query(`CREATE FUNCTION v6_fail_early_receipt() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'
        USING ERRCODE='23514'; END $$`);
      await client.query(`CREATE TRIGGER v6_fail_early_receipt
        BEFORE INSERT ON case_early_archive_receipts FOR EACH ROW
        EXECUTE FUNCTION v6_fail_early_receipt()`);
      let injectedError;
      try {
        await service.archive(actor, source.caseId, input);
      } catch (error) {
        injectedError = error;
      }
      assert(injectedError, 'Late receipt failure unexpectedly committed');
      const failedRows = (
        await client.query(
          `SELECT
            (SELECT count(*)::int FROM case_early_archives WHERE case_id=$1) AS facts,
            (SELECT count(*)::int FROM case_early_archive_receipts WHERE case_id=$1) AS receipts,
            (SELECT count(*)::int FROM audit_events WHERE resource_id=$1 AND action='case.early_archived') AS audits,
            (SELECT version FROM cases WHERE id=$1) AS version`,
          [source.caseId],
        )
      ).rows[0];
      assert(
        failedRows.facts === 0 &&
          failedRows.receipts === 0 &&
          failedRows.audits === 0 &&
          failedRows.version === before.version,
        'Late failure left a partial early archive',
      );
      await client.query(
        'DROP TRIGGER v6_fail_early_receipt ON case_early_archive_receipts',
      );
      await client.query('DROP FUNCTION v6_fail_early_receipt()');
      const result = await service.archive(actor, source.caseId, input);
      assert(
        result.id === source.caseId &&
          result.fromStage === 'PENDING_MATCH' &&
          result.stage === 'ARCHIVED' &&
          result.version === before.version + 1,
        'Early archive result changed source or stage',
      );
      const replay = await service.archive(actor, source.caseId, input);
      assert(
        JSON.stringify(replay) === JSON.stringify(result),
        'Replay drifted',
      );
      const simultaneous = await Promise.all([
        service.archive(actor, concurrentSource.caseId, {
          ...input,
          idempotencyKey: 'v6-early-archive-concurrent',
        }),
        service.archive(actor, concurrentSource.caseId, {
          ...input,
          idempotencyKey: 'v6-early-archive-concurrent',
        }),
      ]);
      assert(
        JSON.stringify(simultaneous[0]) === JSON.stringify(simultaneous[1]),
        'Concurrent replay did not converge on one receipt',
      );
      const batchInput = {
        idempotencyKey: 'v6-early-batch-once',
        archiveAt,
        reason: '合成批次提前归档',
        items: [
          { id: batchSource.caseId, expectedVersion: 1 },
          { id: source.caseId, expectedVersion: before.version },
          { id: randomUUID(), expectedVersion: 1 },
        ],
      };
      const batchResult = await batch.archive(actor, batchInput);
      assert(
        batchResult.items[0]?.status === 'SUCCEEDED' &&
          batchResult.items[1]?.status === 'FAILED' &&
          batchResult.items[2]?.status === 'FAILED',
        'Batch did not report mixed per-case results',
      );
      const batchReplay = await batch.archive(actor, batchInput);
      assert(
        JSON.stringify(batchReplay) === JSON.stringify(batchResult),
        'Batch replay changed its per-case results',
      );
      const external = new CaseExternalEntryService(
        database,
        access,
        new CustomerCaseEntrySourceService(database, access),
      );
      const hearing = new CaseHearingService(
        database,
        access,
        { wake() {} },
        { now: () => new Date() },
      );
      const hearingCase = await external.create(actor, {
        idempotencyKey: 'v6-hearing-race-source',
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'WAITING_HEARING',
        stageReachedOn: '2026-10-25',
        source: '合成外部移交',
        reason: '进入开庭阶段的历史案件',
        customerId: owner.customerId,
        rightsHolderId: owner.rightsHolderId,
        defendants: [],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      });
      const scheduled = await hearing.schedule(actor, hearingCase.id, {
        expectedVersion: 1,
        idempotencyKey: 'v6-hearing-race-schedule',
        hearingAt: '2026-10-25',
      });
      assert(
        scheduled.stage === 'WAITING_HEARING' && scheduled.version === 2,
        'Synthetic external hearing was not legally scheduled',
      );
      const monitor = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await monitor.connect();
      const lockerPid = (await client.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid;
      let raceOutcomes;
      let overlapObserved = false;
      let maxWaiters = 0;
      try {
        await client.query('BEGIN');
        try {
          await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [
            hearingCase.id,
          ]);
          const archivePromise = service.archive(actor, hearingCase.id, {
            expectedVersion: 2,
            idempotencyKey: 'v6-hearing-race-archive',
            archiveAt,
            reason: '与到期自动推进竞争的合成提前归档',
          });
          const advancePromise = hearing.advanceDue(new Date());
          raceOutcomes = Promise.allSettled([archivePromise, advancePromise]);
          for (let attempt = 0; attempt < 100; attempt++) {
            const waiters = (
              await monitor.query(
                `SELECT pid, pg_blocking_pids(pid) AS blockers
                FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                  AND query LIKE '%cases%' AND query ILIKE '%FOR UPDATE%'`,
              )
            ).rows;
            const blockersByPid = new Map(
              waiters.map((waiter) => [waiter.pid, waiter.blockers]),
            );
            const reachesLocker = (pid, visited = new Set()) => {
              if (visited.has(pid)) return false;
              visited.add(pid);
              return (blockersByPid.get(pid) ?? []).some(
                (blocker) =>
                  blocker === lockerPid || reachesLocker(blocker, visited),
              );
            };
            const waiting = waiters.filter((waiter) =>
              reachesLocker(waiter.pid),
            ).length;
            maxWaiters = Math.max(maxWaiters, waiting);
            if (waiting >= 2) {
              overlapObserved = true;
              break;
            }
            await delay(25);
          }
        } finally {
          await client.query('COMMIT');
        }
      } finally {
        await monitor.end();
      }
      const [archiveOutcome, advanceOutcome] = await raceOutcomes;
      assert(
        overlapObserved,
        `Archive and scheduler did not both wait on one real case lock (maxWaiters=${maxWaiters})`,
      );
      assert(
        advanceOutcome.status === 'fulfilled',
        'Scheduler invocation failed',
      );
      const raceState = (
        await client.query(
          `SELECT
            (SELECT stage FROM cases WHERE id=$1) AS stage,
            (SELECT version FROM cases WHERE id=$1) AS version,
            (SELECT count(*)::int FROM case_early_archives WHERE case_id=$1) AS archives,
            (SELECT count(*)::int FROM case_early_archive_receipts WHERE case_id=$1) AS receipts,
            (SELECT count(*)::int FROM case_hearing_advances WHERE case_id=$1) AS advances,
            (SELECT count(*)::int FROM audit_events WHERE resource_id=$1
              AND action IN ('case.early_archived','case.hearing.auto_advanced')) AS actions`,
          [hearingCase.id],
        )
      ).rows[0];
      assert(
        raceState.version === 3 && raceState.actions === 1,
        'Race committed both terminal actions or skipped the case version',
      );
      if (raceState.stage === 'ARCHIVED') {
        assert(
          archiveOutcome.status === 'fulfilled' &&
            raceState.archives === 1 &&
            raceState.receipts === 1 &&
            raceState.advances === 0 &&
            advanceOutcome.value.advanced === 0,
          'Scheduler advanced a case after early archive won',
        );
      } else {
        assert(
          raceState.stage === 'WAITING_JUDGMENT' &&
            archiveOutcome.status === 'rejected' &&
            raceState.archives === 0 &&
            raceState.receipts === 0 &&
            raceState.advances === 1 &&
            advanceOutcome.value.advanced === 1,
          'Archive committed after the due hearing advance won',
        );
      }
      await expectCode(
        () =>
          service.archive(actor, source.caseId, {
            ...input,
            reason: '不同请求',
          }),
        'IDEMPOTENCY_CONFLICT',
      );
      await expectCode(
        () =>
          service.archive(
            { ...actor, departmentId: randomUUID() },
            source.caseId,
            input,
          ),
        'CASE_NOT_FOUND',
      );
      await expectCode(
        () =>
          service.archive(
            { ...actor, clientCustomerId: owner.customerId },
            source.caseId,
            input,
          ),
        'ACTION_FORBIDDEN',
      );
      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1 AND action='case.archive'`,
        [roleId],
      );
      await expectCode(
        () => service.archive(actor, source.caseId, input),
        'ACTION_FORBIDDEN',
      );
    } finally {
      await database.$disconnect();
    }

    const after = (
      await client.query('SELECT * FROM cases WHERE id=$1', [source.caseId])
    ).rows[0];
    const counts = (
      await client.query(
        `SELECT
          (SELECT count(*)::int FROM case_early_archives WHERE case_id=$1) AS facts,
          (SELECT count(*)::int FROM case_early_archive_receipts WHERE case_id=$1) AS receipts,
          (SELECT count(*)::int FROM case_archives WHERE case_id=$1) AS normal_archives,
          (SELECT count(*)::int FROM case_closures WHERE case_id=$1) AS closures,
          (SELECT count(*)::int FROM audit_events WHERE resource_id=$1 AND action='case.early_archived') AS audits`,
        [source.caseId],
      )
    ).rows[0];
    assert(
      counts.facts === 1 &&
        counts.receipts === 1 &&
        counts.audits === 1 &&
        counts.normal_archives === 0 &&
        counts.closures === 0,
      'Early archive produced wrong persisted fact cardinality',
    );
    assert(
      after.stage === 'ARCHIVED' &&
        after.version === before.version + 1 &&
        after.business_no === before.business_no &&
        after.source_lead_id === before.source_lead_id,
      'Early archive changed immutable case source',
    );
    const afterEvidence = (
      await client.query(
        `SELECT
          (SELECT to_jsonb(e) FROM case_external_entries e WHERE id=$1) AS entry,
          (SELECT to_jsonb(r) FROM case_external_entry_receipts r WHERE id=$2) AS receipt`,
        [source.entryId, source.receiptId],
      )
    ).rows[0];
    assert(
      JSON.stringify(afterEvidence) === JSON.stringify(sourceEvidence),
      'Original external entry evidence changed',
    );
    await client.query('BEGIN');
    let litigationError;
    try {
      await client.query(
        `INSERT INTO case_trial_rounds(id,case_id,department_id,sequence)
         VALUES($1,$2,$3,1)`,
        [randomUUID(), source.caseId, owner.departmentId],
      );
    } catch (error) {
      litigationError = error;
    } finally {
      await client.query('ROLLBACK');
    }
    assert(
      litigationError?.code === '23514' &&
        litigationError.message.includes('litigation fact cannot change'),
      'Archived case accepted a new litigation fact',
    );
    return {
      checks: [
        'real external case archives once with exact fact, receipt and audit',
        'late receipt failure rolls back and retry succeeds; concurrent replay converges',
        'mixed batch reports each result and replays without duplicate writes',
        'real scheduled hearing and early archive compete on one case lock; one terminal action persists',
        'source and old external receipt remain unchanged',
        'same-key replay, cross-department, external principal and revoked grant are enforced',
        'new litigation fact is rejected after archive',
      ],
    };
  });
}
