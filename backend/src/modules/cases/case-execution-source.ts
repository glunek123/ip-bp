import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CaseSourceAnchor } from './case-entry-source';

const invalid = () =>
  new ConflictException({
    code: 'INVALID_STATE',
    message: 'Invalid case source chain',
  });

/** Check every real execution fact back to its actual predecessor or the one imported starting point. */
export async function assertExecutionSourceChain(
  tx: Prisma.TransactionClient,
  caseId: string,
  departmentId: string,
  source: CaseSourceAnchor,
): Promise<void> {
  const row = await tx.case.findFirst({
    where: { id: caseId, departmentId },
    select: {
      currentTrialRoundId: true,
      currentJudgmentNextStepId: true,
      currentJudgmentNextStep: {
        select: {
          id: true,
          trialRoundId: true,
          next: true,
          revocation: { select: { id: true } },
        },
      },
      currentSecondInstanceResultId: true,
      currentSecondInstanceResult: {
        select: {
          id: true,
          trialRoundId: true,
          choiceId: true,
          externalEntryId: true,
          result: true,
          revocation: { select: { id: true } },
        },
      },
      currentExecutionSubmissionId: true,
      currentExecutionSubmission: {
        select: {
          id: true,
          trialRoundId: true,
          judgmentNextStepId: true,
          secondInstanceResultId: true,
          externalEntryId: true,
          toVersion: true,
        },
      },
      executionConfirmation: {
        select: {
          id: true,
          submissionId: true,
          externalEntryId: true,
          fromVersion: true,
          toVersion: true,
          versions: { select: { contentVersionId: true } },
        },
      },
      executionMailing: {
        select: {
          id: true,
          confirmationId: true,
          externalEntryId: true,
          fromVersion: true,
          toVersion: true,
        },
      },
      executionFiling: {
        select: {
          id: true,
          mailingId: true,
          externalEntryId: true,
          fromVersion: true,
          toVersion: true,
        },
      },
      executionFinish: {
        select: {
          id: true,
          filingId: true,
          externalEntryId: true,
          fromVersion: true,
          toVersion: true,
        },
      },
      closure: { select: { id: true, finishId: true, externalEntryId: true } },
    },
  });
  if (row === null) throw invalid();
  const entryId = source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null;
  const start = source.kind === 'EXTERNAL_ENTRY' ? source.initialStage : null;
  const choice = row.currentJudgmentNextStep ?? null;
  const result = row.currentSecondInstanceResult ?? null;
  const submission = row.currentExecutionSubmission ?? null;
  const confirmation = row.executionConfirmation ?? null;
  const mailing = row.executionMailing ?? null;
  const filing = row.executionFiling ?? null;
  const finish = row.executionFinish ?? null;
  const closure = row.closure ?? null;

  if (submission !== null) {
    if (
      (submission.externalEntryId ?? null) !== entryId ||
      submission.trialRoundId !== row.currentTrialRoundId ||
      submission.judgmentNextStepId !== row.currentJudgmentNextStepId ||
      submission.secondInstanceResultId !== row.currentSecondInstanceResultId ||
      row.currentExecutionSubmissionId !== submission.id
    )
      throw invalid();
    if (submission.judgmentNextStepId === null) {
      const enteredAtDocuments =
        start === 'WAITING_EXECUTION_DOCUMENTS' &&
        result === null &&
        submission.secondInstanceResultId === null;
      const enteredAtSecondInstance =
        start === 'SECOND_INSTANCE' &&
        result !== null &&
        result.externalEntryId === entryId &&
        result.id === submission.secondInstanceResultId &&
        result.choiceId === null &&
        result.trialRoundId === submission.trialRoundId &&
        ['CHANGE', 'AFFIRM'].includes(result.result) &&
        result.revocation === null;
      if (choice !== null || (!enteredAtDocuments && !enteredAtSecondInstance))
        throw invalid();
    } else {
      if (
        choice === null ||
        choice.id !== submission.judgmentNextStepId ||
        choice.trialRoundId !== submission.trialRoundId ||
        choice.revocation !== null
      )
        throw invalid();
      if (choice.next === 'EXECUTION') {
        if (submission.secondInstanceResultId !== null) throw invalid();
      } else if (choice.next === 'APPEAL') {
        if (
          result === null ||
          result.id !== submission.secondInstanceResultId ||
          (result.externalEntryId ?? null) !== entryId ||
          result.choiceId !== choice.id ||
          result.trialRoundId !== submission.trialRoundId ||
          !['CHANGE', 'AFFIRM'].includes(result.result) ||
          result.revocation !== null
        )
          throw invalid();
      } else throw invalid();
    }
  } else if (row.currentExecutionSubmissionId !== null) throw invalid();

  if (confirmation !== null) {
    const frozenVersions = confirmation.versions ?? [];
    if (
      (confirmation.externalEntryId ?? null) !== entryId ||
      (submission === null
        ? start !== 'WAITING_EXECUTION_CONFIRMATION' ||
          confirmation.submissionId !== null ||
          row.currentJudgmentNextStepId !== null ||
          row.currentSecondInstanceResultId !== null ||
          frozenVersions.length < 1 ||
          frozenVersions.length > 10
        : confirmation.submissionId !== submission.id ||
          confirmation.fromVersion !== submission.toVersion ||
          frozenVersions.length !== 0)
    )
      throw invalid();
  }
  if (mailing !== null) {
    if (
      (mailing.externalEntryId ?? null) !== entryId ||
      (confirmation === null
        ? start !== 'WAITING_EXECUTION_STAMP' ||
          mailing.confirmationId !== null ||
          submission !== null
        : mailing.confirmationId !== confirmation.id ||
          mailing.fromVersion !== confirmation.toVersion)
    )
      throw invalid();
  }
  if (filing !== null) {
    if (
      (filing.externalEntryId ?? null) !== entryId ||
      (mailing === null
        ? start !== 'WAITING_EXECUTION_FILING' ||
          filing.mailingId !== null ||
          confirmation !== null ||
          submission !== null
        : filing.mailingId !== mailing.id ||
          filing.fromVersion !== mailing.toVersion)
    )
      throw invalid();
  }
  if (finish !== null) {
    if (
      (finish.externalEntryId ?? null) !== entryId ||
      (filing === null
        ? start !== 'EXECUTING' ||
          finish.filingId !== null ||
          mailing !== null ||
          confirmation !== null ||
          submission !== null
        : finish.filingId !== filing.id ||
          finish.fromVersion !== filing.toVersion)
    )
      throw invalid();
  }
  if (closure !== null) {
    if (
      (closure.externalEntryId ?? null) !== entryId ||
      (finish === null
        ? start !== 'WAITING_ARCHIVE' ||
          closure.finishId !== null ||
          filing !== null ||
          mailing !== null ||
          confirmation !== null ||
          submission !== null
        : closure.finishId !== finish.id)
    )
      throw invalid();
  }
}
