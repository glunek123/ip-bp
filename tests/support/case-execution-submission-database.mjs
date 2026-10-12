import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { verifyCaseJudgmentDatabase } from './case-judgment-database.mjs';

const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { AccessControlService } = requireBackend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = requireBackend(
  './dist/access-control/prisma-access-control.store.js',
);
const { CaseJudgmentNextStepService } = requireBackend(
  './dist/modules/cases/case-judgment-next-step.service.js',
);
const { CaseSecondInstanceService } = requireBackend(
  './dist/modules/cases/case-second-instance.service.js',
);
const { CaseExecutionSubmissionService } = requireBackend(
  './dist/modules/cases/case-execution-submission.service.js',
);
const { CaseReadService } = requireBackend(
  './dist/modules/cases/case-read.service.js',
);

async function sqlCode(client, statement, values) {
  await client.query('BEGIN');
  try {
    await client.query(statement, values);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    return null;
  } catch (error) {
    return error.code ?? null;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function submissionSnapshot(client, caseId) {
  const row = (
    await client.query(
      `SELECT c.stage,c.version,c.current_execution_submission_id,
    (SELECT count(*)::int FROM case_execution_submissions WHERE case_id=c.id) AS facts,
    (SELECT count(*)::int FROM case_execution_submission_receipts WHERE case_id=c.id) AS receipts,
    (SELECT count(*)::int FROM audit_events WHERE resource_type='CASE' AND resource_id=c.id
      AND action='case.execution.submitted') AS audits,
    (SELECT count(*)::int FROM material_references WHERE resource_type='case' AND resource_id=c.id
      AND purpose='EXECUTION_APPLICATION') AS references
    FROM cases c WHERE c.id=$1`,
      [caseId],
    )
  ).rows[0];
  return JSON.stringify(row);
}

async function verifyFailureRollback(
  client,
  submissionService,
  actor,
  caseId,
  input,
) {
  const before = await submissionSnapshot(client, caseId);
  for (const [table, condition] of [
    ['audit_events', `NEW.action = 'case.execution.submitted'`],
    ['case_execution_submissions', 'true'],
    ['material_references', `NEW.purpose = 'EXECUTION_APPLICATION'`],
    ['case_execution_submission_receipts', 'true'],
  ]) {
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `ca011_fault_${suffix}`;
    const triggerName = `ca011_fault_${suffix}`;
    await client.query(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF ${condition} THEN RAISE EXCEPTION 'ca011 injected fault' USING ERRCODE='23514';
      END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    let rejected = false;
    try {
      await submissionService.submit(actor, caseId, {
        ...input,
        idempotencyKey: `ca011-fault-${table}-${caseId}`,
      });
    } catch (error) {
      rejected = String(error.message).includes('ca011 injected fault');
    } finally {
      await client.query(`DROP TRIGGER "${triggerName}" ON "${table}"`);
      await client.query(`DROP FUNCTION "${functionName}"()`);
    }
    if (!rejected || (await submissionSnapshot(client, caseId)) !== before)
      return false;
  }
  return true;
}

async function upload(
  materials,
  actor,
  caseId,
  database,
  trackStorageKey,
  suffix,
  category = 'EXECUTION_APPLICATION',
) {
  const draft = await materials.createUploadDraft(actor, {
    ownerType: 'CASE',
    ownerId: caseId,
    category,
    purpose: category,
    originalFilename: `execution-${suffix}.pdf`,
    declaredMimeType: 'application/pdf',
  });
  const bytes = Buffer.from(`%PDF-1.7\nCA011 execution ${suffix}\n%%EOF\n`);
  const file = await materials.finalizeUpload(
    actor,
    draft.id,
    Readable.from(bytes),
  );
  const row = await database.contentVersion.findUnique({
    where: { id: file.contentVersionId },
    select: { storageKey: true },
  });
  trackStorageKey(row.storageKey);
  return { ...file, bytes };
}

export async function verifyExecutionAppealSource(
  resultKind,
  raceWithRevocation,
) {
  return verifyCaseJudgmentDatabase({
    afterRegistration: async ({
      actor,
      roleId,
      caseId,
      judgmentId,
      materials,
      database,
      client,
      trackStorageKey,
    }) => {
      for (const action of [
        'case.judgment.next_step',
        'case.second_instance.save',
        'case.second_instance.result',
        'case.second_instance.result.revoke',
        'case.execution.submit',
      ])
        await client.query(
          `INSERT INTO role_grants(id,role_template_id,action,scope)
          VALUES ($1,$2,$3,'DEPARTMENT') ON CONFLICT DO NOTHING`,
          [randomUUID(), roleId, action],
        );
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const choiceService = new CaseJudgmentNextStepService(database, access);
      const second = new CaseSecondInstanceService(database, access, materials);
      const execution = new CaseExecutionSubmissionService(
        database,
        access,
        materials,
      );
      const choice = await choiceService.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: `ca011-appeal-choice-${caseId}`,
        judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      });
      const anchor = await database.case.findUnique({
        where: { id: caseId },
        select: { currentTrialRoundId: true },
      });
      const progressFile = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'appeal-progress',
        'SECOND_INSTANCE_DOCUMENT',
      );
      const resultFile = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'appeal-result',
        'SECOND_INSTANCE_JUDGMENT',
      );
      const progress = {
        hearingAt: null,
        hearingPlace: '北京一中院',
        judgeName: null,
        documentContentVersionIds: [progressFile.contentVersionId],
        serviceContentVersionIds: [],
      };
      const saved = await second.save(actor, caseId, {
        expectedVersion: 11,
        idempotencyKey: `ca011-appeal-save-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        choiceId: choice.choiceId,
        expectedProgressId: null,
        progress,
      });
      const result = await second.registerResult(actor, caseId, {
        expectedVersion: 12,
        idempotencyKey: `ca011-appeal-result-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        choiceId: choice.choiceId,
        expectedProgressId: saved.progressId,
        progress,
        result: resultKind,
        resultReceivedAt: '2026-10-08',
        judgmentContentVersionIds: [resultFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
        ...(resultKind === 'CHANGE'
          ? { judgmentAmount: { state: 'KNOWN', amount: '80' } }
          : {}),
      });
      if (resultKind === 'REMAND') {
        let remandRejected = null;
        try {
          await execution.submit(actor, caseId, {
            expectedVersion: 13,
            idempotencyKey: `ca011-remand-reject-${caseId}`,
            trialRoundId: anchor.currentTrialRoundId,
            judgmentNextStepId: choice.choiceId,
            secondInstanceResultId: result.resultId,
            expectedSubmissionId: null,
            executionApplicationContentVersionIds: [
              resultFile.contentVersionId,
            ],
          });
        } catch (error) {
          remandRejected = error.response?.code ?? null;
        }
        return {
          remandRejected,
          noFact:
            (await database.caseExecutionSubmission.count({
              where: { caseId },
            })) === 0,
        };
      }
      const application = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'appeal-application',
      );
      const input = {
        expectedVersion: 13,
        idempotencyKey: `ca011-appeal-execution-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        judgmentNextStepId: choice.choiceId,
        secondInstanceResultId: result.resultId,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [application.contentVersionId],
      };
      let badSourcesRejected = true;
      for (const override of [
        { trialRoundId: randomUUID() },
        { judgmentNextStepId: randomUUID() },
        { secondInstanceResultId: randomUUID() },
        { secondInstanceResultId: null },
      ]) {
        let code = null;
        try {
          await execution.submit(actor, caseId, {
            ...input,
            ...override,
            idempotencyKey: `ca011-bad-source-${randomUUID()}`,
          });
        } catch (error) {
          code = error.response?.code ?? null;
        }
        badSourcesRejected &&= code === 'INVALID_STATE';
      }
      badSourcesRejected &&=
        (await database.caseExecutionSubmission.count({
          where: { caseId },
        })) === 0;
      const revokeInput = {
        expectedVersion: 13,
        idempotencyKey: `ca011-appeal-revoke-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        resultId: result.resultId,
        reason: '并发撤销验证',
      };
      if (raceWithRevocation) {
        const attempts = await Promise.allSettled([
          execution.submit(actor, caseId, input),
          second.revokeResult(actor, caseId, revokeInput),
        ]);
        const state = await database.case.findUnique({
          where: { id: caseId },
          select: {
            stage: true,
            version: true,
            currentExecutionSubmissionId: true,
            currentSecondInstanceResultId: true,
          },
        });
        const count = await database.caseExecutionSubmission.count({
          where: { caseId },
        });
        return {
          badSourcesRejected,
          raceSingleWinner:
            attempts.filter((item) => item.status === 'fulfilled').length ===
              1 &&
            attempts.filter((item) => item.status === 'rejected').length ===
              1 &&
            state.version === 14 &&
            ((count === 1 &&
              state.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
              state.currentExecutionSubmissionId !== null &&
              state.currentSecondInstanceResultId === result.resultId) ||
              (count === 0 &&
                state.stage === 'SECOND_INSTANCE' &&
                state.currentExecutionSubmissionId === null &&
                state.currentSecondInstanceResultId === null)),
        };
      }
      const submitted = await execution.submit(actor, caseId, input);
      let serviceBlocked = null;
      try {
        await second.revokeResult(actor, caseId, {
          ...revokeInput,
          expectedVersion: 14,
        });
      } catch (error) {
        serviceBlocked = error.response?.code ?? null;
      }
      const sqlBlocked = await sqlCode(
        client,
        `INSERT INTO case_second_instance_result_revocations(id,result_id,case_id,
          department_id,reason,from_version,to_version,recorded_by_user_id,audit_event_id)
         VALUES ($1,$2,$3,$4,'绕过接口',14,15,$5,$6)`,
        [
          randomUUID(),
          result.resultId,
          caseId,
          actor.departmentId,
          actor.userId,
          randomUUID(),
        ],
      );
      const stored = await database.caseExecutionSubmission.findUnique({
        where: { id: submitted.submissionId },
        select: {
          secondInstanceResultId: true,
          judgmentNextStepId: true,
          trialRoundId: true,
        },
      });
      return {
        badSourcesRejected,
        accepted:
          submitted.version === 14 &&
          submitted.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
          stored.secondInstanceResultId === result.resultId &&
          stored.judgmentNextStepId === choice.choiceId &&
          stored.trialRoundId === anchor.currentTrialRoundId,
        serviceBlocked,
        sqlBlocked,
      };
    },
  });
}

