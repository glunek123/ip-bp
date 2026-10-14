import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

export const caseListDisplaySelect = {
  id: true,
  departmentId: true,
  customerId: true,
  rightsHolderId: true,
  sourceLeadId: true,
  sourceNotaryMatterId: true,
  certificateId: true,
  externalEntry: {
    select: { id: true, caseId: true, departmentId: true, known: true },
  },
  customer: { select: { id: true, departmentId: true, name: true } },
  rightsHolder: { select: { id: true, departmentId: true, name: true } },
  sourceLead: {
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      rightsHolderId: true,
      platform: true,
      shopName: true,
      shopExternalId: true,
    },
  },
  sourceNotaryMatter: {
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      rightsHolderId: true,
      sourceLeadId: true,
    },
  },
  defendants: { select: { id: true, name: true }, orderBy: { id: 'asc' } },
  lawyers: {
    where: { role: 'PRIMARY', endedAt: null },
    select: { lawyer: { select: { id: true, fullName: true } } },
    orderBy: { id: 'asc' },
  },
  filingSubmission: { select: { courtId: true, courtName: true } },
  courtCaseNo: true,
  complaintSubmittedAt: true,
  complaintAmountState: true,
  complaintAmount: true,
  complaintConfirmation: {
    select: { id: true, amountState: true, amount: true },
  },
  currentTrialRoundId: true,
  currentJudgmentNextStepId: true,
  currentJudgment: {
    select: {
      id: true,
      trialRoundId: true,
      judgmentAmountState: true,
      judgmentAmount: true,
    },
  },
  currentSecondInstanceResult: {
    select: {
      id: true,
      trialRoundId: true,
      choiceId: true,
      result: true,
      judgmentAmountState: true,
      judgmentAmount: true,
      revocation: { select: { id: true } },
    },
  },
  closure: {
    select: {
      currentVersion: {
        select: { id: true, closeAmountState: true, closeAmt: true },
      },
    },
  },
} satisfies Prisma.CaseSelect;
export type CaseListDisplayRecord = Prisma.CaseGetPayload<{
  select: typeof caseListDisplaySelect;
}>;
export type CaseAmountSource =
  | 'COMPLAINT_CONFIRMATION'
  | 'COMPLAINT_SUBMISSION'
  | 'FIRST_INSTANCE_JUDGMENT'
  | 'SECOND_INSTANCE_RESULT'
  | 'CASE_CLOSURE_VERSION';
