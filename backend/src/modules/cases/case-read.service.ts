import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';

@Injectable()
export class CaseReadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private async scope(actor: ActorContext): Promise<void> {
    if (
      actor.notaryOfficeId !== undefined ||
      actor.clientCustomerId !== undefined
    )
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw this.forbidden();
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    view: 'mine' | 'department' = 'department',
    stage?: 'PENDING_MATCH' | 'WAITING_COMPLAINT',
  ) {
    await this.scope(actor);
    const baseWhere: Prisma.CaseWhereInput = {
      departmentId: actor.departmentId,
      ...(view === 'mine' ? { responsibleUserId: actor.userId } : {}),
    };
    const where: Prisma.CaseWhereInput = {
      ...baseWhere,
      ...(stage ? { stage } : {}),
    };
    const [items, total, grouped] = await Promise.all([
      this.database.case.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          version: true,
          createdAt: true,
          responsibleUserId: true,
          owner: { select: { id: true, displayName: true } },
          responsibleMembership: { select: { teamId: true } },
          sourceLead: { select: { id: true, businessNo: true } },
          sourceNotaryMatter: { select: { id: true, businessNo: true } },
        },
      }),
      this.database.case.count({ where }),
      this.database.case.groupBy({
        by: ['stage'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
    return {
      items: await Promise.all(
        items.map(async (item) => ({
          id: item.id,
          businessNo: item.businessNo,
          stage: item.stage,
          version: item.version,
          owner: item.owner,
          sourceLead: item.sourceLead,
          sourceNotaryMatter: item.sourceNotaryMatter,
          canMatch:
            item.stage === 'PENDING_MATCH' &&
            (await this.access.canAuthorizeCase(actor, 'case.match', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
          createdAt: item.createdAt.toISOString(),
        })),
      ),
      total,
      page,
      pageSize,
      counts: {
        PENDING_MATCH:
          grouped.find((row) => row.stage === 'PENDING_MATCH')?._count._all ??
          0,
        WAITING_COMPLAINT:
          grouped.find((row) => row.stage === 'WAITING_COMPLAINT')?._count
            ._all ?? 0,
      },
    };
  }

  async get(actor: ActorContext, id: string) {
    await this.scope(actor);
    const record = await this.database.case.findFirst({
      where: { id, departmentId: actor.departmentId },
      select: {
        id: true,
        businessNo: true,
        stage: true,
        version: true,
        matchedAt: true,
        createdAt: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        defendants: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            name: true,
            idNo: true,
            phone: true,
            address: true,
          },
        },
        lawyers: {
          orderBy: { startedAt: 'asc' },
          select: {
            id: true,
            role: true,
            startedAt: true,
            endedAt: true,
            lawyer: {
              select: { id: true, fullName: true, lawFirm: true, phone: true },
            },
          },
        },
        courtCaseNo: true,
        owner: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rightsHolder: { select: { id: true, name: true } },
        sourceLead: { select: { id: true, businessNo: true } },
        sourceNotaryMatter: {
          select: {
            id: true,
            businessNo: true,
            evidence: {
              select: {
                matterId: true,
                sampleFeeState: true,
                sampleFeeAmount: true,
              },
            },
          },
        },
        certificate: {
          select: {
            id: true,
            certificateNo: true,
            certificateDate: true,
            issuedAt: true,
            needDisclose: true,
            fees: { select: { category: true, state: true, amount: true } },
          },
        },
      },
    });
    if (record === null)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: '案件不存在或不可访问',
      });
    const frozen = await this.materials.listFrozenCertificateFiles(
      actor,
      record.sourceNotaryMatter.id,
      record.certificate.id,
    );
    const file = (ref: (typeof frozen)[number]) => ({
      materialId: ref.materialId,
      contentVersionId: ref.contentVersionId,
      originalFilename: ref.originalFilename,
      mimeType: ref.mimeType,
    });
    const sample = record.sourceNotaryMatter.evidence;
    return {
      id: record.id,
      businessNo: record.businessNo,
      stage: record.stage,
      version: record.version,
      matchedAt: record.matchedAt?.toISOString() ?? null,
      defendants: record.defendants,
      lawyers: record.lawyers.map((assignment) => ({
        id: assignment.lawyer.id,
        fullName: assignment.lawyer.fullName,
        lawFirm: assignment.lawyer.lawFirm,
        phone: assignment.lawyer.phone,
        role: assignment.role,
        assignedAt: assignment.startedAt.toISOString(),
      })),
      canMatch:
        record.stage === 'PENDING_MATCH' &&
        (await this.access.canAuthorizeCase(actor, 'case.match', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      createdAt: record.createdAt.toISOString(),
      courtCaseNo: record.courtCaseNo,
      department: record.department,
      customer: record.customer,
      rightsHolder: record.rightsHolder,
      owner: record.owner,
      sourceLead: {
        id: record.sourceLead.id,
        businessNo: record.sourceLead.businessNo,
      },
      sourceNotaryMatter: {
        id: record.sourceNotaryMatter.id,
        businessNo: record.sourceNotaryMatter.businessNo,
      },
      certificate: {
        certificateNo: record.certificate.certificateNo,
        certificateDate: record.certificate.certificateDate
          .toISOString()
          .slice(0, 10),
        issuedAt: record.certificate.issuedAt.toISOString(),
        needDisclose: record.certificate.needDisclose,
        files: frozen
          .filter((ref) => ref.purpose === 'NOTARY_CERTIFICATE')
          .map(file),
        disclosureFiles: frozen
          .filter((ref) => ref.purpose === 'NOTARY_DISCLOSURE')
          .map(file),
      },
      fees: [
        ...record.certificate.fees.map((fee) => ({
          category: fee.category,
          state: fee.state,
          amount:
            fee.amount === null
              ? null
              : new Prisma.Decimal(fee.amount.toString()).toFixed(2),
          sourceType: 'NOTARY_CERTIFICATE_FEE' as const,
          sourceId: record.certificate.id,
        })),
        {
          category: 'SAMPLE' as const,
          state: sample?.sampleFeeState ?? 'PENDING',
          amount:
            sample?.sampleFeeAmount === null || sample === null
              ? null
              : new Prisma.Decimal(sample.sampleFeeAmount.toString()).toFixed(
                  2,
                ),
          sourceType: 'NOTARY_MATTER_EVIDENCE' as const,
          sourceId: record.sourceNotaryMatter.id,
        },
      ].sort(
        (a, b) =>
          ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
            a.category,
          ) -
          ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
            b.category,
          ),
      ),
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问案件',
    });
  }
}
