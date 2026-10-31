import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import type { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import type { RefundInventoryItem } from './case-refund-inventory-draft.service';

type DocumentReference = { materialId: string; contentVersionId: string };
type RefundHead = {
  versionId: string;
  priorVersionId: string | null;
  revision: number;
  declaration: 'UNKNOWN' | 'COMPLETE' | 'NOT_APPLICABLE';
};
type Assessment = {
  versionId: string;
  priorVersionId: string | null;
  revision: number;
  closureVersionId: string;
  termsVersion: number | null;
  declaration: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
  customerAmount: string | null;
  lawyerAmount: string | null;
};

/** Settlement-module boundary. Must use this same read transaction and
 * return totals only, never source case, allocation, party or financial IDs.
 * The existing aggregate method starts a separate locking transaction, so is
 * deliberately not wired here. Missing adapter means UNKNOWN, not zero/N/A.
 */
export interface ClosureActualAggregateReadPort {
  readInTransaction(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ): Promise<{
    scope: 'CASE' | 'CONSOLIDATION';
    customerReceivedAmount: string | null;
    lawyerInvoicedAmount: string | null;
  }>;
}

function uuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new BadRequestException({ code: 'INVALID_CASE_WORKSPACE_ID' });
  return value.toLowerCase();
}
const forbidden = () =>
  new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
function latestChain<
  T extends {
    versionId: string;
    priorVersionId: string | null;
    revision: number;
  },
>(rows: readonly T[]): T | null {
  const ordered = [...rows].sort((a, b) => a.revision - b.revision);
  const ids = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    if (
      row.revision !== i + 1 ||
      row.priorVersionId !== (ordered[i - 1]?.versionId ?? null) ||
      ids.has(row.versionId)
    )
      throw new ConflictException({ code: 'CASE_WORKSPACE_SOURCE_INVALID' });
    ids.add(row.versionId);
  }
  return ordered.at(-1) ?? null;
}

/** Owner-only display reads bind authorization and financial evidence to one
 * RepeatableRead snapshot. Returned data does not authorize subsequent writes. */
export class CaseClosureWorkspaceReadDraft {
  constructor(
    private readonly database: Pick<DatabaseService, '$transaction'>,
    private readonly access: Pick<AccessControlService, 'authorizeCase'>,
    private readonly organization: OrganizationService,
    private readonly actualAggregate?: ClosureActualAggregateReadPort,
  ) {}

