import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { notaryDisplayFee } from './notary-display-read';

type Fee = ReturnType<typeof notaryDisplayFee>;
type Product = { estimatedAmount: string };
type CertificateFee = {
  category: string;
  state: 'KNOWN' | 'PENDING';
  amount: Prisma.Decimal | null;
};

function corrupt(): never {
  throw new InternalServerErrorException({
    code: 'INTERNAL_ERROR',
    message: '公证事项来源数据不完整',
  });
}

function cents(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(value)) corrupt();
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function readNotaryDetailFacts(input: {
  snapshot: Prisma.JsonValue;
  sourceLead: {
    id: string;
    businessNo: string;
    customerId?: string;
    departmentId?: string;
    responsibleUserId: string;
    pushedAt?: Date | null;
    platform?: string;
    shopExternalId?: string | null;
    needDisclose?: boolean;
    remark?: string | null;
    infringements?: Array<{ type: string }>;
    responsibleMembership?: { user: { displayName: string } } | null;
  };
  matter: {
    id: string;
    sourceLeadId: string;
    customerId: string;
    departmentId: string;
    responsibleUserId: string;
    stage: string;
    openingReviewDecision: {
      result: string;
      archivedAt: Date | null;
    } | null;
    issuanceDecision: { decision: string } | null;
    returnArchive: { archivedAt: Date } | null;
    certificate: {
      issuedAt: Date;
      fees: CertificateFee[];
    } | null;
  };
  review: {
    id: string;
    leadId: string;
    customerId: string;
    departmentId: string;
    result: string;
    actorKind: string;
    reviewerDisplayNameSnapshot: string;
    decidedAt: Date;
    reason: string | null;
  } | null;
  products: Product[];
  routineRevision: number;
  screenshots: Array<{
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  }>;
  fees: { notary: Fee; investigation: Fee; sample: Fee };
}) {
  const { snapshot, sourceLead, matter } = input;
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    matter.sourceLeadId !== sourceLead.id ||
    (sourceLead.customerId !== undefined &&
      sourceLead.customerId !== matter.customerId) ||
    (sourceLead.departmentId !== undefined &&
      sourceLead.departmentId !== matter.departmentId)
  )
    corrupt();
  const source = snapshot as Record<string, unknown>;
  const snapshotState =
    typeof source.caseType === 'string' &&
    typeof source.source === 'string' &&
    typeof source.foundAt === 'string' &&
    typeof source.platform === 'string' &&
    typeof source.shopName === 'string'
      ? 'KNOWN'
      : 'UNKNOWN_LEGACY';
  if (
    (source.sourceLeadId !== undefined &&
      source.sourceLeadId !== sourceLead.id) ||
    (source.customerId !== undefined &&
      source.customerId !== matter.customerId) ||
    (source.responsibleUserId !== undefined &&
      source.responsibleUserId !== matter.responsibleUserId)
  )
    corrupt();
  const reviewId = source.activeReviewDecisionId;
  if (
    reviewId !== undefined &&
    reviewId !== null &&
    typeof reviewId !== 'string'
  )
    corrupt();
  if (
    typeof reviewId === 'string' &&
    (input.review === null ||
      input.review.id !== reviewId ||
      input.review.leadId !== matter.sourceLeadId ||
      input.review.customerId !== matter.customerId ||
      input.review.departmentId !== matter.departmentId ||
      input.review.result !== 'INFRINGEMENT' ||
      !['CLIENT', 'INTERNAL_PROXY'].includes(input.review.actorKind))
  )
    corrupt();
  const review =
    typeof reviewId === 'string' && input.review !== null
      ? {
          state: 'KNOWN' as const,
          result: input.review.result,
          actorKind: input.review.actorKind as 'CLIENT' | 'INTERNAL_PROXY',
          actorDisplayName: input.review.reviewerDisplayNameSnapshot,
          decidedAt: input.review.decidedAt.toISOString(),
          reason: input.review.reason,
        }
      : { state: 'UNKNOWN_LEGACY' as const };
  const disclosure = notaryDisplayFee(
    matter.certificate?.fees.find((row) => row.category === 'DISCLOSURE'),
  );
  const relevantFees = [
    input.fees.notary,
    input.fees.investigation,
    input.fees.sample,
    disclosure,
  ];
  const knownSubtotal = relevantFees.reduce(
    (sum, fee) => sum + (fee.state === 'KNOWN' ? cents(fee.amount!) : 0n),
    0n,
  );
  const estimate = input.products.reduce(
    (sum, product) => sum + cents(product.estimatedAmount),
    0n,
  );
  let archive: {
    kind: 'OPENING_NO_INFRINGEMENT' | 'RETURN' | 'CERTIFICATE';
    occurredAt: string;
  } | null = null;
  if (matter.stage === 'ARCHIVED') {
    if (matter.openingReviewDecision?.result === 'NO_INFRINGEMENT') {
      if (!matter.openingReviewDecision.archivedAt) corrupt();
      archive = {
        kind: 'OPENING_NO_INFRINGEMENT',
        occurredAt: matter.openingReviewDecision.archivedAt.toISOString(),
      };
    } else if (matter.returnArchive) {
      archive = {
        kind: 'RETURN',
        occurredAt: matter.returnArchive.archivedAt.toISOString(),
      };
    } else if (matter.certificate) {
      archive = {
        kind: 'CERTIFICATE',
        occurredAt: matter.certificate.issuedAt.toISOString(),
      };
    } else corrupt();
  }
  return {
    source: {
      snapshotState,
      snapshotFields: 'TRANSFER_SNAPSHOT' as const,
      caseType: typeof source.caseType === 'string' ? source.caseType : null,
      source: typeof source.source === 'string' ? source.source : null,
      foundAt: typeof source.foundAt === 'string' ? source.foundAt : null,
      platform: typeof source.platform === 'string' ? source.platform : null,
      shopName: typeof source.shopName === 'string' ? source.shopName : null,
      shopExternalId: {
        value: sourceLead.shopExternalId ?? null,
        provenance: 'CURRENT_LEAD' as const,
      },
      needDisclose: {
        value: sourceLead.needDisclose ?? null,
        provenance: 'CURRENT_LEAD' as const,
      },
      responsibleOperator: {
        id: matter.responsibleUserId,
        name: sourceLead.responsibleMembership?.user.displayName ?? null,
        provenance: 'CURRENT_NAME' as const,
      },
      infringements: {
        values: sourceLead.infringements?.map((item) => item.type) ?? [],
        provenance: 'CURRENT_LEAD' as const,
      },
      remark: {
        value: sourceLead.remark ?? null,
        provenance: 'CURRENT_LEAD' as const,
      },
      leadPushedAt: sourceLead.pushedAt?.toISOString() ?? null,
      screenshots: input.screenshots,
      screenshotProvenance: 'TRANSFER_SNAPSHOT' as const,
    },
    leadReview: review,
    archive,
    productEstimate: {
      amount: money(estimate),
      label: 'ESTIMATE' as const,
      provenance:
        input.routineRevision > 0
          ? ('CURRENT_NOTARY_ROUTINE' as const)
          : ('TRANSFER_SNAPSHOT' as const),
    },
    feeTotals: {
      disclosure,
      knownSubtotal: money(knownSubtotal),
      confirmedTotal: relevantFees.every((fee) => fee.state === 'KNOWN')
        ? money(knownSubtotal)
        : null,
    },
  };
}