export async function verifyDirectExecutionChoiceRace() {
  return verifyCaseJudgmentDatabase({
    afterRegistration: async ({
      actor,
      roleId,
      caseId,
      judgmentId,
      materials,
      database,
      client,
      trackStorageKey,
    }) => {
      for (const action of [
        'case.judgment.next_step',
        'case.judgment.next_step.revoke',
        'case.execution.submit',
      ])
        await client.query(
          `INSERT INTO role_grants(id,role_template_id,action,scope)
          VALUES ($1,$2,$3,'DEPARTMENT') ON CONFLICT DO NOTHING`,
          [randomUUID(), roleId, action],
        );
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const choiceService = new CaseJudgmentNextStepService(database, access);
      const execution = new CaseExecutionSubmissionService(
        database,
        access,
        materials,
      );
      const choice = await choiceService.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: `ca011-direct-race-choice-${caseId}`,
        judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      });
      const anchor = await database.case.findUnique({
        where: { id: caseId },
        select: { currentTrialRoundId: true },
      });
      const application = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'direct-race',
      );
      const attempts = await Promise.allSettled([
        execution.submit(actor, caseId, {
          expectedVersion: 11,
          idempotencyKey: `ca011-direct-race-submit-${caseId}`,
          trialRoundId: anchor.currentTrialRoundId,
          judgmentNextStepId: choice.choiceId,
          secondInstanceResultId: null,
          expectedSubmissionId: null,
          executionApplicationContentVersionIds: [application.contentVersionId],
        }),
        choiceService.revoke(actor, caseId, {
          expectedVersion: 11,
          idempotencyKey: `ca011-direct-race-revoke-${caseId}`,
          choiceId: choice.choiceId,
          reason: '并发撤销验证',
        }),
      ]);
      const state = await database.case.findUnique({
        where: { id: caseId },
        select: {
          stage: true,
          version: true,
          currentJudgmentNextStepId: true,
          currentExecutionSubmissionId: true,
        },
      });
      const count = await database.caseExecutionSubmission.count({
        where: { caseId },
      });
      return {
        raceSingleWinner:
          attempts.filter((item) => item.status === 'fulfilled').length === 1 &&
          attempts.filter((item) => item.status === 'rejected').length === 1 &&
          state.version === 12 &&
          ((count === 1 &&
            state.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
            state.currentJudgmentNextStepId === choice.choiceId &&
            state.currentExecutionSubmissionId !== null) ||
            (count === 0 &&
              state.stage === 'WAITING_JUDGMENT' &&
              state.currentJudgmentNextStepId === null &&
              state.currentExecutionSubmissionId === null)),
      };
    },
  });
}