  async read(
    actor: ActorContext,
    requestedCaseId: string,
    includePaymentHistory = false,
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw forbidden();
    actor = {
      ...actor,
      userId: uuid(actor.userId),
      departmentId: uuid(actor.departmentId),
    };
    const caseId = uuid(requestedCaseId);
    return this.database.$transaction(
      async (tx) => {
        await lockCustomerActorFacts(tx, this.organization, actor);
        const account = await tx.userAccount.findUnique({
          where: { id: actor.userId },
          select: {
            active: true,
            accountType: true,
            authorizationRevision: true,
          },
        });
        const membership = await tx.departmentMembership.findUnique({
          where: {
            userId_departmentId: {
              userId: actor.userId,
              departmentId: actor.departmentId,
            },
          },
          select: {
            active: true,
            teamId: true,
            team: { select: { status: true } },
          },
        });
        if (
          !account?.active ||
          account.accountType !== 'INTERNAL' ||
          account.authorizationRevision !== actor.authorizationRevision ||
          !membership?.active ||
          (membership.teamId !== null && membership.team?.status !== 'ACTIVE')
        )
          throw forbidden();
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM cases WHERE id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid FOR SHARE NOWAIT`;
        if (locked.length !== 1)
          throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
        const record = await tx.case.findFirst({
          where: { id: caseId, departmentId: actor.departmentId },
          select: { version: true, stage: true, responsibleUserId: true },
        });
        if (!record) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
        if (record.responsibleUserId !== actor.userId) throw forbidden();
        await this.access.authorizeCase(
          actor,
          'case.read',
          {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(membership.teamId ? { teamId: membership.teamId } : {}),
          },
          tx,
        );

        // Current-case options only. Consolidation aggregates must never expose
        // source-case parties, and historical ended assignments are not eligible.
        const actualRegistrationAssignments =
          await tx.caseLawyerAssignment.findMany({
            where: { caseId, departmentId: actor.departmentId, endedAt: null },
            select: { lawyer: { select: { id: true, fullName: true } } },
            orderBy: [{ lawyerId: 'asc' }, { id: 'asc' }],
          });
        const actualRegistrationLawyers = [
          ...new Map(
            actualRegistrationAssignments.map(({ lawyer }) => [
              lawyer.id,
              lawyer,
            ]),
          ).values(),
        ];
        const closure = await tx.caseClosure.findFirst({
          where: { caseId, departmentId: actor.departmentId },
          select: {
            currentVersion: {
              select: {
                id: true,
                closeAt: true,
                closeAmountState: true,
                closeAmt: true,
                paymentType: true,
              },
            },
          },
        });
        const current = closure?.currentVersion;
        if (
          current?.paymentType !== null &&
          current?.paymentType !== undefined &&
          current.paymentType !== 'ONE_TIME' &&
          current.paymentType !== 'INSTALLMENTS'
        )
          throw new ConflictException({
            code: 'CASE_WORKSPACE_SOURCE_INVALID',
          });
        const payments = await tx.caseClosurePaymentVersion.findMany({
          where: { caseId, departmentId: actor.departmentId },
          orderBy: [{ paymentId: 'asc' }, { revision: 'desc' }],
          select: {
            id: true,
            priorVersionId: true,
            paymentId: true,
            revision: true,
            state: true,
            paidOn: true,
            reason: true,
            recordedAt: true,
            amount: true,
            payer: true,
            payee: true,
            documents: { select: { materialId: true, contentVersionId: true } },
          },
        });
        // Select the latest revision BEFORE filtering ACTIVE: revoked payments must
        // never resurrect an older active revision.
        const groups = new Map<string, Array<(typeof payments)[number]>>();
        for (const payment of payments) {
          const group = groups.get(payment.paymentId) ?? [];
          group.push(payment);
          groups.set(payment.paymentId, group);
        }
        const heads = [...groups.values()].map((group) => {
          const head = latestChain(
            group.map((p) => ({ ...p, versionId: p.id })),
          );
          if (!head)
            throw new ConflictException({
              code: 'CASE_WORKSPACE_SOURCE_INVALID',
            });
          return head;
        });
        const effectivePayments = await Promise.all(
          heads
            .filter((p) => p.state === 'ACTIVE')
            .map(async (p) => {
              // Independent supplements enrich this display only. Never mutate the
              // original document set used by immutable command receipts.
              const supplements = await tx.$queryRaw<
                Array<DocumentReference & { referenceValid: boolean }>
              >`
              SELECT d.material_id AS "materialId", d.content_version_id AS "contentVersionId",
                EXISTS(SELECT 1 FROM material_references r
                  WHERE r.resource_id=s.id AND s.payment_version_id=d.payment_version_id
                    AND s.payment_id=p.payment_id AND s.case_id=d.case_id AND s.department_id=d.department_id
                    AND r.resource_type='case-payment-proof-supplement'
                    AND r.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND r.department_id=d.department_id
                    AND r.material_id=d.material_id AND r.content_version_id=d.content_version_id
                    AND r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL) AS "referenceValid"
              FROM case_payment_proof_supplement_documents d
              LEFT JOIN case_payment_proof_supplements s ON s.id=d.supplement_id
              JOIN case_closure_payment_versions p ON p.id=d.payment_version_id
                AND p.case_id=d.case_id AND p.department_id=d.department_id
              WHERE d.case_id=${caseId}::uuid AND d.department_id=${actor.departmentId}::uuid
                AND p.payment_id=${p.paymentId}::uuid AND d.payment_version_id=${p.id}::uuid
                AND p.state='ACTIVE'
                AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n
                  WHERE n.payment_id=p.payment_id AND n.case_id=p.case_id
                    AND n.department_id=p.department_id AND n.revision>p.revision)
              ORDER BY d.content_version_id, d.material_id`;
              // Missing or mismatched provenance is corruption, never an empty
              // evidence set. Keep all scoped links until this explicit check.
              if (supplements.some((d) => d.referenceValid !== true))
                throw new ConflictException({
                  code: 'CASE_WORKSPACE_SOURCE_INVALID',
                });
              const documents = new Map<string, DocumentReference>();
              for (const d of [...p.documents, ...supplements]) {
                const existing = documents.get(d.contentVersionId);
                if (existing && existing.materialId !== d.materialId)
                  throw new ConflictException({
                    code: 'CASE_WORKSPACE_SOURCE_INVALID',
                  });
                documents.set(d.contentVersionId, {
                  materialId: d.materialId,
                  contentVersionId: d.contentVersionId,
                });
              }
              return {
                versionId: p.id,
                paymentId: p.paymentId,
                revision: p.revision,
                paidOn: p.paidOn.toISOString().slice(0, 10),
                amount: p.amount.toFixed(2),
                payer: p.payer,
                payee: p.payee,
                documents: [...documents.values()],
              };
            }),
        );
        const historicalProofs = includePaymentHistory
          ? await tx.$queryRaw<
              Array<
                DocumentReference & {
                  paymentVersionId: string;
                  referenceValid: boolean;
                }
              >
            >`
          SELECT d.payment_version_id AS "paymentVersionId",d.material_id AS "materialId",d.content_version_id AS "contentVersionId",
           EXISTS(SELECT 1 FROM material_references r WHERE s.payment_id=p.payment_id AND r.resource_id=s.id AND r.resource_type='case-payment-proof-supplement'
            AND r.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND r.department_id=d.department_id AND r.material_id=d.material_id
            AND r.content_version_id=d.content_version_id AND r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL) AS "referenceValid"
          FROM case_payment_proof_supplement_documents d
          LEFT JOIN case_payment_proof_supplements s ON s.id=d.supplement_id AND s.case_id=d.case_id AND s.department_id=d.department_id AND s.payment_version_id=d.payment_version_id
          JOIN case_closure_payment_versions p ON p.id=d.payment_version_id AND p.case_id=d.case_id AND p.department_id=d.department_id
          WHERE d.case_id=${caseId}::uuid AND d.department_id=${actor.departmentId}::uuid
          ORDER BY d.payment_version_id,d.content_version_id`
          : [];
        if (historicalProofs.some((p) => p.referenceValid !== true))
          throw new ConflictException({
            code: 'CASE_WORKSPACE_SOURCE_INVALID',
          });
        const documents = await tx.caseClosureDocument.findMany({
          where: { caseId, departmentId: actor.departmentId },
          select: {
            closureVersionId: true,
            materialId: true,
            contentVersionId: true,
          },
          orderBy: [{ closureVersionId: 'asc' }, { contentVersionId: 'asc' }],
        });
        // These two draft tables intentionally have no Prisma model yet.
        const refunds = await tx.$queryRaw<RefundHead[]>`
        SELECT id AS "versionId",prior_version_id AS "priorVersionId",revision,declaration FROM case_refund_inventory_versions
        WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid
        ORDER BY revision DESC`;
        const refund = latestChain(refunds);
        const refundItems = refund
          ? await tx.$queryRaw<RefundInventoryItem[]>`
        SELECT i.item_id AS "itemId",i.party,i.status,i.description,a.amount::numeric(16,2)::text AS amount FROM case_refund_inventory_items i
        LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
        WHERE i.inventory_version_id=${refund.versionId}::uuid AND i.case_id=${caseId}::uuid
          AND i.department_id=${actor.departmentId}::uuid ORDER BY i.item_id`
          : [];
        const assessments = await tx.$queryRaw<Assessment[]>`
        SELECT id AS "versionId",prior_version_id AS "priorVersionId",revision,closure_version_id AS "closureVersionId",
          terms_version AS "termsVersion",declaration,customer_amount::text AS "customerAmount",
          lawyer_amount::text AS "lawyerAmount" FROM case_settlement_assessment_versions
        WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid
        ORDER BY revision DESC`;
        const assessment = latestChain(assessments);
        const terms = await tx.caseSettlementTerms.findFirst({
          where: { caseId, departmentId: actor.departmentId },
          select: { version: true },
        });
        const assessmentMatchesCurrent = assessment
          ? assessment.closureVersionId === (current?.id ?? null) &&
            assessment.termsVersion === (terms?.version ?? null)
          : null;
        const actual = this.actualAggregate
          ? await this.actualAggregate.readInTransaction(tx, actor, caseId)
          : null;
        if (
          actual &&
          (!['CASE', 'CONSOLIDATION'].includes(actual.scope) ||
            [actual.customerReceivedAmount, actual.lawyerInvoicedAmount].some(
              (amount) =>
                amount !== null &&
                (typeof amount !== 'string' || !/^\d+\.\d{2}$/u.test(amount)),
            ))
        )
          throw new ConflictException({
            code: 'CASE_WORKSPACE_SOURCE_INVALID',
          });
        return {
          readPurpose: 'DISPLAY_ONLY' as const,
          caseId,
          caseVersion: record.version,
          stage: record.stage,
          actualRegistrationLawyers,
          closure: {
            versionId: current?.id ?? null,
            closeOn: current?.closeAt?.toISOString().slice(0, 10) ?? null,
            amountState: current?.closeAmountState ?? 'UNKNOWN',
            amount: current?.closeAmt?.toFixed(2) ?? null,
            paymentType: current?.paymentType ?? 'UNKNOWN',
          },
          effectivePayments,
          ...(includePaymentHistory
            ? {
                paymentHistory: payments.map((p) => ({
                  versionId: p.id,
                  paymentId: p.paymentId,
                  priorVersionId: p.priorVersionId,
                  revision: p.revision,
                  state: p.state,
                  paidOn: p.paidOn.toISOString().slice(0, 10),
                  amount: p.amount.toFixed(2),
                  payer: p.payer,
                  payee: p.payee,
                  reason: p.reason,
                  recordedAt: p.recordedAt.toISOString(),
                  originalDocuments: p.documents.map((d) => ({
                    materialId: d.materialId,
                    contentVersionId: d.contentVersionId,
                  })),
                  supplementalDocuments: historicalProofs
                    .filter((d) => d.paymentVersionId === p.id)
                    .map((d) => ({
                      materialId: d.materialId,
                      contentVersionId: d.contentVersionId,
                    })),
                })),
              }
            : {}),
          // Preserve historical exact references; never substitute material's current content.
          documents: documents.map((d) => ({
            closureVersionId: d.closureVersionId,
            materialId: d.materialId,
            contentVersionId: d.contentVersionId,
          })),
          refund: {
            versionId: refund?.versionId ?? null,
            revision: refund?.revision ?? null,
            declaration: refund?.declaration ?? 'UNKNOWN',
            items: refundItems.map((i) => ({
              itemId: i.itemId,
              party: i.party,
              status: i.status,
              description: i.description,
              amount: i.amount ?? null,
            })),
          },
          assessment: {
            versionId: assessment?.versionId ?? null,
            revision: assessment?.revision ?? null,
            closureVersionId: assessment?.closureVersionId ?? null,
            termsVersion: assessment?.termsVersion ?? null,
            declaration: assessment?.declaration ?? 'UNKNOWN',
            matchesCurrent: assessmentMatchesCurrent,
            // Historical outputs remain explicitly historical when inputs changed.
            customerAmount: assessment?.customerAmount ?? null,
            lawyerAmount: assessment?.lawyerAmount ?? null,
          },
          actual: {
            // Pick only totals. Never spread a port result or expose source details.
            connection: actual
              ? ('CONNECTED' as const)
              : ('NOT_CONNECTED' as const),
            scope: actual?.scope ?? null,
            customerReceiptState:
              actual?.customerReceivedAmount !== null &&
              actual?.customerReceivedAmount !== undefined
                ? ('RECORDED' as const)
                : ('UNKNOWN' as const),
            lawyerInvoiceState:
              actual?.lawyerInvoicedAmount !== null &&
              actual?.lawyerInvoicedAmount !== undefined
                ? ('RECORDED' as const)
                : ('UNKNOWN' as const),
            customerReceivedAmount: actual?.customerReceivedAmount ?? null,
            lawyerInvoicedAmount: actual?.lawyerInvoicedAmount ?? null,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
