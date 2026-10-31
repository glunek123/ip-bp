import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CaseSourceAnchor } from './case-entry-source';

const invalid = () =>
  new ConflictException({
    code: 'INVALID_STATE',
    message: 'Invalid case source chain',
  });
export type VerifiedEarlyClosureRoot = {
  id: string;
  caseId: string;
  departmentId: string;
  fromStage: string;
  fromVersion: number;
  toVersion: number;
};

/** Check every real execution fact back to its actual predecessor or the one imported starting point.
 * Existing callers retain the strict original branch. The optional early mode
 * does not trust a caller-supplied source ID: it revalidates the real root, exact
 * source/audit/receipt and SQL terminal before retaining all execution checks.
 */
export function assertExecutionSourceChain(
  tx: Prisma.TransactionClient,
  caseId: string,
  departmentId: string,
  source: CaseSourceAnchor,
  allowEarlyClosureRoot: boolean,
): Promise<VerifiedEarlyClosureRoot | null>;
export function assertExecutionSourceChain(
  tx: Prisma.TransactionClient,
  caseId: string,
  departmentId: string,
  source: CaseSourceAnchor,
): Promise<void>;
export async function assertExecutionSourceChain(
  tx: Prisma.TransactionClient,
  caseId: string,
  departmentId: string,
  source: CaseSourceAnchor,
  allowEarlyClosureRoot?: boolean,
): Promise<VerifiedEarlyClosureRoot | null | void> {
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
      closure: {
        select: {
          id: true,
          finishId: true,
          externalEntryId: true,
          earlyClosureId: true,
        },
      },
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
  let earlyRoot: VerifiedEarlyClosureRoot | null = null;
  if (allowEarlyClosureRoot && closure?.earlyClosureId) {
    const roots = await tx.$queryRaw<
      Array<{
        id: string;
        case_id: string;
        department_id: string;
        from_stage: string;
        from_version: number;
        to_version: number;
        source_valid: boolean;
        original_source_valid: boolean;
        audit_valid: boolean;
        terminal: number;
        case_version: number;
      }>
    >`SELECT e.id,e.case_id,e.department_id,e.from_stage::text,e.from_version,e.to_version,
      CASE WHEN c.stage='ARCHIVED' THEN (SELECT v.to_version FROM case_closure_versions v
        WHERE v.id=h.current_version_id AND v.case_id=c.id AND v.department_id=c.department_id)
        ELSE c.version END AS case_version,
      case_archive_source_checks(c,e.from_stage) AS source_valid,
      CASE WHEN ${source.kind}='NORMAL' THEN c.source_lead_id IS NOT NULL AND c.source_notary_matter_id IS NOT NULL
        AND c.certificate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM case_external_entries x WHERE x.case_id=c.id)
      ELSE c.source_lead_id IS NULL AND c.source_notary_matter_id IS NULL AND c.certificate_id IS NULL
        AND EXISTS(SELECT 1 FROM case_external_entries x WHERE x.case_id=c.id AND x.department_id=c.department_id
          AND x.id=${source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null}::uuid
          AND x.initial_stage=${source.kind === 'EXTERNAL_ENTRY' ? source.initialStage : null}::case_stage
          AND x.stage_reached_on::text=${source.kind === 'EXTERNAL_ENTRY' ? source.stageReachedOn : null}) END AS original_source_valid,
      EXISTS(SELECT 1 FROM case_early_closure_receipts r JOIN audit_events a ON a.id=e.audit_event_id
        WHERE r.early_closure_id=e.id AND r.case_id=e.case_id AND r.department_id=e.department_id
        AND r.actor_user_id=e.recorded_by_user_id AND r.request_fingerprint ~ '^[0-9a-f]{64}$'
        AND a.department_id=e.department_id AND a.actor_kind='HUMAN' AND a.actor_user_id=e.recorded_by_user_id
        AND a.internal_actor_user_id=e.recorded_by_user_id AND a.resource_type='CASE' AND a.resource_id=e.case_id
        AND a.action='case.early_closed' AND a.customer_account_binding_id IS NULL
        AND a.notary_office_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL
        AND (a.details - 'authorizationRevision')=jsonb_build_object('earlyClosureId',e.id,'fromStage',e.from_stage,'fromVersion',e.from_version,
          'toVersion',e.to_version,'requestFingerprint',r.request_fingerprint)
        AND (NOT (a.details ? 'authorizationRevision') OR CASE
          WHEN jsonb_typeof(a.details->'authorizationRevision')='number' THEN
            (a.details->>'authorizationRevision')::numeric BETWEEN 1 AND 9007199254740991
            AND trunc((a.details->>'authorizationRevision')::numeric)=(a.details->>'authorizationRevision')::numeric
          ELSE false END)
        AND r.result_snapshot=jsonb_build_object('id',e.case_id,'earlyClosureId',e.id,'fromStage',e.from_stage,
          'stage','WAITING_ARCHIVE','version',e.to_version,'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ) AS audit_valid,
      case_closure_source_terminal_version(c.id,c.department_id,NULL,e.to_version) AS terminal
      FROM cases c JOIN case_early_closures e ON e.case_id=c.id AND e.department_id=c.department_id
      JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id AND h.early_closure_id=e.id
      WHERE c.id=${caseId}::uuid AND c.department_id=${departmentId}::uuid AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
      AND e.id=${closure.earlyClosureId}::uuid AND h.id=${closure.id}::uuid AND h.finish_id IS NULL AND h.external_entry_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM case_execution_finishes f WHERE f.case_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM case_early_archives old WHERE old.case_id=c.id) FOR SHARE OF e,h`;
    const e = roots[0];
    if (
      roots.length !== 1 ||
      !e ||
      e.id !== closure.earlyClosureId ||
      e.case_id !== caseId ||
      e.department_id !== departmentId ||
      !e.source_valid ||
      !e.original_source_valid ||
      !e.audit_valid ||
      !Number.isSafeInteger(e.from_version) ||
      e.from_version < 1 ||
      e.to_version !== e.from_version + 1 ||
      e.terminal !== e.case_version ||
      e.terminal < e.to_version + 1 ||
      ![
        'PENDING_MATCH',
        'WAITING_COMPLAINT',
        'WAITING_COMPLAINT_CONFIRMATION',
        'WAITING_COMPLAINT_STAMP',
        'WAITING_FILING',
        'WAITING_FORMAL_ACCEPTANCE',
        'WAITING_HEARING',
        'WAITING_JUDGMENT',
        'SECOND_INSTANCE',
        'WAITING_EXECUTION_DOCUMENTS',
        'WAITING_EXECUTION_CONFIRMATION',
        'WAITING_EXECUTION_STAMP',
        'WAITING_EXECUTION_FILING',
        'EXECUTING',
      ].includes(e.from_stage) ||
      finish !== null ||
      closure.finishId !== null ||
      (closure.externalEntryId ?? null) !== null
    )
      throw invalid();
    earlyRoot = {
      id: e.id,
      caseId: e.case_id,
      departmentId: e.department_id,
      fromStage: e.from_stage,
      fromVersion: e.from_version,
      toVersion: e.to_version,
    };
  }

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
    if (earlyRoot !== null) return earlyRoot;
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
  return allowEarlyClosureRoot === undefined ? undefined : null;
}