export interface CaseDisplayAmount {
  state: 'UNRECORDED' | 'PENDING' | 'KNOWN';
  amount: string | null;
  sourceType: CaseAmountSource | null;
  sourceId: string | null;
}
const unrecorded = (): CaseDisplayAmount => ({
  state: 'UNRECORDED',
  amount: null,
  sourceType: null,
  sourceId: null,
});
function amount(
  state: 'KNOWN' | 'PENDING' | null,
  value: Prisma.Decimal | null,
  sourceType: CaseAmountSource,
  sourceId: string,
): CaseDisplayAmount {
  if (state === 'PENDING' && value === null)
    return { state, amount: null, sourceType, sourceId };
  if (state === 'KNOWN' && value !== null && value.gte(0))
    return { state, amount: value.toFixed(2), sourceType, sourceId };
  throw new InternalServerErrorException({
    code: 'INVALID_CASE_DISPLAY_SOURCE',
    message: '案件摘要来源不完整',
  });
}
export function caseListDisplay(record: CaseListDisplayRecord) {
  const {
    customer,
    rightsHolder,
    sourceLead: lead,
    sourceNotaryMatter: matter,
  } = record;
  const external = record.externalEntry;
  const isExternal =
    record.sourceLeadId === null &&
    record.sourceNotaryMatterId === null &&
    record.certificateId === null &&
    external !== null &&
    external.caseId === record.id &&
    external.departmentId === record.departmentId &&
    lead === null &&
    matter === null;
  const isNormal =
    external === null &&
    record.sourceLeadId !== null &&
    record.sourceNotaryMatterId !== null &&
    record.certificateId !== null &&
    lead !== null &&
    matter !== null &&
    lead.departmentId === record.departmentId &&
    matter.departmentId === record.departmentId &&
    lead.id === record.sourceLeadId &&
    matter.id === record.sourceNotaryMatterId &&
    matter.sourceLeadId === lead.id &&
    lead.customerId === record.customerId &&
    matter.customerId === record.customerId &&
    lead.rightsHolderId === record.rightsHolderId &&
    matter.rightsHolderId === record.rightsHolderId;
  if (
    !customer ||
    !rightsHolder ||
    customer.id !== record.customerId ||
    rightsHolder.id !== record.rightsHolderId ||
    customer.departmentId !== record.departmentId ||
    rightsHolder.departmentId !== record.departmentId ||
    (!isNormal && !isExternal)
  )
    throw new InternalServerErrorException({
      code: 'INVALID_CASE_DISPLAY_SOURCE',
      message: '案件摘要来源不完整',
    });
  const confirmation = record.complaintConfirmation;
  const claimAmount = confirmation
    ? amount(
        confirmation.amountState,
        confirmation.amount,
        'COMPLAINT_CONFIRMATION',
        confirmation.id,
      )
    : record.complaintSubmittedAt
      ? amount(
          record.complaintAmountState,
          record.complaintAmount,
          'COMPLAINT_SUBMISSION',
          record.id,
        )
      : unrecorded();
  const judgment = record.currentJudgment;
  const second = record.currentSecondInstanceResult;
  let judgmentAmount =
    judgment && judgment.trialRoundId === record.currentTrialRoundId
      ? amount(
          judgment.judgmentAmountState,
          judgment.judgmentAmount,
          'FIRST_INSTANCE_JUDGMENT',
          judgment.id,
        )
      : unrecorded();
  if (
    second &&
    second.revocation === null &&
    second.choiceId === record.currentJudgmentNextStepId &&
    second.trialRoundId === record.currentTrialRoundId
  ) {
    if (second.result === 'CHANGE')
      judgmentAmount = amount(
        second.judgmentAmountState,
        second.judgmentAmount,
        'SECOND_INSTANCE_RESULT',
        second.id,
      );
    else if (second.result === 'REMAND') judgmentAmount = unrecorded();
  }
  const closure = record.closure?.currentVersion;
  return {
    customerName: customer.name,
    rightsHolderName: rightsHolder.name,
    source: isNormal && lead !== null
      ? { platform: lead.platform, shopName: lead.shopName, shopExternalId: lead.shopExternalId }
      : {
          platform: typeof external?.known === 'object' && external.known !== null && !Array.isArray(external.known) && typeof external.known.platform === 'string' ? external.known.platform : null,
          shopName: typeof external?.known === 'object' && external.known !== null && !Array.isArray(external.known) && typeof external.known.shopName === 'string' ? external.known.shopName : null,
          shopExternalId: typeof external?.known === 'object' && external.known !== null && !Array.isArray(external.known) && typeof external.known.shopExternalId === 'string' ? external.known.shopExternalId : null,
        },
    defendants: record.defendants.map(({ id, name }) => ({ id, name })),
    lawyers: record.lawyers.map(({ lawyer }) => ({
      id: lawyer.id,
      fullName: lawyer.fullName,
    })),
    court: record.filingSubmission
      ? {
          id: record.filingSubmission.courtId,
          name: record.filingSubmission.courtName,
        }
      : null,
    courtCaseNo: record.courtCaseNo,
    claimAmount,
    judgmentAmount,
    closureAmount: closure
      ? amount(
          closure.closeAmountState,
          closure.closeAmt,
          'CASE_CLOSURE_VERSION',
          closure.id,
        )
      : unrecorded(),
  };
}
