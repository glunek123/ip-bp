import type { Prisma } from '../../generated/prisma/client';

export const EVIDENCE_SOURCE_KINDS = {
  CASE: 'CASE',
  NOTARY_MATTER: 'NOTARY_MATTER',
} as const;
export type EvidenceSourceKind =
  (typeof EVIDENCE_SOURCE_KINDS)[keyof typeof EVIDENCE_SOURCE_KINDS];
export type FrozenEvidenceFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};

/** Trusted facts supplied inside the original successful issuance transaction. */
export type InitializeNotaryEvidenceFacts = {
  departmentId: string;
  sourceNotaryMatterId: string;
  caseId: string | null;
  certificateId: string;
  sourceActionEventId: string;
  actorUserId: string;
  notaryOfficeAccountBindingId: string;
  certificateNo: string;
  certificateDate: Date;
  evidenceAt: Date;
  officeName: string;
  shopName: string | null;
  platform: string | null;
  files: readonly FrozenEvidenceFile[];
};

/** Contract only; the real helper consumes the shared generated Prisma models. */
export type InitializeNotaryEvidence = (
  tx: Prisma.TransactionClient,
  facts: InitializeNotaryEvidenceFacts,
) => Promise<{ groupId: string; created: boolean }>;
