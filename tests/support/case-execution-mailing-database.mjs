import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { verifyCaseJudgmentDatabase } from './case-judgment-database.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { AccessControlService } = backend(
  './dist/access-control/access-control.service.js',
);
const { PrismaAccessControlStore } = backend(
  './dist/access-control/prisma-access-control.store.js',
);
const { CaseJudgmentNextStepService } = backend(
  './dist/modules/cases/case-judgment-next-step.service.js',
);
const { CaseExecutionSubmissionService } = backend(
  './dist/modules/cases/case-execution-submission.service.js',
);
const { CaseExecutionConfirmationService } = backend(
  './dist/modules/cases/case-execution-confirmation.service.js',
);
const { CaseExecutionMailingService } = backend(
  './dist/modules/cases/case-execution-mailing.service.js',
);
const { CaseExecutionFilingService } = backend(
  './dist/modules/cases/case-execution-filing.service.js',
);

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
async function upload(
  materials,
  actor,
  caseId,
  database,
  trackStorageKey,
  category,
  label,
) {
  const draft = await materials.createUploadDraft(actor, {
    ownerType: 'CASE',
    ownerId: caseId,
    category,
    purpose: category,
    originalFilename: `${label}.pdf`,
    declaredMimeType: 'application/pdf',
  });
  const bytes = Buffer.from(
    `%PDF-1.7\nCA013-014 ${label} ${randomUUID()}\n%%EOF\n`,
  );
  const result = await materials.finalizeUpload(
    actor,
    draft.id,
    Readable.from(bytes),
  );
  const version = await database.contentVersion.findUnique({
    where: { id: result.contentVersionId },
    select: { storageKey: true },
  });
  trackStorageKey(version.storageKey);
  return { ...result, bytes };
}
async function snapshot(client, caseId) {
  return JSON.stringify(
    (
      await client.query(
        `SELECT c.stage,c.version,
    (SELECT count(*)::int FROM case_execution_mailings WHERE case_id=c.id) AS mailings,
    (SELECT count(*)::int FROM case_execution_mailing_receipts WHERE case_id=c.id) AS mail_receipts,
    (SELECT count(*)::int FROM case_execution_filings WHERE case_id=c.id) AS filings,
    (SELECT count(*)::int FROM case_execution_filing_receipts WHERE case_id=c.id) AS filing_receipts,
    (SELECT count(*)::int FROM audit_events WHERE resource_type='CASE' AND resource_id=c.id
      AND action IN ('case.execution.mailed','case.execution.filing.submitted')) AS audits,
    (SELECT count(*)::int FROM material_references WHERE resource_type='case' AND resource_id=c.id
      AND purpose IN ('MAIL_RECEIPT','EXECUTION_FILING_PROOF')) AS refs
    FROM cases c WHERE c.id=$1`,
        [caseId],
      )
    ).rows[0],
  );
}
async function faultRollback(
  client,
  service,
  method,
  actor,
  caseId,
  input,
  table,
  event,
  condition,
) {
  const before = await snapshot(client, caseId);
  const name = `ca013_fault_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${condition} THEN RAISE EXCEPTION 'ca013 injected fault' USING ERRCODE='23514';
    END IF; RETURN NEW; END $$`);
  await client.query(`CREATE TRIGGER "${name}" BEFORE ${event} ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
  let rejectedFault = false;
  try {
    await service[method](actor, caseId, {
      ...input,
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    rejectedFault = String(error.message).includes('ca013 injected fault');
  } finally {
    await client.query(`DROP TRIGGER "${name}" ON "${table}"`);
    await client.query(`DROP FUNCTION "${name}"()`);
  }
  return rejectedFault && (await snapshot(client, caseId)) === before;
}
async function sqlReject(client, sql, values) {
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

export async function verifyCaseExecutionMailingAndFilingDatabase(
  options = {},
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
        'case.execution.submit',
        'case.execution.confirm',
        'case.execution.mail',
        'case.execution.filing.submit',
      ]) {
        await client.query(
          `INSERT INTO role_grants(id,role_template_id,action,scope)
          VALUES ($1,$2,$3,'DEPARTMENT') ON CONFLICT DO NOTHING`,
          [randomUUID(), roleId, action],
        );
      }
      const access = new AccessControlService(
        new PrismaAccessControlStore(database),
      );
      const choice = new CaseJudgmentNextStepService(database, access);
      const submission = new CaseExecutionSubmissionService(
        database,
        access,
        materials,
      );
      const confirmation = new CaseExecutionConfirmationService(
        database,
        access,
        materials,
      );
      const mailing = new CaseExecutionMailingService(
        database,
        access,
        materials,
      );
      const filing = new CaseExecutionFilingService(
        database,
        access,
        materials,
      );
      const chosen = await choice.choose(actor, caseId, {
        expectedVersion: 10,
        idempotencyKey: randomUUID(),
        judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      });
      const source = await database.case.findUnique({
        where: { id: caseId },
        select: { currentTrialRoundId: true },
      });
      const application = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'EXECUTION_APPLICATION',
        'application',
      );
      const submitted = await submission.submit(actor, caseId, {
        expectedVersion: chosen.version,
        idempotencyKey: randomUUID(),
        trialRoundId: source.currentTrialRoundId,
        judgmentNextStepId: chosen.choiceId,
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [application.contentVersionId],
      });
      const confirmed = await confirmation.confirm(actor, caseId, {
        expectedVersion: submitted.version,
        idempotencyKey: randomUUID(),
        expectedSubmissionId: submitted.submissionId,
      });
      const receipt = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'MAIL_RECEIPT',
        'mail-receipt',
      );
      const alternative = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'MAIL_RECEIPT',
        'alternative-receipt',
      );
      const date = todayShanghai();
      const mailInput = {
        expectedVersion: confirmed.version,
        idempotencyKey: randomUUID(),
        expectedConfirmationId: confirmed.confirmationId,
        mailedAt: date,
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      };
      const wrongConfirmation = await rejected(() =>
        mailing.mail(actor, caseId, {
          ...mailInput,
          idempotencyKey: randomUUID(),
          expectedConfirmationId: randomUUID(),
        }),
      );
      const wrongMaterial = await rejected(() =>
        mailing.mail(actor, caseId, {
          ...mailInput,
          idempotencyKey: randomUUID(),
          mailReceiptContentVersionIds: [application.contentVersionId],
        }),
      );
      const missingMail = await rejected(() =>
        mailing.mail(actor, caseId, {
          ...mailInput,
          idempotencyKey: randomUUID(),
          mailReceiptContentVersionIds: [],
        }),
      );
      const futureMail = await rejected(() =>
        mailing.mail(actor, caseId, {
          ...mailInput,
          idempotencyKey: randomUUID(),
          mailedAt: '2999-01-01',
        }),
      );
      let mailFault = true;
      for (const [table, event, condition] of [
        ['audit_events', 'INSERT', "NEW.action = 'case.execution.mailed'"],
        ['case_execution_mailings', 'INSERT', 'true'],
        ['cases', 'UPDATE', "NEW.stage = 'WAITING_EXECUTION_FILING'"],
        ['case_execution_mailing_versions', 'INSERT', 'true'],
        ['material_references', 'INSERT', "NEW.purpose = 'MAIL_RECEIPT'"],
        ['case_execution_mailing_receipts', 'INSERT', 'true'],
      ]) {
        mailFault =
          (await faultRollback(
            client,
            mailing,
            'mail',
            actor,
            caseId,
            mailInput,
            table,
            event,
            condition,
          )) && mailFault;
      }
      const competingInput = {
        ...mailInput,
        idempotencyKey: randomUUID(),
        mailReceiptContentVersionIds: [alternative.contentVersionId],
      };
      const race = await Promise.allSettled([
        mailing.mail(actor, caseId, mailInput),
        mailing.mail(actor, caseId, competingInput),
      ]);
      const wins = race.filter((item) => item.status === 'fulfilled');
      if (wins.length !== 1)
        throw new Error('CA013 mailing race did not have one winner');
      const winnerInput =
        race[0].status === 'fulfilled' ? mailInput : competingInput;
      const mailed = wins[0].value;
      const mailReplay = await mailing.mail(actor, caseId, winnerInput);
      const mailConflict = await rejected(() =>
        mailing.mail(actor, caseId, {
          ...winnerInput,
          mailReceiptContentVersionIds: [application.contentVersionId],
        }),
      );
      const mailVersions = await database.caseExecutionMailingVersion.findMany({
        where: { mailingId: mailed.mailingId },
        select: { contentVersionId: true },
      });
      const mailFact = await database.caseExecutionMailing.findUnique({
        where: { id: mailed.mailingId },
        select: {
          confirmationId: true,
          fromVersion: true,
          toVersion: true,
          actorType: true,
          auditEventId: true,
        },
      });
      const proof = await upload(
        materials,
        actor,
        caseId,
        database,
        trackStorageKey,
        'EXECUTION_FILING_PROOF',
        'filing-proof',
      );
      const filingInput = {
        expectedVersion: mailed.version,
        idempotencyKey: randomUUID(),
        expectedMailingId: mailed.mailingId,
        submittedAt: date,
        executionFilingProofContentVersionIds: [proof.contentVersionId],
      };
      const clientDenied = await rejected(() =>
        filing.submit(
          { ...actor, clientCustomerId: randomUUID() },
          caseId,
          filingInput,
        ),
      );
      const notaryDenied = await rejected(() =>
        filing.submit(
          { ...actor, notaryOfficeId: randomUUID() },
          caseId,
          filingInput,
        ),
      );
      const wrongMailing = await rejected(() =>
        filing.submit(actor, caseId, {
          ...filingInput,
          idempotencyKey: randomUUID(),
          expectedMailingId: randomUUID(),
        }),
      );
      const wrongProof = await rejected(() =>
        filing.submit(actor, caseId, {
          ...filingInput,
          idempotencyKey: randomUUID(),
          executionFilingProofContentVersionIds: [receipt.contentVersionId],
        }),
      );
      const missingProof = await rejected(() =>
        filing.submit(actor, caseId, {
          ...filingInput,
          idempotencyKey: randomUUID(),
          executionFilingProofContentVersionIds: [],
        }),
      );
      const futureFiling = await rejected(() =>
        filing.submit(actor, caseId, {
          ...filingInput,
          idempotencyKey: randomUUID(),
          submittedAt: '2999-01-01',
        }),
      );
      let filingFault = true;
      for (const [table, event, condition] of [
        [
          'audit_events',
          'INSERT',
          "NEW.action = 'case.execution.filing.submitted'",
        ],
        ['case_execution_filings', 'INSERT', 'true'],
        ['cases', 'UPDATE', "NEW.stage = 'EXECUTING'"],
        ['case_execution_filing_versions', 'INSERT', 'true'],
        [
          'material_references',
          'INSERT',
          "NEW.purpose = 'EXECUTION_FILING_PROOF'",
        ],
        ['case_execution_filing_receipts', 'INSERT', 'true'],
      ]) {
        filingFault =
          (await faultRollback(
            client,
            filing,
            'submit',
            actor,
            caseId,
            filingInput,
            table,
            event,
            condition,
          )) && filingFault;
      }
      const competingFilingInput = {
        ...filingInput,
        idempotencyKey: randomUUID(),
      };
      const filingRace = await Promise.allSettled([
        filing.submit(actor, caseId, filingInput),
        filing.submit(actor, caseId, competingFilingInput),
      ]);
      const filingWins = filingRace.filter(
        (item) => item.status === 'fulfilled',
      );
      if (filingWins.length !== 1)
        throw new Error('CA014 filing race did not have one winner');
      const filed = filingWins[0].value;
      const filingWinnerInput =
        filingRace[0].status === 'fulfilled'
          ? filingInput
          : competingFilingInput;
      const filingReplay = await filing.submit(
        actor,
        caseId,
        filingWinnerInput,
      );
      const filingConflict = await rejected(() =>
        filing.submit(actor, caseId, {
          ...filingWinnerInput,
          executionFilingProofContentVersionIds: [receipt.contentVersionId],
        }),
      );
      const filingVersions = await database.caseExecutionFilingVersion.findMany(
        {
          where: { filingId: filed.filingId },
          select: { contentVersionId: true },
        },
      );
      const state = await database.case.findUnique({
        where: { id: caseId },
        select: { stage: true, version: true },
      });
      const sqlReversal = await sqlReject(
        client,
        "UPDATE cases SET stage='WAITING_EXECUTION_STAMP',version=version+1 WHERE id=$1",
        [caseId],
      );
      const audits = await database.auditEvent.findMany({
        where: {
          resourceType: 'CASE',
          resourceId: caseId,
          action: {
            in: ['case.execution.mailed', 'case.execution.filing.submitted'],
          },
        },
        select: { action: true, details: true },
      });
      const beforeDisabledReplay = await snapshot(client, caseId);
      const originalAccount = await database.userAccount.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { active: true },
      });
      let disabledMailReplay;
      let disabledFilingReplay;
      let disabledReplayUnchanged;
      try {
        await database.userAccount.update({
          where: { id: actor.userId },
          data: { active: false },
        });
        disabledMailReplay = await rejected(() =>
          mailing.mail(actor, caseId, winnerInput),
        );
        disabledFilingReplay = await rejected(() =>
          filing.submit(actor, caseId, filingWinnerInput),
        );
        disabledReplayUnchanged =
          (await snapshot(client, caseId)) === beforeDisabledReplay;
      } finally {
        await database.userAccount.update({
          where: { id: actor.userId },
          data: { active: originalAccount.active },
        });
      }
      const restoredAccount = await database.userAccount.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { authorizationRevision: true },
      });
      const restoredActor = {
        ...actor,
        authorizationRevision: restoredAccount.authorizationRevision,
      };
      const restoredReplay =
        isDeepStrictEqual(
          await mailing.mail(restoredActor, caseId, winnerInput),
          mailed,
        ) &&
        isDeepStrictEqual(
          await filing.submit(restoredActor, caseId, filingWinnerInput),
          filed,
        ) &&
        (await snapshot(client, caseId)) === beforeDisabledReplay;
      const continuation = options.afterFiling
        ? await options.afterFiling({
            actor: restoredActor,
            roleId,
            caseId,
            materials,
            database,
            client,
            trackStorageKey,
            filed,
          })
        : undefined;
      return {
        ...(continuation === undefined ? {} : { continuation }),
        source:
          chosen.stage === 'WAITING_EXECUTION_DOCUMENTS' &&
          confirmed.stage === 'WAITING_EXECUTION_STAMP',
        wrongConfirmation,
        wrongMaterial,
        missingMail,
        futureMail,
        mailFault,
        mailingRace: wins.length === 1,
        mailReplay: isDeepStrictEqual(mailReplay, mailed),
        mailConflict,
        mailFrozen:
          mailFact.confirmationId === confirmed.confirmationId &&
          mailFact.fromVersion === confirmed.version &&
          mailFact.toVersion === mailed.version &&
          mailFact.actorType === 'INTERNAL' &&
          mailVersions.length === 1 &&
          mailVersions[0].contentVersionId ===
            winnerInput.mailReceiptContentVersionIds[0],
        clientDenied,
        notaryDenied,
        wrongMailing,
        wrongProof,
        missingProof,
        futureFiling,
        filingFault,
        filingRace: filingWins.length === 1,
        filingReplay: isDeepStrictEqual(filingReplay, filed),
        filingConflict,
        filingFrozen:
          filingVersions.length === 1 &&
          filingVersions[0].contentVersionId === proof.contentVersionId,
        finalStage:
          state.stage === 'EXECUTING' && state.version === filed.version,
        auditFacts: audits.length === 2,
        sqlReversal,
        disabledMailReplay,
        disabledFilingReplay,
        disabledReplayUnchanged,
        restoredReplay,
      };
    },
  });
}
