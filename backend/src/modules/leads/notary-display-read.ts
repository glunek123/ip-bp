import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  LeadPlatform,
  NotaryMatterStage,
  Prisma,
} from '../../generated/prisma/client';
import { isFrozenOpeningPhotoVersion } from '../materials';

export const NOTARY_DISPLAY_LEAD_SELECT = {
  id: true,
  businessNo: true,
  responsibleUserId: true,
  teamId: true,
  platform: true,
  shopName: true,
  shopExternalId: true,
} satisfies Prisma.LeadSelect;

export const NOTARY_DISPLAY_CERTIFICATE_SELECT = {
  id: true,
  certificateNo: true,
  certificateDate: true,
  issuedAt: true,
  needDisclose: true,
  fees: { select: { category: true, state: true, amount: true } },
} satisfies Prisma.NotaryCertificateSelect;

type FeeFact = { state: 'KNOWN' | 'PENDING'; amount: Prisma.Decimal | null };
type DisplayMatter = {
  id: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  createdAt: Date;
  sourceLead: {
    platform: LeadPlatform;
    shopName: string;
    shopExternalId: string | null;
  };
  evidence: {
    evidenceAt: Date;
    sampleFeeState: 'KNOWN' | 'PENDING';
    sampleFeeAmount: Prisma.Decimal | null;
  } | null;
  opening: {
    senderName: string | null;
    senderPhone: string | null;
    senderAddress: string | null;
  } | null;
  certificate: {
    id: string;
    certificateNo: string;
    certificateDate: Date;
    issuedAt: Date;
    needDisclose: boolean;
    fees: (FeeFact & { category: string })[];
  } | null;
};

function corruptSource() {
  return new InternalServerErrorException({
    code: 'INTERNAL_ERROR',
    message: '公证事项来源数据不完整',
  });
}

export function notaryDisplayFee(fact: FeeFact | null | undefined): {
  state: 'UNRECORDED' | 'PENDING' | 'KNOWN';
  amount: string | null;
} {
  if (fact == null) return { state: 'UNRECORDED', amount: null };
  if (fact.state === 'PENDING' && fact.amount === null)
    return { state: 'PENDING', amount: null };
  if (
    fact.state !== 'KNOWN' ||
    fact.amount === null ||
    fact.amount.isNegative() ||
    !fact.amount.isFinite() ||
    fact.amount.decimalPlaces() > 2
  )
    throw corruptSource();
  return { state: 'KNOWN', amount: fact.amount.toFixed(2) };
}

