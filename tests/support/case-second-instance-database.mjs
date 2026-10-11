import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
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
const { CaseReadService } = requireBackend(
  './dist/modules/cases/case-read.service.js',
);
const { ClientCaseService } = requireBackend(
  './dist/modules/cases/client-case.service.js',
);

const progress = {
  hearingAt: null,
  hearingPlace: '北京一中院',
  judgeName: null,
  documentContentVersionIds: [],
  serviceContentVersionIds: [],
};

async function sqlCode(client, statement, values) {
  await client.query('BEGIN');
  try {
    await client.query(statement, values);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    return null;
  } catch (error) {
    return error.code;
  } finally {
    await client.query('ROLLBACK');
  }
}

export async function verifyCaseSecondInstanceDatabase() {
  return verifyCaseJudgmentDatabase({
    afterRegistration: async ({
      actor,
      roleId,
      caseId,
      judgmentId,
      materials,
      storage,
      database,
      client,
      registeredFiles,
      trackStorageKey,
      trackExtraUserId,
    }) => {
      for (const action of [
        'case.judgment.next_step',
        'case.second_instance.save',
        'case.second_instance.result',
        'case.second_instance.result.revoke',
      ]) {
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES ($1,$2,$3,'DEPARTMENT') ON CONFLICT DO NOTHING",
          [randomUUID(), roleId, action],
        );
      }
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const choiceService = new CaseJudgmentNextStepService(database, access);
      const second = new CaseSecondInstanceService(database, access, materials);
      const choice = await choiceService.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: `ca010-choice-${caseId}`,
        judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      });
      const anchor = await database.case.findUnique({
        where: { id: caseId },
        select: { currentTrialRoundId: true, currentJudgmentNextStepId: true },
      });
      if (
        choice.stage !== 'SECOND_INSTANCE' ||
        choice.version !== 11 ||
        !anchor.currentTrialRoundId
      )
        throw new Error('CA010 fixture failed to enter second instance');
      const draft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'SECOND_INSTANCE_JUDGMENT',
        purpose: 'SECOND_INSTANCE_JUDGMENT',
        originalFilename: 'ca010-result.pdf',
        declaredMimeType: 'application/pdf',
      });
      const file = await materials.finalizeUpload(
        actor,
        draft.id,
        Readable.from(Buffer.from('%PDF-1.7\nCA010 real result\n%%EOF\n')),
      );
      const stored = await database.contentVersion.findUnique({
        where: { id: file.contentVersionId },
        select: { storageKey: true },
      });
      trackStorageKey(stored.storageKey);
      const progressDraft = await materials.createUploadDraft(actor, {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'SECOND_INSTANCE_DOCUMENT',
        purpose: 'SECOND_INSTANCE_DOCUMENT',
        originalFilename: 'ca010-progress.pdf',
        declaredMimeType: 'application/pdf',
      });
      const progressBytes = Buffer.from(
        '%PDF-1.7\nCA010 real progress\n%%EOF\n',
      );
      const progressFile = await materials.finalizeUpload(
        actor,
        progressDraft.id,
        Readable.from(progressBytes),
      );
      const progressStored = await database.contentVersion.findUnique({
        where: { id: progressFile.contentVersionId },
        select: { storageKey: true },
      });
      trackStorageKey(progressStored.storageKey);
      const progressInput = {
        ...progress,
        documentContentVersionIds: [progressFile.contentVersionId],
      };
      const saveInput = {
        expectedVersion: 11,
        idempotencyKey: `ca010-save-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        choiceId: anchor.currentJudgmentNextStepId,
        expectedProgressId: null,
        progress: progressInput,
      };
      const saved = await second.save(actor, caseId, saveInput);
      const saveReplay = await second.save(actor, caseId, saveInput);
      let changedKey = null;
      try {
        await second.save(actor, caseId, {
          ...saveInput,
          progress: { ...progressInput, judgeName: '不同正文' },
        });
      } catch (error) {
        changedKey = error.response?.code ?? null;
      }
      const resultInput = {
        ...saveInput,
        expectedVersion: 12,
        expectedProgressId: saved.progressId,
        idempotencyKey: `ca010-remand-${caseId}`,
        result: 'REMAND',
        resultReceivedAt: '2026-10-08',
        judgmentContentVersionIds: [file.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      };
      const remand = await second.registerResult(actor, caseId, resultInput);
      const remandReplay = await second.registerResult(
        actor,
        caseId,
        resultInput,
      );
      let oldRound = null;
      try {
        await second.save(actor, caseId, {
          ...saveInput,
          expectedVersion: 13,
          idempotencyKey: 'old-round',
        });
      } catch (error) {
        oldRound = error.response?.code ?? null;
      }
      const remandCase = await database.case.findUnique({
        where: { id: caseId },
        select: {
          stage: true,
          currentTrialRoundId: true,
          currentAcceptanceId: true,
          currentJudgmentId: true,
          currentJudgmentNextStepId: true,
          courtCaseNo: true,
        },
      });
      const revoke = await second.revokeResult(actor, caseId, {
        expectedVersion: 13,
        idempotencyKey: `ca010-revoke-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        resultId: remand.resultId,
        reason: '结果误录',
      });
      const revokedChild = await database.caseTrialRound.findUnique({
        where: { id: remand.currentTrialRoundId },
        select: { revokedAt: true },
      });
      const restoredCase = await database.case.findUnique({
        where: { id: caseId },
        select: {
          stage: true,
          version: true,
          currentTrialRoundId: true,
          currentAcceptanceId: true,
          currentJudgmentId: true,
          currentJudgmentNextStepId: true,
          courtCaseNo: true,
        },
      });
      const revokedChildReactivation = await sqlCode(
        client,
        'UPDATE cases SET current_trial_round_id=$2 WHERE id=$1',
        [caseId, remand.currentTrialRoundId],
      );
      const bypassStage = await sqlCode(
        client,
        "UPDATE cases SET stage='WAITING_EXECUTION_DOCUMENTS',version=version+1 WHERE id=$1",
        [caseId],
      );
      const immutableResult = await sqlCode(
        client,
        'UPDATE case_second_instance_results SET result=result WHERE id=$1',
        [remand.resultId],
      );
      let wrongResultCategory = null;
      try {
        await second.registerResult(actor, caseId, {
          ...resultInput,
          expectedVersion: 14,
          expectedProgressId: saved.progressId,
          idempotencyKey: `ca010-wrong-category-${caseId}`,
          judgmentContentVersionIds: [progressFile.contentVersionId],
        });
      } catch (error) {
        wrongResultCategory = error.response?.code ?? null;
      }
      const beforeFailure = await database.caseSecondInstanceProgress.count({
        where: { caseId },
      });
      const fault = `ca010_receipt_fault_${randomUUID().replaceAll('-', '')}`;
      let faultRaised = false;
      try {
        await client.query(
          `CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected CA010 receipt failure'; END $$`,
        );
        await client.query(
          `CREATE TRIGGER "${fault}" BEFORE INSERT ON case_second_instance_receipts FOR EACH ROW EXECUTE FUNCTION "${fault}"()`,
        );
        try {
          await second.save(actor, caseId, {
            ...saveInput,
            expectedVersion: 14,
            expectedProgressId: saved.progressId,
            idempotencyKey: `ca010-fault-${caseId}`,
            progress: { ...progressInput, judgeName: '故障回滚' },
          });
        } catch (error) {
          faultRaised = error instanceof Error;
        }
      } finally {
        await client
          .query(
            `DROP TRIGGER IF EXISTS "${fault}" ON case_second_instance_receipts`,
          )
          .catch(() => undefined);
        await client
          .query(`DROP FUNCTION IF EXISTS "${fault}"()`)
          .catch(() => undefined);
      }
      const rollbackCase = await database.case.findUnique({
        where: { id: caseId },
        select: { version: true, currentSecondInstanceProgressId: true },
      });
      const rollbackFacts = await database.caseSecondInstanceProgress.count({
        where: { caseId },
      });
      const revisedProgress = { ...progressInput, judgeName: '再次开庭' };
      const revised = await second.save(actor, caseId, {
        ...saveInput,
        expectedVersion: 14,
        expectedProgressId: saved.progressId,
        idempotencyKey: `ca010-revise-${caseId}`,
        progress: revisedProgress,
      });
      const raceInput = {
        ...resultInput,
        expectedVersion: 15,
        expectedProgressId: revised.progressId,
        progress: revisedProgress,
        idempotencyKey: `ca010-race-a-${caseId}`,
        result: 'CHANGE',
        judgmentAmount: { state: 'KNOWN', amount: '0' },
      };
      const raced = await Promise.allSettled([
        second.registerResult(actor, caseId, raceInput),
        second.registerResult(actor, caseId, {
          ...raceInput,
          idempotencyKey: `ca010-race-b-${caseId}`,
        }),
      ]);
      const race = raced
        .map((item) =>
          item.status === 'fulfilled'
            ? `OK:${item.value.version}`
            : (item.reason.response?.code ?? 'UNKNOWN'),
        )
        .sort();
      const finalCase = await database.case.findUnique({
        where: { id: caseId },
        select: {
          stage: true,
          version: true,
          currentSecondInstanceResultId: true,
        },
      });
      const frozen = (
        await client.query(
          `SELECT purpose, count(*)::int AS n, count(DISTINCT action_event_id)::int AS audits
         FROM material_references WHERE resource_type='case' AND resource_id=$1
           AND content_version_id IN ($2,$3) AND purpose IN ('SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_JUDGMENT')
         GROUP BY purpose`,
          [caseId, file.contentVersionId, progressFile.contentVersionId],
        )
      ).rows;
      const openedProgress = await materials.openVersion(
        actor,
        progressFile.materialId,
        progressFile.contentVersionId,
      );
      const preservedProgressBytes = Buffer.concat(
        await Array.fromAsync(openedProgress.stream),
      ).equals(progressBytes);
      const referenceSql = `INSERT INTO material_references(id,department_id,resource_type,resource_id,purpose,material_id,content_version_id,action_event_id)
        VALUES ($1,$2,'case',$3,$4,$5,$6,$7)`;
      const secondResult = await database.caseSecondInstanceResult.findUnique({
        where: { id: finalCase.currentSecondInstanceResultId },
        select: { auditEventId: true },
      });
      const noAudit = await sqlCode(client, referenceSql, [
        randomUUID(),
        actor.departmentId,
        caseId,
        'SECOND_INSTANCE_JUDGMENT',
        file.materialId,
        file.contentVersionId,
        null,
      ]);
      const wrongCase = await sqlCode(client, referenceSql, [
        randomUUID(),
        actor.departmentId,
        randomUUID(),
        'SECOND_INSTANCE_JUDGMENT',
        file.materialId,
        file.contentVersionId,
        secondResult.auditEventId,
      ]);
      const wrongPurpose = await sqlCode(client, referenceSql, [
        randomUUID(),
        actor.departmentId,
        caseId,
        'SECOND_INSTANCE_DOCUMENT',
        file.materialId,
        file.contentVersionId,
        secondResult.auditEventId,
      ]);
      const wrongDepartment = await sqlCode(client, referenceSql, [
        randomUUID(),
        randomUUID(),
        caseId,
        'SECOND_INSTANCE_JUDGMENT',
        file.materialId,
        file.contentVersionId,
        secondResult.auditEventId,
      ]);
      const lawyerId = randomUUID();
      const lawyerProfileId = randomUUID();
      const clientId = randomUUID();
      trackExtraUserId(lawyerId);
      trackExtraUserId(clientId);
      const assignmentId = randomUUID();
      const source = await database.case.findUnique({
        where: { id: caseId },
        select: {
          customerId: true,
          rightsHolderId: true,
          sourceLeadId: true,
          sourceNotaryMatterId: true,
          certificateId: true,
        },
      });
      const customerId = source.customerId;
      const acceptanceMaterialId = randomUUID();
      const acceptanceVersionId = randomUUID();
      const acceptanceStorageKey = `ca010/${caseId}/acceptance-${randomUUID()}.pdf`;
      const acceptanceBytes = Buffer.from(
        '%PDF-1.7\nCA010 source acceptance\n%%EOF\n',
      );
      const acceptanceStored = await storage.put(
        acceptanceStorageKey,
        Readable.from(acceptanceBytes),
      );
      trackStorageKey(acceptanceStorageKey);
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL session_replication_role = replica');
        await client.query(
          "INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at) VALUES ($1,$2,'CASE',$3,'ACCEPTANCE_NOTICE','ACCEPTANCE_NOTICE',now())",
          [acceptanceMaterialId, actor.departmentId, caseId],
        );
        await client.query(
          "INSERT INTO content_versions(id,material_id,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by) VALUES ($1,$2,$3,'ca010-acceptance.pdf','application/pdf',$4,$5,$6)",
          [
            acceptanceVersionId,
            acceptanceMaterialId,
            acceptanceStorageKey,
            acceptanceStored.sizeBytes,
            acceptanceStored.sha256,
            actor.userId,
          ],
        );
        await client.query(
          'UPDATE materials SET current_version_id=$2 WHERE id=$1',
          [acceptanceMaterialId, acceptanceVersionId],
        );
        await client.query(
          "INSERT INTO case_acceptance_versions(acceptance_id,case_id,department_id,material_id,content_version_id,category) VALUES ($1,$2,$3,$4,$5,'ACCEPTANCE_NOTICE')",
          [
            restoredCase.currentAcceptanceId,
            caseId,
            actor.departmentId,
            acceptanceMaterialId,
            acceptanceVersionId,
          ],
        );
        await client.query(
          `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,responsible_user_id,
          case_type,source,platform,found_at,shop_name,need_disclose,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'CIVIL','ONLINE','TAOBAO',now(),'CA010 shop',false,now())`,
          [
            source.sourceLeadId,
            actor.departmentId,
            `CA010-lead-${caseId}`,
            customerId,
            source.rightsHolderId,
            actor.userId,
          ],
        );
        await client.query(
          `INSERT INTO notary_matters(id,business_no,department_id,source_lead_id,customer_id,rights_holder_id,
          responsible_user_id,notary_office_id,evidence_mode,batch_purpose,source_snapshot,created_by_user_id,from_lead_version,to_lead_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ONLINE_PURCHASE','CA010 test','{}'::jsonb,$7,1,2)`,
          [
            source.sourceNotaryMatterId,
            `CA010-matter-${caseId}`,
            actor.departmentId,
            source.sourceLeadId,
            customerId,
            source.rightsHolderId,
            actor.userId,
            randomUUID(),
          ],
        );
        await client.query(
          `INSERT INTO notary_certificates(id,matter_id,department_id,issuance_decision_id,
          notary_office_account_binding_id,actor_user_id,certificate_no,certificate_date,need_disclose,from_version,to_version)
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
          "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'CA010 lawyer','LAWYER',now())",
          [lawyerId, `ca010-lawyer-${lawyerId}`],
        );
        await client.query(
          "INSERT INTO user_accounts(id,external_subject,display_name,account_type,updated_at) VALUES ($1,$2,'CA010 client','CLIENT',now())",
          [clientId, `ca010-client-${clientId}`],
        );
        await client.query(
          'INSERT INTO lawyer_profiles(id,department_id,bound_user_id,full_name) VALUES ($1,$2,$3,$4)',
          [lawyerProfileId, actor.departmentId, lawyerId, 'CA010 lawyer'],
        );
        await client.query(
          'INSERT INTO lawyer_account_bindings(id,user_id,department_id,profile_id,updated_at) VALUES ($1,$2,$3,$4,now())',
          [randomUUID(), lawyerId, actor.departmentId, lawyerProfileId],
        );
        await client.query(
          "INSERT INTO case_lawyer_assignments(id,case_id,department_id,lawyer_id,role,started_at) VALUES ($1,$2,$3,$4,'PRIMARY',now())",
          [assignmentId, caseId, actor.departmentId, lawyerProfileId],
        );
        await client.query(
          `UPDATE customers SET profile_status='ADMITTED',customer_type='ENTERPRISE',
          identity_type='BUSINESS_LICENSE',identity_number=$2,normalized_identity_number=$2,
          identity_validity_mode='LONG_TERM',admitted_at=now(),ever_admitted=true,
          admission_contact_snapshot_name='CA010 contact',admission_contact_snapshot_phone='13800000000',
          admission_contact_snapshot_source='NEW_ADMISSION',admission_contact_snapshot_frozen_at=now()
          WHERE id=$1`,
          [customerId, `CA010-${customerId}`],
        );
        await client.query(
          'INSERT INTO customer_account_bindings(id,user_id,customer_id,department_id,updated_at) VALUES ($1,$2,$3,$4,now())',
          [randomUUID(), clientId, customerId, actor.departmentId],
        );
        await client.query(
          "INSERT INTO case_complaint_confirmations(id,department_id,case_id,confirmed_complaint_content_version_id,amount_state,amount,confirm_disclose,confirmed_by_user_id,confirmed_at,audit_event_id) VALUES ($1,$2,$3,$4,'KNOWN',100,true,$5,now(),$6)",
          [
            randomUUID(),
            actor.departmentId,
            caseId,
            registeredFiles[0].contentVersionId,
            actor.userId,
            randomUUID(),
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      const lawyerActor = {
        userId: lawyerId,
        lawyerAccountId: lawyerId,
        departmentId: actor.departmentId,
        authorizationRevision: 1,
      };
      const caseRead = new CaseReadService(database, access, materials);
      const lawyerList = await caseRead.list(lawyerActor, 1, 20);
      const lawyerDetail = await caseRead.get(lawyerActor, caseId);
      const lawyerOpened = await materials.openVersion(
        lawyerActor,
        file.materialId,
        file.contentVersionId,
      );
      const lawyerBytes = Buffer.concat(
        await Array.fromAsync(lawyerOpened.stream),
      );
      const lawyerAcceptance = await materials.openVersion(
        lawyerActor,
        acceptanceMaterialId,
        acceptanceVersionId,
      );
      const lawyerAcceptanceBytes = Buffer.concat(
        await Array.fromAsync(lawyerAcceptance.stream),
      );
      const clientActor = {
        userId: clientId,
        clientCustomerId: customerId,
        departmentId: actor.departmentId,
        authorizationRevision: 1,
      };
      const clientCase = new ClientCaseService(database, materials);
      const clientList = await clientCase.list(clientActor, 'RECORDED', 1, 20);
      const clientDetail = await clientCase.get(clientActor, caseId);
      let clientSecondFileDenied = false;
      try {
        await materials.openVersion(
          clientActor,
          file.materialId,
          file.contentVersionId,
        );
      } catch (error) {
        clientSecondFileDenied =
          error.response?.code === 'RESOURCE_NOT_FOUND' ||
          error.response?.code === 'ACTION_FORBIDDEN';
      }
      const revokedChange = await second.revokeResult(actor, caseId, {
        expectedVersion: 16,
        idempotencyKey: `ca010-change-revoke-${caseId}`,
        trialRoundId: anchor.currentTrialRoundId,
        resultId: finalCase.currentSecondInstanceResultId,
        reason: '分轮读取验证',
      });
      const remandAgain = await second.registerResult(actor, caseId, {
        ...resultInput,
        expectedVersion: 17,
        expectedProgressId: revised.progressId,
        idempotencyKey: `ca010-remand-again-${caseId}`,
        progress: revisedProgress,
      });
      const remandAgainRound = await database.caseTrialRound.findUnique({
        where: { id: remandAgain.currentTrialRoundId },
        select: { sequence: true, revokedAt: true },
      });
      const remandDetail = await caseRead.get(lawyerActor, caseId);
      await client.query(
        'UPDATE case_lawyer_assignments SET ended_at=now() WHERE id=$1',
        [assignmentId],
      );
      let formerLawyerDenied = false;
      try {
        await caseRead.get(lawyerActor, caseId);
      } catch (error) {
        formerLawyerDenied = error.response?.code === 'RESOURCE_NOT_FOUND';
      }
      let formerFileDenied = false;
      try {
        await materials.openVersion(
          lawyerActor,
          file.materialId,
          file.contentVersionId,
        );
      } catch (error) {
        formerFileDenied =
          error.response?.code === 'RESOURCE_NOT_FOUND' ||
          error.response?.code === 'ACTION_FORBIDDEN';
      }
      return {
        saved:
          saved.stage === 'SECOND_INSTANCE' &&
          saved.version === 12 &&
          saved.progressId !== null,
        saveReplay: JSON.stringify(saveReplay) === JSON.stringify(saved),
        changedKey,
        remand:
          remand.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
          remand.version === 13 &&
          remand.currentTrialRoundId !== anchor.currentTrialRoundId,
        remandReplay: JSON.stringify(remandReplay) === JSON.stringify(remand),
        oldRound,
        clearedPointers:
          remandCase.currentAcceptanceId === null &&
          remandCase.currentJudgmentId === null &&
          remandCase.currentJudgmentNextStepId === null &&
          remandCase.courtCaseNo === null,
        restored:
          revoke.stage === 'SECOND_INSTANCE' &&
          restoredCase.version === 14 &&
          restoredCase.currentTrialRoundId === anchor.currentTrialRoundId &&
          restoredCase.currentAcceptanceId !== null &&
          restoredCase.currentJudgmentId === judgmentId &&
          restoredCase.currentJudgmentNextStepId ===
            anchor.currentJudgmentNextStepId &&
          restoredCase.courtCaseNo === 'CA008-db' &&
          revokedChild.revokedAt !== null,
        revokedChildReactivation,
        bypassStage,
        immutableResult,
        faultRaised,
        rollback:
          rollbackCase.version === 14 &&
          rollbackCase.currentSecondInstanceProgressId === saved.progressId &&
          rollbackFacts === beforeFailure,
        progressRevision:
          revised.version === 15 && revised.progressId !== saved.progressId,
        repeatedFrozenVersions:
          frozen.length === 2 &&
          frozen.every((item) => item.n === 2 && item.audits === 2),
        preservedProgressBytes,
        noAudit,
        wrongCase,
        wrongPurpose,
        wrongDepartment,
        wrongResultCategory,
        lawyerRead:
          lawyerList.items.some((item) => item.id === caseId) &&
          lawyerDetail.secondInstance.results.length === 2 &&
          lawyerDetail.secondInstance.revocations.length === 1 &&
          !('recordedByUserId' in lawyerDetail.secondInstance.results[0]) &&
          !('reason' in lawyerDetail.secondInstance.revocations[0]),
        roundHistory:
          lawyerDetail.secondInstance.rounds.length === 2 &&
          lawyerDetail.acceptances.length === 1 &&
          lawyerDetail.acceptances[0].trialRoundId ===
            anchor.currentTrialRoundId &&
          lawyerDetail.acceptances[0].courtCaseNo === 'CA008-db' &&
          lawyerDetail.acceptances[0].files.length === 1 &&
          lawyerDetail.acceptances[0].files[0].category ===
            'ACCEPTANCE_NOTICE' &&
          lawyerDetail.acceptances[0].files[0].contentVersionId ===
            acceptanceVersionId &&
          lawyerAcceptanceBytes.equals(acceptanceBytes) &&
          lawyerDetail.judgment.history[0].trialRoundId ===
            anchor.currentTrialRoundId &&
          lawyerDetail.judgmentNextStep.history[0].trialRoundId ===
            anchor.currentTrialRoundId &&
          lawyerDetail.hearing.arrangements.every(
            (item) => item.trialRoundId === anchor.currentTrialRoundId,
          ) &&
          lawyerDetail.hearing.advances.every(
            (item) => item.trialRoundId === anchor.currentTrialRoundId,
          ),
        remandRead:
          revokedChange.version === 17 &&
          remandAgain.version === 18 &&
          remandAgain.currentTrialRoundId !== remand.currentTrialRoundId &&
          remandAgainRound.sequence === 3 &&
          remandAgainRound.revokedAt === null &&
          remandDetail.acceptance === null &&
          remandDetail.courtCaseNo === null &&
          remandDetail.secondInstance.currentTrialRoundId ===
            remandAgain.currentTrialRoundId &&
          remandDetail.acceptances.length === 1 &&
          remandDetail.acceptances[0].trialRoundId ===
            anchor.currentTrialRoundId &&
          remandDetail.acceptances[0].files[0]?.contentVersionId ===
            acceptanceVersionId,
        lawyerFile: lawyerBytes.includes(Buffer.from('CA010 real result')),
        clientRead:
          clientList.items.some((item) => item.id === caseId) &&
          clientDetail.stage === 'WAITING_EXECUTION_DOCUMENTS' &&
          !('secondInstance' in clientDetail) &&
          !('judgmentNextStep' in clientDetail) &&
          !('fees' in clientDetail),
        clientSecondFileDenied,
        formerLawyerDenied,
        formerFileDenied,
        race,
        final:
          finalCase.stage === 'WAITING_EXECUTION_DOCUMENTS' &&
          finalCase.version === 16 &&
          finalCase.currentSecondInstanceResultId !== null,
      };
    },
  });
}