async function seedReadableSource(
  client,
  database,
  actor,
  caseId,
  trackExtraUserId,
) {
  const source = await database.case.findUnique({
    where: { id: caseId },
    select: {
      sourceLeadId: true,
      sourceNotaryMatterId: true,
      certificateId: true,
      customerId: true,
      rightsHolderId: true,
    },
  });
  const lawyerId = randomUUID();
  const lawyerProfileId = randomUUID();
  trackExtraUserId(lawyerId);
  await client.query('BEGIN');
  try {
    // The older judgment fixture uses detached source IDs. Complete only its
    // read relations, retaining the existing synthetic case and real commands.
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,
      rights_holder_id,responsible_user_id,case_type,source,platform,found_at,shop_name,
      need_disclose,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',now(),'CA011 source',false,now())`,
      [
        source.sourceLeadId,
        actor.departmentId,
        `CA010-lead-${caseId}`,
        source.customerId,
        source.rightsHolderId,
        actor.userId,
      ],
    );
    await client.query(
      `INSERT INTO notary_matters(id,business_no,department_id,
      source_lead_id,customer_id,rights_holder_id,responsible_user_id,
      notary_office_id,evidence_mode,batch_purpose,source_snapshot,
      created_by_user_id,from_lead_version,to_lead_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ONLINE_PURCHASE','CA011 test','{}'::jsonb,$7,1,2)`,
      [
        source.sourceNotaryMatterId,
        `CA010-matter-${caseId}`,
        actor.departmentId,
        source.sourceLeadId,
        source.customerId,
        source.rightsHolderId,
        actor.userId,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO notary_certificates(id,matter_id,department_id,
      issuance_decision_id,notary_office_account_binding_id,actor_user_id,
      certificate_no,certificate_date,need_disclose,from_version,to_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-10-01',false,1,2)`,
      [
        source.certificateId,
        source.sourceNotaryMatterId,
        actor.departmentId,
        randomUUID(),
        randomUUID(),
        actor.userId,
        `CA010-cert-${caseId}`,
      ],
    );
    await client.query(
      `INSERT INTO user_accounts(id,external_subject,display_name,
      account_type,updated_at) VALUES ($1,$2,'CA011 lawyer','LAWYER',now())`,
      [lawyerId, `ca011-lawyer-${lawyerId}`],
    );
    await client.query(
      `INSERT INTO lawyer_profiles(id,department_id,bound_user_id,
      full_name) VALUES ($1,$2,$3,'CA011 lawyer')`,
      [lawyerProfileId, actor.departmentId, lawyerId],
    );
    await client.query(
      `INSERT INTO lawyer_account_bindings(id,user_id,department_id,
      profile_id,updated_at) VALUES ($1,$2,$3,$4,now())`,
      [randomUUID(), lawyerId, actor.departmentId, lawyerProfileId],
    );
    await client.query(
      `INSERT INTO case_lawyer_assignments(id,case_id,department_id,
      lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',now())`,
      [randomUUID(), caseId, actor.departmentId, lawyerProfileId],
    );
    await client.query('COMMIT');
    return {
      userId: lawyerId,
      lawyerAccountId: lawyerId,
      departmentId: actor.departmentId,
      authorizationRevision: 1,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function verifyCaseExecutionSubmissionDatabase() {
  return verifyCaseJudgmentDatabase({
    afterRegistration: async ({
      actor,
      roleId,
      caseId,
      judgmentId,
      materials,
      database,
      client,
      trackStorageKey,
      trackExtraUserId,
    }) => {
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES ($1,$2,'case.judgment.next_step','DEPARTMENT'),
               ($3,$2,'case.judgment.next_step.revoke','DEPARTMENT'),
               ($4,$2,'case.execution.submit','DEPARTMENT') ON CONFLICT DO NOTHING`,
        [randomUUID(), roleId, randomUUID(), randomUUID()],
      );
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const choiceService = new CaseJudgmentNextStepService(database, access);
      const submissionService = new CaseExecutionSubmissionService(
        database,
        access,
        materials,
      );
      const reader = new CaseReadService(database, access, materials);
      const choice = await choiceService.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: `ca011-choice-${caseId}`,
        judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      });
      const lawyerActor = await seedReadableSource(
        client,
        database,
        actor,
        caseId,
        trackExtraUserId,
      );
      const anchors = await database.case.findUnique({
        where: { id: caseId },
        select: { currentTrialRoundId: true, currentJudgmentNextStepId: true },
      });
      if (
        choice.stage !== 'WAITING_EXECUTION_DOCUMENTS' ||
        choice.version !== 11 ||
        !anchors.currentTrialRoundId ||
        anchors.currentJudgmentNextStepId !== choice.choiceId
      )
        throw new Error('Execution fixture did not enter exact source stage');
      const uploaded = [];
      for (const suffix of ['a', 'b', 'c'])
        uploaded.push(
          await upload(
            materials,
            actor,
            caseId,
            database,
            trackStorageKey,
            suffix,
          ),
        );
      const [a, b, c] = uploaded;
      const firstInput = {
        expectedVersion: 11,
        idempotencyKey: `ca011-first-${caseId}`,
        trialRoundId: anchors.currentTrialRoundId,
        judgmentNextStepId: choice.choiceId,
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [
          a.contentVersionId,
          b.contentVersionId,
        ],
      };
      const faultRollbacks = await verifyFailureRollback(
        client,
        submissionService,
        actor,
        caseId,
        firstInput,
      );
      const raceInputs = [
        firstInput,
        { ...firstInput, idempotencyKey: `ca011-first-race-${caseId}` },
      ];
      const race = await Promise.allSettled(
        raceInputs.map((input) =>
          submissionService.submit(actor, caseId, input),
        ),
      );
      const winner = race.findIndex((result) => result.status === 'fulfilled');
      const first = winner < 0 ? null : race[winner].value;
      const firstReplay =
        first === null
          ? null
          : await submissionService.submit(actor, caseId, raceInputs[winner]);
      const concurrentSingleWinner =
        first !== null &&
        race.filter((result) => result.status === 'fulfilled').length === 1 &&
        race.filter((result) => result.status === 'rejected').length === 1;
      if (first === null)
        throw new Error('Neither concurrent execution submission succeeded');
      let changedKey = null;
      try {
        await submissionService.submit(actor, caseId, {
          ...raceInputs[winner],
          executionApplicationContentVersionIds: [c.contentVersionId],
        });
      } catch (error) {
        changedKey = error.response?.code ?? null;
      }
      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1
        AND action='case.execution.submit'`,
        [roleId],
      );
      let revokedReplay = null;
      try {
        await submissionService.submit(actor, caseId, raceInputs[winner]);
      } catch (error) {
        revokedReplay = error.response?.code ?? null;
      }
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES ($1,$2,'case.execution.submit','DEPARTMENT')`,
        [randomUUID(), roleId],
      );
      const firstRead = await reader.get(actor, caseId);
      const firstLawyerRead = await reader.get(lawyerActor, caseId);
      const resubmitInput = {
        ...firstInput,
        expectedVersion: 12,
        idempotencyKey: `ca011-resubmit-${caseId}`,
        expectedSubmissionId: first.submissionId,
        changeReason: '补充新的执行申请材料',
        executionApplicationContentVersionIds: [
          b.contentVersionId,
          c.contentVersionId,
        ],
      };
      const second = await submissionService.submit(
        lawyerActor,
        caseId,
        resubmitInput,
      );
      const secondReplay = await submissionService.submit(
        lawyerActor,
        caseId,
        resubmitInput,
      );
      const secondFact = await database.caseExecutionSubmission.findUnique({
        where: { id: second.submissionId },
        select: {
          submittedByUserId: true,
          auditEvent: {
            select: { lawyerAccountBindingId: true, internalActorUserId: true },
          },
        },
      });
      await database.lawyerAccountBinding.updateMany({
        where: { userId: lawyerActor.userId, departmentId: actor.departmentId },
        data: { active: false },
      });
      let lawyerRevokedReplay = null;
      try {
        await submissionService.submit(lawyerActor, caseId, resubmitInput);
      } catch (error) {
        lawyerRevokedReplay = error.response?.code ?? null;
      }
      await database.lawyerAccountBinding.updateMany({
        where: { userId: lawyerActor.userId, departmentId: actor.departmentId },
        data: { active: true },
      });
      await client.query(
        `UPDATE case_lawyer_assignments SET ended_at=now()
        WHERE case_id=$1 AND lawyer_id=(SELECT profile_id FROM lawyer_account_bindings
          WHERE user_id=$2 AND department_id=$3)`,
        [caseId, lawyerActor.userId, actor.departmentId],
      );
      let lawyerAssignmentRevokedReplay = null;
      try {
        await submissionService.submit(lawyerActor, caseId, resubmitInput);
      } catch (error) {
        lawyerAssignmentRevokedReplay = error.response?.code ?? null;
      }
      await client.query(
        `UPDATE case_lawyer_assignments SET ended_at=NULL
        WHERE case_id=$1 AND lawyer_id=(SELECT profile_id FROM lawyer_account_bindings
          WHERE user_id=$2 AND department_id=$3)`,
        [caseId, lawyerActor.userId, actor.departmentId],
      );
      let staleAnchor = null;
      try {
        await submissionService.submit(lawyerActor, caseId, {
          ...resubmitInput,
          expectedVersion: 13,
          idempotencyKey: `ca011-stale-anchor-${caseId}`,
          expectedSubmissionId: first.submissionId,
          executionApplicationContentVersionIds: [a.contentVersionId],
        });
      } catch (error) {
        staleAnchor = error.response?.code ?? null;
      }
      let noChange = null;
      try {
        await submissionService.submit(lawyerActor, caseId, {
          ...resubmitInput,
          expectedVersion: 13,
          idempotencyKey: `ca011-unchanged-${caseId}`,
          expectedSubmissionId: second.submissionId,
          executionApplicationContentVersionIds: [
            c.contentVersionId,
            b.contentVersionId,
          ],
        });
      } catch (error) {
        noChange = error.response?.code ?? null;
      }
      const history = await reader.get(actor, caseId);
      const lawyerHistory = await reader.get(lawyerActor, caseId);
      let serviceChoiceBlocked = null;
      try {
        await choiceService.revoke(actor, caseId, {
          expectedVersion: 13,
          idempotencyKey: `ca011-choice-revoke-after-submit-${caseId}`,
          choiceId: choice.choiceId,
          reason: '执行提交后尝试撤销',
        });
      } catch (error) {
        serviceChoiceBlocked = error.response?.code ?? null;
      }
      const oldFrozen = await materials.openVersion(
        actor,
        a.materialId,
        a.contentVersionId,
      );
      const oldFrozenBytes = Buffer.concat(
        await Array.fromAsync(oldFrozen.stream),
      );
      const blockedRevocation = await sqlCode(
        client,
        `INSERT INTO case_judgment_next_step_revocations(id,choice_id,case_id,department_id,
          reason,from_version,to_version,recorded_by_user_id,audit_event_id)
         VALUES ($1,$2,$3,$4,'绕过接口',13,14,$5,$6)`,
        [
          randomUUID(),
          choice.choiceId,
          caseId,
          actor.departmentId,
          actor.userId,
          randomUUID(),
        ],
      );
      const bypassStage = await sqlCode(
        client,
        `UPDATE cases SET stage='WAITING_EXECUTION_DOCUMENTS',version=version+1 WHERE id=$1`,
        [caseId],
      );
      const final = await database.case.findUnique({
        where: { id: caseId },
        select: {
          stage: true,
          version: true,
          currentExecutionSubmissionId: true,
        },
      });
      return {
        first:
          first.version === 12 &&
          first.stage === 'WAITING_EXECUTION_CONFIRMATION',
        concurrentSingleWinner,
        faultRollbacks,
        replay:
          isDeepStrictEqual(firstReplay, first) &&
          isDeepStrictEqual(secondReplay, second),
        revokedReplay,
        changedKey,
        firstRead:
          firstRead.executionSubmission.current?.id === first.submissionId &&
          firstRead.executionSubmission.submissions.length === 1 &&
          firstRead.executionSubmission.availableFiles.some(
            (file) => file.contentVersionId === c.contentVersionId,
          ),
        lawyerRead:
          firstLawyerRead.executionSubmission.current?.id ===
            first.submissionId &&
          firstLawyerRead.executionSubmission.submissions.length === 1 &&
          firstLawyerRead.canSubmitExecution === true &&
          !Object.hasOwn(firstLawyerRead, 'owner') &&
          !Object.hasOwn(firstLawyerRead, 'fees'),
        resubmitted:
          second.version === 13 && second.submissionId !== first.submissionId,
        lawyerSubmitted:
          secondFact.submittedByUserId === lawyerActor.userId &&
          secondFact.auditEvent.lawyerAccountBindingId !== null &&
          secondFact.auditEvent.internalActorUserId === null,
        lawyerRevokedReplay,
        lawyerAssignmentRevokedReplay,
        staleAnchor,
        noChange,
        serviceChoiceBlocked,
        history:
          history.executionSubmission.current?.id === second.submissionId &&
          history.executionSubmission.submissions.length === 2 &&
          history.executionSubmission.submissions[0]?.files.length === 2 &&
          history.executionSubmission.submissions[1]?.files.length === 2 &&
          history.executionSubmission.current.changeReason ===
            '补充新的执行申请材料',
        lawyerHistory:
          lawyerHistory.executionSubmission.current?.id ===
            second.submissionId &&
          lawyerHistory.executionSubmission.submissions.length === 2 &&
          lawyerHistory.canSubmitExecution === true,
        oldFrozenBytes:
          oldFrozenBytes.equals(a.bytes) &&
          !history.executionSubmission.availableFiles.some(
            (file) => file.contentVersionId === a.contentVersionId,
          ),
        blockedRevocation,
        bypassStage,
        final:
          final.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
          final.version === 13 &&
          final.currentExecutionSubmissionId === second.submissionId,
      };
    },
  });
}