const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function notaryTransferredDate(createdAt: Date): string {
  const parts = shanghaiDate.formatToParts(createdAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function readNotaryDisplay(
  database: DatabaseService,
  access: AccessControlService,
  actor: ActorContext,
  matter: DisplayMatter,
  frozenPhotoCount?: number,
) {
  if (matter.departmentId !== actor.departmentId) throw corruptSource();
  const [customer, rightsHolder] = await Promise.all([
    database.customer.findFirst({
      where: { id: matter.customerId, departmentId: actor.departmentId },
      select: { id: true, name: true },
    }),
    database.rightsHolder.findFirst({
      where: { id: matter.rightsHolderId, departmentId: actor.departmentId },
      select: { id: true, name: true },
    }),
  ]);
  if (
    customer === null ||
    rightsHolder === null ||
    !customer.name.trim() ||
    !rightsHolder.name.trim()
  )
    throw corruptSource();
  let linkedCase: { id: string; businessNo: string; stage: string } | null =
    null;
  try {
    await access.authorizeDepartmentAction(actor, 'case.read');
    linkedCase = await database.case.findFirst({
      where: {
        departmentId: actor.departmentId,
        sourceNotaryMatterId: matter.id,
      },
      select: { id: true, businessNo: true, stage: true },
    });
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
  }
  let photoCount = frozenPhotoCount ?? 0;
  if (matter.opening !== null && frozenPhotoCount === undefined) {
    const references = await database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'notary_matter',
        resourceId: matter.id,
        purpose: 'NOTARY_OPENING_PHOTO',
        actionEventId: { not: null },
        actionEvent: {
          action: 'notary.opening_recorded',
          resourceType: 'notary_matter',
          resourceId: matter.id,
          departmentId: actor.departmentId,
        },
        material: {
          departmentId: actor.departmentId,
          ownerType: 'NOTARY_MATTER',
          ownerId: matter.id,
          category: 'NOTARY_OPENING_PHOTO',
          status: 'ACTIVE',
        },
        contentVersion: { status: 'AVAILABLE' },
      },
      select: {
        contentVersionId: true,
        actionEvent: { select: { details: true } },
      },
    });
    photoCount = new Set(
      references
        .filter((ref) =>
          isFrozenOpeningPhotoVersion(
            ref.actionEvent?.details,
            ref.contentVersionId,
          ),
        )
        .map((ref) => ref.contentVersionId),
    ).size;
  }
  if (!Number.isSafeInteger(photoCount) || photoCount < 0)
    throw corruptSource();
  const certificate = matter.certificate;
  const fee = (category: string) =>
    certificate?.fees.find((row) => row.category === category);
  return {
    sourceSummary: {
      customer,
      rightsHolder,
      platform: matter.sourceLead.platform,
      shopName: matter.sourceLead.shopName,
      shopExternalId: matter.sourceLead.shopExternalId,
    },
    transferredAt: notaryTransferredDate(matter.createdAt),
    evidenceAt: matter.evidence?.evidenceAt.toISOString().slice(0, 10) ?? null,
    openingSummary:
      matter.opening === null
        ? null
        : {
            photoCount,
            senderName: matter.opening.senderName,
            senderPhone: matter.opening.senderPhone,
            senderAddress: matter.opening.senderAddress,
          },
    certificateSummary:
      certificate == null
        ? null
        : {
            id: certificate.id,
            certificateNo: certificate.certificateNo,
            certificateDate: certificate.certificateDate
              .toISOString()
              .slice(0, 10),
            issuedAt: certificate.issuedAt.toISOString(),
            needDisclose: certificate.needDisclose,
          },
    fees: {
      notary: notaryDisplayFee(fee('NOTARY')),
      investigation: notaryDisplayFee(fee('INVESTIGATION')),
      sample: notaryDisplayFee(
        matter.evidence === null
          ? null
          : {
              state: matter.evidence.sampleFeeState,
              amount: matter.evidence.sampleFeeAmount,
            },
      ),
    },
    linkedCase,
  };
}

type CapabilityMatter = {
  departmentId: string;
  stage: NotaryMatterStage;
  evidenceMode: string;
  sourceLead: { responsibleUserId: string; teamId: string | null };
  evidence: object | null;
  opening: object | null;
  openingReviewDecision: {
    result: string;
    reason: string | null;
    archivedAt: Date | null;
  } | null;
  issuanceDecision: { decision: string } | null;
};

export async function notaryDisplayCapabilities(
  access: AccessControlService,
  actor: ActorContext,
  matter: CapabilityMatter,
) {
  const capabilities = {
    recordEvidence: false,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
    archiveReturn: false,
  };
  const infringement =
    matter.opening !== null &&
    matter.openingReviewDecision?.result === 'INFRINGEMENT' &&
    matter.openingReviewDecision.reason === null &&
    matter.openingReviewDecision.archivedAt === null;
  const actions = [
    [
      'recordEvidence',
      'notary.evidence.record',
      matter.stage === 'PENDING_EVIDENCE' &&
        matter.evidenceMode === 'ONLINE_PURCHASE',
    ],
    [
      'recordOpening',
      'notary.unbox.record',
      matter.stage === 'WAITING_UNBOX' && matter.evidence !== null,
    ],
    [
      'reviewOpening',
      'notary.opening.review',
      matter.stage === 'UNBOX_REVIEW' && matter.opening !== null,
    ],
    [
      'decideIssuance',
      'notary.issuance.decide',
      matter.stage === 'ISSUANCE_DECISION' && infringement,
    ],
    [
      'archiveReturn',
      'notary.return.archive',
      matter.stage === 'WAITING_RETURN' &&
        infringement &&
        matter.issuanceDecision?.decision === 'NO_ISSUE',
    ],
  ] as const;
  for (const [key, action, eligible] of actions) {
    if (!eligible) continue;
    try {
      await access.authorizeLead(actor, action, {
        departmentId: matter.departmentId,
        responsibleUserId: matter.sourceLead.responsibleUserId,
        ...(matter.sourceLead.teamId === null
          ? {}
          : { teamId: matter.sourceLead.teamId }),
      });
      capabilities[key] = true;
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
  }
  return capabilities;
}
