import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CaseStage } from '../../generated/prisma/enums';

export type CaseExternalKnown = Readonly<{
  courtId: string | null;
  courtCaseNo: string | null;
  acceptedOn: string | null;
  secondInstanceAcceptedOn: string | null;
  platform: string | null;
  shopName: string | null;
  shopExternalId: string | null;
  caseType: string | null;
  infringementTypes: string[] | null;
}>;

export type CaseSourceAnchor =
  | Readonly<{ kind: 'NORMAL' }>
  | Readonly<{
      kind: 'EXTERNAL_ENTRY';
      entryId: string;
      initialStage: CaseStage;
      stageReachedOn: string;
      known: CaseExternalKnown;
    }>;

const invalid = () =>
  new ConflictException({
    code: 'INVALID_CASE_SOURCE',
    message: 'Case source is inconsistent',
  });

function parseKnown(value: Prisma.JsonValue): CaseExternalKnown {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const keys = [
    'courtId',
    'courtCaseNo',
    'acceptedOn',
    'secondInstanceAcceptedOn',
    'platform',
    'shopName',
    'shopExternalId',
    'caseType',
    'infringementTypes',
  ] as const;
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  )
    throw invalid();
  for (const key of keys) {
    const field = value[key];
    if (key === 'infringementTypes') {
      if (
        field !== null &&
        (!Array.isArray(field) ||
          field.some((part) => typeof part !== 'string'))
      )
        throw invalid();
    } else if (field !== null && typeof field !== 'string') throw invalid();
  }
  return value as CaseExternalKnown;
}

export async function readCaseSourceAnchor(
  tx: Prisma.TransactionClient,
  caseId: string,
  departmentId: string,
): Promise<CaseSourceAnchor> {
  const row = await tx.case.findFirst({
    where: { id: caseId, departmentId },
    select: {
      sourceLeadId: true,
      sourceNotaryMatterId: true,
      certificateId: true,
      externalEntry: {
        select: {
          id: true,
          caseId: true,
          departmentId: true,
          initialStage: true,
          stageReachedOn: true,
          known: true,
        },
      },
    },
  });
  if (row === null) throw invalid();
  const ids = [row.sourceLeadId, row.sourceNotaryMatterId, row.certificateId];
  if (ids.every((id) => id !== null) && row.externalEntry === null)
    return { kind: 'NORMAL' };
  const entry = row.externalEntry;
  if (
    !ids.every((id) => id === null) ||
    entry === null ||
    entry.caseId !== caseId ||
    entry.departmentId !== departmentId
  )
    throw invalid();
  return {
    kind: 'EXTERNAL_ENTRY',
    entryId: entry.id,
    initialStage: entry.initialStage,
    stageReachedOn: entry.stageReachedOn.toISOString().slice(0, 10),
    known: parseKnown(entry.known),
  };
}

export function isEntryStartingAt(
  anchor: CaseSourceAnchor,
  stage: CaseStage,
): anchor is Extract<CaseSourceAnchor, { kind: 'EXTERNAL_ENTRY' }> {
  return anchor.kind === 'EXTERNAL_ENTRY' && anchor.initialStage === stage;
}

export function entryDateLowerBound(
  anchor: CaseSourceAnchor,
  field: 'acceptedOn' | 'secondInstanceAcceptedOn',
): string | null {
  return anchor.kind === 'EXTERNAL_ENTRY' ? anchor.known[field] : null;
}
